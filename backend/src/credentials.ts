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

export function getCredentialFields(broker: BrokerId): Record<string, string> | null {
  const stored = store().read()[broker];
  if (!stored) return null;

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

  return JSON.parse(json);
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
