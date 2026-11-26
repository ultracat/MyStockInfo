import fs from 'node:fs';
import path from 'node:path';

interface CachedFile {
  mtimeMs: number;
  size: number;
  value: unknown;
}

// 파일 경로별 파싱 결과 캐시 — 모듈 레벨이라 `store()`가 매번 새 JsonStore
// 인스턴스를 만들어도 공유된다. 이 백엔드는 Electron 메인 프로세스 안에서 돌기
// 때문에(루트 CLAUDE.md 참고) readFileSync + JSON.parse를 요청마다 반복하면
// 그만큼 창/메뉴 이벤트 처리까지 같이 멈춘다 — 파일이 바뀌지 않았으면(mtime/size
// 동일) 이미 파싱해둔 값을 그대로 돌려준다. stat 한 번은 파싱에 비하면 무시할
// 수준이고, 앱 밖에서 파일을 직접 고친 경우에도 다음 read에서 다시 읽힌다.
const fileCache = new Map<string, CachedFile>();

// ─── 손상된 파일(JSON.parse 실패) ─────────────────────────────────────────────────────────────────────
// 예전엔 파싱 실패가 그대로 예외로 올라갔고, 기본값을 돌려주는 식으로 "고치면" 더 위험하다 — 빈 배열을 받은 호출부가
// 곧바로 write-through·update로 그 빈(또는 일부만 채운) 데이터를 써서, 손상 전 내용이 영영 덮어써진다.
// 그래서 사용자 데이터 저장소(기본값 `onCorrupt: 'block'`)는:
//  1. 손상된 파일을 `<이름>.corrupt-<시각>`으로 **옮긴다**(지우지 않음 — 손으로 살릴 수 있게). 이름이 `.json`으로
//     끝나지 않아 백업(backup.ts의 SAFE_FILENAME_RE)에도 안 들어가고, 백업 zip에 손상본이 섞이지 않는다.
//  2. 그 뒤로 원래 파일이 다시 생기기 전까지(= 백업 복원이 파일을 써 넣기 전까지) **읽기·쓰기를 모두 거부**한다 —
//     "파일 없음 = 처음 쓰는 저장소"로 보고 기본값을 돌려주면 1번의 의미가 없어진다. 격리본이 디스크에 남아 있는지로
//     판단하므로 앱을 다시 켜도 그대로다.
//  3. 오류 문구는 백업 복원(설정 → 데이터 백업/복원, 자동 백업 포함)을 안내하고, 백업 없이 비운 채 시작하려면 격리본을
//     치우라고 알려 준다.
// 다시 받으면 되는 캐시(공휴일·환율·월말 종가 같은)는 `onCorrupt: 'reset'` — 격리만 하고 기본값으로 계속 간다.
export class JsonStoreCorruptError extends Error {
  constructor(
    readonly fileName: string,
    readonly quarantinedName: string
  ) {
    super(
      `데이터 파일 ${fileName}이(가) 손상되어 읽을 수 없습니다. 손상된 파일은 데이터 폴더에 ${quarantinedName}(으)로 옮겨 두었습니다. ` +
        '설정 → 데이터 백업/복원에서 백업(자동 백업 포함)으로 복원해 주세요 — 복원 전까지는 빈 데이터로 덮어쓰지 않도록 이 데이터의 읽기·쓰기를 멈춥니다. ' +
        `백업 없이 비어 있는 상태로 다시 시작하려면 데이터 폴더의 ${quarantinedName} 파일을 다른 곳으로 옮기세요.`
    );
    this.name = 'JsonStoreCorruptError';
  }
}

/** 파일 경로 → 그 파일의 격리본 이름(없으면 null). ENOENT 때만 확인하고, 경로마다 한 번 디렉터리를 훑은 결과를 기억한다
 *  (없는 저장소는 요청마다 읽힌다 — 매번 readdir하지 않게). 격리할 때 이 값도 갱신한다. */
const quarantined = new Map<string, string | null>();

function findQuarantine(filePath: string): string | null {
  const known = quarantined.get(filePath);
  if (known !== undefined) {
    // 사용자가 격리본을 치웠으면 막기를 푼다.
    if (known !== null && !fs.existsSync(path.join(path.dirname(filePath), known))) {
      quarantined.set(filePath, null);
      return null;
    }
    return known;
  }
  const prefix = `${path.basename(filePath)}.corrupt-`;
  let found: string | null = null;
  try {
    found = fs.readdirSync(path.dirname(filePath)).filter((n) => n.startsWith(prefix)).sort().pop() ?? null;
  } catch {
    found = null;
  }
  quarantined.set(filePath, found);
  return found;
}

function compactTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, '');
}

/** 임시 파일에 쓰고 디스크까지 내린(fsync) 뒤 rename — 쓰는 도중 전원이 나가도 원본이나 새 내용 중 하나만 남는다.
 *  writeFileSync만으로는 rename이 먼저 디스크에 반영되고 내용은 아직 캐시에 있는 경우 0바이트 파일이 남을 수 있다. */
