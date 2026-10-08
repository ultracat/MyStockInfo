import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { getDataDir } from './paths';
import { APP_VERSION } from './generated/appInfo';

/** 데이터 폴더 안의 파일만 백업 대상으로 인정한다 — 영문/숫자/점/하이픈/밑줄로
 *  된 평평한 파일명 + `.json`/`.sqlite` 확장자만. 경로 구분자나 `..`가 섞인
 *  이름은 이 패턴에 애초에 안 걸려서, 복원 시 이 패턴으로 다시 검증하면
 *  zip-slip(압축 해제 시 데이터 폴더 밖으로 쓰기)을 원천 차단한다. */
const SAFE_FILENAME_RE = /^[\w.-]+\.(json|sqlite)$/;

export interface RestoreResult {
  restored: string[];
  skipped: string[];
}

/** 데이터 폴더(`getDataDir()`) 전체를 zip으로 묶는다 — 화이트리스트 없이
 *  폴더에 실제로 있는 파일 그대로(자격증명/토큰/배당·보유종목·매매내역/
 *  종목명 캐시 등) 전부 포함한다. "백업 = 데이터 폴더 전체"가 가장 단순하고
 *  나중에 저장소가 하나 늘어도 이 함수를 안 고쳐도 되는 방식이다. */
export function createBackupZip(): Buffer {
  const dataDir = getDataDir();
  const zip = new AdmZip();

  for (const name of fs.readdirSync(dataDir)) {
    if (!SAFE_FILENAME_RE.test(name)) continue; // 혹시 모를 임시 파일(.tmp 등) 제외
    zip.addLocalFile(path.join(dataDir, name));
  }

  zip.addFile(
    'manifest.json',
    Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), appVersion: APP_VERSION }, null, 2))
  );

  return zip.toBuffer();
}

/** 백업 zip을 데이터 폴더에 통째로 풀어 넣는다 — 기존 파일은 전부 덮어쓴다.
 *  `JsonStore`의 메모리 캐시(파일별 mtime/size 캐시, 브로커 토큰 메모리 캐시
 *  등)를 거치지 않고 직접 `fs.writeFileSync`로 쓰므로, 호출부가 사용자에게
 *  "복원 후 앱을 재시작해주세요"를 안내해야 한다(각 캐시를 하나하나 무효화하는
 *  것보다 훨씬 단순하고 안전함 — 전체 교체라는 이 작업의 성격과도 맞음). */
export function restoreBackupZip(buf: Buffer): RestoreResult {
  const dataDir = getDataDir();
  const zip = new AdmZip(buf);
  const restored: string[] = [];
  const skipped: string[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (name === 'manifest.json') continue; // 메타데이터일 뿐 복원 대상 아님
    if (!SAFE_FILENAME_RE.test(name)) {
      skipped.push(name);
      continue;
    }
    fs.writeFileSync(path.join(dataDir, name), entry.getData());
    restored.push(name);
  }

  return { restored, skipped };
}
