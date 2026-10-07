import { getDataDir } from './paths';
import { JsonStore } from './jsonStore';
import type { BrokerId } from './brokers/types';

interface StoredCredential {
  // Base64 of the encrypted JSON.stringify(fields) buffer (Electron
  // safeStorage), or, only when safeStorage is unavailable (plain `node`,
  // non-Electron dev runs), base64 of the raw JSON with `encrypted: false`.
  data: string;
  encrypted: boolean;
}

type CredentialsFile = Partial<Record<BrokerId, StoredCredential>>;

function getSafeStorage(): typeof import('electron').safeStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    if (electron?.safeStorage?.isEncryptionAvailable?.()) {
      return electron.safeStorage;
    }
  } catch {
    // Not running inside Electron's main process — expected for
    // standalone backend dev/test runs.
  }
  return null;
}

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
  const json = JSON.stringify(fields);
  const safeStorage = getSafeStorage();
  let stored: StoredCredential;

  if (safeStorage) {
    stored = { data: safeStorage.encryptString(json).toString('base64'), encrypted: true };
  } else {
    console.warn(
      '[credentials] Electron safeStorage unavailable — storing credentials WITHOUT encryption. ' +
        'This path is only expected when running the backend standalone (outside Electron) for dev/testing. ' +
        'Run the packaged app via Electron for real use.'
    );
    stored = { data: Buffer.from(json, 'utf-8').toString('base64'), encrypted: false };
  }

  store().update((current) => ({ ...current, [broker]: stored }));
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
  if (cached && cached.data === stored.data) return { ...cached.fields };

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
    const safeStorage = getSafeStorage();
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