function writeFileDurably(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  // 소유자만 읽고 쓰게(0600) — 임시 파일의 권한이 rename 뒤 그대로 남는다. 폴더도 0700(paths.ts).
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    const buf = Buffer.from(content, 'utf-8');
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  // 폴더 항목(rename)도 내린다 — 지원하지 않는 플랫폼(Windows는 폴더를 열 수 없다)에선 건너뛴다.
  try {
    const dirFd = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // 무시 — 파일 내용은 이미 fsync됐다.
  }
}

/** 데이터 폴더에 "손상돼 격리됐고 아직 복원 안 한" 사용자 데이터 파일이 있으면 그 이름들(`holdings.json` 등).
 *  자동 백업이 이때 돌면 손상 전의 정상 백업이 7개 보관 한도에 밀려 지워지므로 건너뛰는 데 쓴다(autoBackup.ts). */
export function blockedDataFiles(dataDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return [];
  }
  const present = new Set(names);
  const out = new Set<string>();
  for (const n of names) {
    const m = /^(.+\.json)\.corrupt-/.exec(n);
    if (m && !present.has(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}

export interface JsonStoreOptions {
  /** 파일이 손상됐을 때 — 'block'(기본, 사용자 데이터): 격리 후 복원 전까지 읽기·쓰기 거부. 'reset'(다시 받으면 되는
   *  캐시): 격리 후 기본값으로 계속. 위 "손상된 파일" 주석 참고. */
  onCorrupt?: 'block' | 'reset';
}

/**
 * Minimal JSON-file store: reads the whole file into memory, writes are
 * atomic (write to temp file, fsync, then rename) to avoid corrupting the file if
 * the process is killed mid-write. Fine for single-user, low-write-volume
 * local data (settings, a personal dividend log) — not a database.
 *
 * `read()`가 돌려주는 값은 캐시와 공유되는 객체다 — 호출부는 절대 제자리에서
 * 수정하지 말고(push/splice/필드 대입 등), 항상 새 배열/객체를 만들어
 * `write`/`update`로 넘겨야 한다(지금의 모든 db/* 모듈이 이미 그렇게 쓴다).
 */
export class JsonStore<T> {
  private readonly filePath: string;
  private readonly defaultValue: T;
  private readonly onCorrupt: 'block' | 'reset';

  constructor(fileName: string, dataDir: string, defaultValue: T, options?: JsonStoreOptions) {
    this.filePath = path.join(dataDir, fileName);
    this.defaultValue = defaultValue;
    this.onCorrupt = options?.onCorrupt ?? 'block';
  }

  /** 'block' 저장소의 원래 파일이 없고 격리본만 있으면(손상 뒤 아직 복원 안 함) 거부한다. */
  private assertNotQuarantined(): void {
    if (this.onCorrupt !== 'block') return;
    const q = findQuarantine(this.filePath);
    if (q) throw new JsonStoreCorruptError(path.basename(this.filePath), q);
  }

  read(): T {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        fileCache.delete(this.filePath);
        this.assertNotQuarantined();
        return structuredClone(this.defaultValue);
      }
      throw err;
    }

    const cached = fileCache.get(this.filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value as T;
    }

    let value: T;
    try {
      value = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as T;
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      return this.quarantine(err);
    }
    fileCache.set(this.filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  }

  private quarantine(parseError: SyntaxError): T {
    const base = path.basename(this.filePath);
    // 'reset' 캐시는 이름을 달리한다(`.cache-corrupt-`) — `.corrupt-`는 "복원 전까지 막힌 사용자 데이터"만 뜻하게 해서
    // findQuarantine·자동 백업(hasBlockedDataFiles)이 다시 받으면 되는 캐시 때문에 멈추지 않게.
    const tag = this.onCorrupt === 'reset' ? 'cache-corrupt' : 'corrupt';
    const qName = `${base}.${tag}-${compactTimestamp(new Date())}`;
    fs.renameSync(this.filePath, path.join(path.dirname(this.filePath), qName));
    fileCache.delete(this.filePath);
    console.error(`[jsonStore] ${base} 파싱 실패 — ${qName}(으)로 격리:`, parseError.message);
    if (this.onCorrupt === 'reset') return structuredClone(this.defaultValue);
    quarantined.set(this.filePath, qName);
    throw new JsonStoreCorruptError(base, qName);
  }

  write(data: T): void {
    // 원래 파일이 없고 격리본만 남은 상태에서 쓰면 손상 전 내용 대신 새(대개 일부뿐인) 내용이 "정상 파일"이 된다.
    if (!fs.existsSync(this.filePath)) this.assertNotQuarantined();
    writeFileDurably(this.filePath, JSON.stringify(data, null, 2));
    const stat = fs.statSync(this.filePath);
    fileCache.set(this.filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value: data });
  }

  update(mutator: (current: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }
}
