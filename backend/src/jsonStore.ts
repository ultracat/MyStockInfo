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

/**
 * Minimal JSON-file store: reads the whole file into memory, writes are
 * atomic (write to temp file, then rename) to avoid corrupting the file if
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

  constructor(fileName: string, dataDir: string, defaultValue: T) {
    this.filePath = path.join(dataDir, fileName);
    this.defaultValue = defaultValue;
  }

  read(): T {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        fileCache.delete(this.filePath);
        return structuredClone(this.defaultValue);
      }
      throw err;
    }

    const cached = fileCache.get(this.filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value as T;
    }

    const value = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as T;
    fileCache.set(this.filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  }

  write(data: T): void {
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
    const stat = fs.statSync(this.filePath);
    fileCache.set(this.filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value: data });
  }

  update(mutator: (current: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }
}
