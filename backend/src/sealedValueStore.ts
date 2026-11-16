import { getDataDir } from './paths';
import { JsonStore } from './jsonStore';
import { openJson, sealJson, type StoredEnvelope } from './secureStorage';

/**
 * 비밀 값 하나를 OS 키체인 봉투(secureStorage.ts)로 저장하는 파일 — 사용자가 입력한 키(fx/eximbankKey.ts의 환율 인증키,
 * google/clientCredentials.ts의 OAuth 클라이언트)가 쓴다.
 *
 * - `read()`: 없거나 풀 수 없거나 `parse`가 거부하면 null. 복호화는 키체인을 거치는 비동기 호출이라 **암호문(`data`) 문자열을
 *   키로 결과를 메모리에 캐시**한다 — 다시 저장하면 암호문이 바뀌어 저절로 다시 푼다. 풀 때 `reseal`이면 다시 봉해 쓴다.
 * - `write()`: 안전하게 암호화할 수 없으면(키링 없는 Linux) `SecureStorageUnavailableError`를 던진다 — 평문으로 두지 않는다.
 *
 * 접속 토큰은 실패 정책이 달라(못 쓰면 지움) secretJsonStore.ts, 증권사 키는 브로커별 봉투 맵이라 credentials.ts가 따로 한다.
 */
export class SealedValueStore<T> {
  private cache: { data: string; value: T } | null = null;

  /** `parse`는 저장된 JSON을 값으로, `serialize`는 값을 저장할 JSON 모양으로 — 파일 형식을 예전 그대로 유지하려고 둘 다 받는다. */
  constructor(
    readonly fileName: string,
    private readonly parse: (raw: unknown) => T | null,
    private readonly serialize: (value: T) => unknown = (v) => v
  ) {}

  private file() {
    return new JsonStore<StoredEnvelope | null>(this.fileName, getDataDir(), null);
  }

  exists(): boolean {
    return Boolean(this.file().read());
  }

  async read(): Promise<T | null> {
    const stored = this.file().read();
    if (!stored || typeof stored.data !== 'string') return null;
    if (this.cache && this.cache.data === stored.data) return this.cache.value;
    try {
      const { json, reseal } = await openJson(stored);
      const value = this.parse(JSON.parse(json));
      if (value === null) return null;
      if (reseal) {
        await this.write(value);
        return value;
      }
      this.cache = { data: stored.data, value };
      return value;
    } catch {
      return null;
    }
  }

  async write(value: T): Promise<void> {
    const sealed = await sealJson(JSON.stringify(this.serialize(value)));
    this.file().write(sealed);
    this.cache = { data: sealed.data, value };
  }

  clear(): void {
    this.file().write(null);
    this.cache = null;
  }
}
