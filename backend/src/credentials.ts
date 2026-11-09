import { getDataDir } from './paths';
import { JsonStore } from './jsonStore';
import type { BrokerId } from './brokers/types';
import { getDecryptor, getSecureStorageState, sealJson, shouldReseal, type StoredEnvelope } from './secureStorage';

// 봉투 형식·암호화 가능 여부 판단은 secureStorage.ts가 한다(google/store.ts와 공용).
type CredentialsFile = Partial<Record<BrokerId, StoredEnvelope>>;

function store() {
  return new JsonStore<CredentialsFile>('credentials.json', getDataDir(), {});
}

/**
 * Each broker needs a different set of credential fields (Toss: client
 * ID/secret; KIS: app key/secret + account number/product code — see
 * brokers/credentialFields.ts), so this stores an arbitrary field map per
 * broker rather than a fixed shape.
 */
export function setCredentialFields(broker: BrokerId, fields: Record<string, string>): void {
  // 키링 없는 Linux 등 안전하게 암호화할 수 없으면 여기서 던진다
  // (SecureStorageUnavailableError — routes/settings.ts가 409로 바꾼다).
  const stored = sealJson(JSON.stringify(fields));
  store().update((current) => ({ ...current, [broker]: stored }));
}

/** 안전하지 않게 저장돼 있을 수 있는 브로커 — 설정 화면 경고용(routes/settings.ts).
 *  평문 봉투는 항상 포함하고, 지금 암호화가 안전하지 않으면(Linux `basic_text` 등)
 *  "암호화됨" 표시 항목도 그 약한 키로 쓰였을 수 있어 전부 포함한다. */
export function listInsecureBrokers(): BrokerId[] {
  const file = store().read();
  const weak = getSecureStorageState().kind === 'unavailable';
  return (Object.keys(file) as BrokerId[]).filter((b) => file[b] && (weak || !file[b]!.encrypted));
}

// 복호화 결과 캐시 — KIS/KB는 API 요청 하나마다 requireCredentials()로 이
// 함수를 부르는데, safeStorage.decryptString은 OS 키체인을 거치는 동기 호출이라
// Electron 메인 프로세스를 그만큼 붙잡는다. 저장된 암호문(`data`)이 그대로면
// 결과도 같으므로 암호문 문자열을 키로 재사용한다 — 설정 화면에서 다시 저장하거나
// 지우면 암호문이 바뀌거나 사라져 자연히 다시 복호화된다(별도 무효화 불필요).
const decryptedCache = new Map<BrokerId, { data: string; fields: Record<string, string> }>();

export function getCredentialFields(broker: BrokerId): Record<string, string> | null {
  const stored = store().read()[broker];
  if (!stored) return null;

  const cached = decryptedCache.get(broker);
  if (cached && cached.data === stored.data && !shouldReseal(stored)) return { ...cached.fields };

  let json: string;
  if (stored.encrypted) {
    if (typeof stored.data !== 'string') {
      // Guards against a credentials.json entry written by an older/broken
      // schema (e.g. fields stored flat instead of the {data, encrypted}
      // envelope) — without this check, Buffer.from(undefined, 'base64')
      // throws a cryptic native TypeError instead of telling the user what
      // to do about it.
      throw new Error(
        `[credentials] "${broker}" 자격증명 데이터가 손상되었습니다. 설정 화면에서 자격증명을 다시 입력해주세요.`
      );
    }
    const safeStorage = getDecryptor();
    if (!safeStorage) {
      throw new Error(
        `[credentials] Stored credentials for "${broker}" are encrypted but Electron safeStorage is not ` +
          'available in this process. Run this backend inside Electron to decrypt them.'
      );
    }
    json = safeStorage.decryptString(Buffer.from(stored.data, 'base64'));
  } else {
    json = Buffer.from(stored.data, 'base64').toString('utf-8');
  }

  const fields = JSON.parse(json) as Record<string, string>;
  // 키링이 없던 때(또는 이 차단이 생기기 전) 평문으로 저장된 항목은, 지금 암호화할
  // 수 있게 됐으면 그 자리에서 암호화해 다시 쓴다 — 평문이 디스크에 계속 남지 않게.
  if (shouldReseal(stored)) {
    store().update((current) => ({ ...current, [broker]: sealJson(json) }));
    return { ...fields };
  }
  decryptedCache.set(broker, { data: stored.data, fields });
  return { ...fields };
}

export function hasCredential(broker: BrokerId): boolean {
  return Boolean(store().read()[broker]);
}

export function clearCredential(broker: BrokerId): void {
  store().update((current) => {
    const next = { ...current };
    delete next[broker];
    return next;
  });
}

export function listConfiguredBrokers(): BrokerId[] {
  return Object.keys(store().read()) as BrokerId[];
}
