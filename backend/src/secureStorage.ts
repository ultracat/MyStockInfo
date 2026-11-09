type SafeStorage = typeof import('electron').safeStorage;

/** 자격증명(credentials.ts)·Google 토큰(google/store.ts)을 디스크에 쓸 때 쓸 수 있는
 *  암호화 상태.
 *  - `encrypted`: Electron `safeStorage`가 OS 키체인/키링으로 암호화한다.
 *  - `standalone`: Electron 밖(백엔드 단독 dev/테스트 실행) — 예전처럼 평문 봉투
 *    (`encrypted: false`)를 허용한다. 실사용 경로가 아니다.
 *  - `unavailable`: **Electron 안인데 안전한 암호화가 없다** — 대표적으로 키링
 *    (gnome-keyring/KWallet)이 없는 Linux. 이때는 저장을 거부한다
 *    (`SecureStorageUnavailableError`). 예전엔 경고 로그만 찍고 평문으로 저장했다.
 *
 *  ⚠ Linux에서 키링이 없으면 Chromium은 `basic_text` 백엔드(소스에 박힌 고정 키로
 *  "암호화")로 떨어진다 — 누구나 풀 수 있어 사실상 평문이다. `isEncryptionAvailable()`
 *  만 보면 이 경우를 못 거를 수 있어서 `getSelectedStorageBackend()`를 같이 본다.
 *  `unknown`은 app ready 전이거나 판별 실패라 같이 거부한다. */
export type SecureStorageState =
  | { kind: 'encrypted' }
  | { kind: 'standalone' }
  | { kind: 'unavailable'; linuxBackend: string | null };

const INSECURE_LINUX_BACKENDS = new Set(['basic_text', 'unknown']);

function loadSafeStorage(): SafeStorage | null {
  try {
    // 일반 node에서 require('electron')은 Electron 실행 파일 경로(문자열)를 돌려주므로
    // safeStorage가 없다 — 그게 "Electron 밖" 판별이다.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    return electron?.safeStorage ?? null;
  } catch {
    return null;
  }
}

export function getSecureStorageState(): SecureStorageState {
  const safeStorage = loadSafeStorage();
  if (!safeStorage) return { kind: 'standalone' };
  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend();
    if (INSECURE_LINUX_BACKENDS.has(backend)) return { kind: 'unavailable', linuxBackend: backend };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { kind: 'unavailable', linuxBackend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null };
  }
  return { kind: 'encrypted' };
}

/** 암호화가 실제로 안전할 때만 safeStorage를 준다(쓰기 판단용). */
export function getSafeStorage(): SafeStorage | null {
  return getSecureStorageState().kind === 'encrypted' ? loadSafeStorage() : null;
}

/** 복호화용 — 안전 여부와 무관하게 Electron 안이면 준다. `basic_text`로 이미
 *  "암호화"돼 저장된 기존 항목도 읽을 수 있어야 사용자가 그대로 쓰거나 지울 수 있다. */
export function getDecryptor(): SafeStorage | null {
  return loadSafeStorage();
}

export const SECURE_STORAGE_UNAVAILABLE_MESSAGE =
  process.platform === 'linux'
    ? 'OS 키링(Secret Service)을 찾지 못해 API 키를 암호화할 수 없습니다. 평문으로 남지 않도록 저장을 막았습니다. ' +
      'gnome-keyring(또는 KWallet)을 설치·실행한 뒤 앱을 다시 실행해주세요. 키링이 있는데도 이 메시지가 뜨면 ' +
      '`--password-store=gnome-libsecret`(KDE는 `--password-store=kwallet6`) 옵션으로 실행해보세요.'
    : 'OS 키체인을 사용할 수 없어 API 키를 암호화할 수 없습니다. 평문으로 남지 않도록 저장을 막았습니다.';

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super(SECURE_STORAGE_UNAVAILABLE_MESSAGE);
    this.name = 'SecureStorageUnavailableError';
  }
}

export interface StoredEnvelope {
  // base64 — `encrypted`면 safeStorage 암호문, 아니면 JSON 원문(standalone 실행이나
  // 이 차단이 생기기 전 Linux에서 저장된 것).
  data: string;
  encrypted: boolean;
}

/** 봉투로 감싼다 — 안전한 암호화가 없으면(standalone 제외) 던진다. */
export function sealJson(json: string): StoredEnvelope {
  const state = getSecureStorageState();
  if (state.kind === 'unavailable') throw new SecureStorageUnavailableError();
  if (state.kind === 'standalone') {
    console.warn('[secureStorage] Electron 밖에서 실행 중 — 암호화 없이 저장합니다(dev/테스트 전용 경로).');
    return { data: Buffer.from(json, 'utf-8').toString('base64'), encrypted: false };
  }
  return { data: loadSafeStorage()!.encryptString(json).toString('base64'), encrypted: true };
}

/** 평문 봉투인데 지금은 안전하게 암호화할 수 있으면(키링을 나중에 설치한 경우) true —
 *  호출부가 다시 sealJson으로 써서 평문을 디스크에서 없앤다. */
export function shouldReseal(stored: StoredEnvelope): boolean {
  return !stored.encrypted && getSecureStorageState().kind === 'encrypted';
}
