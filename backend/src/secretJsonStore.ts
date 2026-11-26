import fs from 'node:fs';
import path from 'node:path';
import { JsonStore } from './jsonStore';
import { isEnvelope, openJson, sealJson, SecureStorageUnavailableError } from './secureStorage';

// 증권사 접속 토큰(kis/kb/nh/kiwoom/ls/db-token.json)처럼 **비밀이지만 잃어도 다시 받으면 되는** 값을
// 파일에 둘 때 쓰는 저장소. credentials.json과 같은 봉투(secureStorage.ts의 sealJson)로 OS 키체인
// 암호화해 쓴다 — 예전엔 평문 JSON이라, 같은 사용자 권한으로 도는 아무 프로그램이 파일만 읽어도
// 하루짜리 계좌 API 토큰을 가져갈 수 있었다(2026-11-16 보안 검토).
//
// 자격증명과 다른 점(토큰은 "캐시"라서):
// - 풀 수 없으면(키체인 거부·다른 PC·손상) 던지지 않고 **없는 것으로** 본다 → 호출부가 새로 발급한다.
// - 안전한 암호화가 없으면(키링 없는 Linux) 평문으로 쓰지 않고 **파일을 지운다** — 토큰은 이번 실행
//   동안 메모리(호출부의 cachedToken)에만 있다. KIS처럼 발급 횟수 제한이 있으면 재실행 때 한 번 더 받는다.
// - 예전 평문 파일은 읽을 때 그대로 받아들이고 그 자리에서 암호화해 다시 쓴다(마이그레이션).

export class SecretJsonStore<T extends object> {
  private readonly inner: JsonStore<unknown>;
  private readonly filePath: string;

  constructor(fileName: string, dataDir: string) {
    // 토큰은 캐시라 손상되면 격리 후 새로 발급(jsonStore.ts의 'reset') — 'block'이면 그 증권사 조회가 통째로 막힌다.
    this.inner = new JsonStore<unknown>(fileName, dataDir, null, { onCorrupt: 'reset' });
    this.filePath = path.join(dataDir, fileName);
  }

  async read(): Promise<T | null> {
    let raw: unknown;
    try {
      raw = this.inner.read();
    } catch {
      return null; // 깨진 JSON — 캐시일 뿐이니 새로 받는다
    }
    if (raw == null) return null;
    if (!isEnvelope(raw)) {
      // 평문 시절 파일 — 받아들이고 암호화해 다시 쓴다.
      await this.write(raw as T);
      return raw as T;
    }
    try {
      const { json, reseal } = await openJson(raw);
      const value = JSON.parse(json) as T;
      if (reseal) await this.write(value);
      return value;
    } catch {
      return null;
    }
  }

  async write(value: T | null): Promise<void> {
    if (value == null) {
      this.remove();
      return;
    }
    try {
      this.inner.write(await sealJson(JSON.stringify(value)));
    } catch (err) {
      if (!(err instanceof SecureStorageUnavailableError)) throw err;
      console.warn(`[secretJsonStore] OS 키링이 없어 ${path.basename(this.filePath)}을 디스크에 저장하지 않습니다(이번 실행 동안만 메모리에 유지).`);
      this.remove();
    }
  }

  private remove(): void {
    fs.rmSync(this.filePath, { force: true });
  }
}
