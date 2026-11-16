import { createHash } from 'node:crypto';
import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import { getDecryptor, sealJson, shouldReseal, type StoredEnvelope } from '../secureStorage';

// 한국수출입은행 환율 API 인증키 — **사용자가 설정에서 직접 입력한다**(2026-11-16 사용자 결정: "내 키를 삽입해서
// 사용하는 것은 아닌 것 같다"). 예전엔 개발자 개인 발급 키를 빌드에 박아 넣어(fx/eximbankConfig.ts) 모든 사용자가 같은
// 키를 썼다 — 설치 파일에서 꺼낼 수 있고, 한 사람이 남용하면 모두의 일일 호출 한도가 소진되며, 키가 개발자 명의였다.
//
// 증권사 키처럼 OS 키체인 봉투(secureStorage.ts의 sealJson)로 저장한다 — 계좌 권한이 없는 공개 환율 조회 키지만,
// 남이 쓰면 그 사용자의 한도가 소진되고 발급자 명의라 평문으로 두지 않는다. 키링 없는 Linux면 저장을 거부한다
// (SecureStorageUnavailableError — 라우트가 409). 백업에는 비밀번호를 정했을 때만 secrets.enc.json 안에 들어간다(backup.ts).

export const EXIMBANK_KEY_FILE = 'eximbank-key.json';

const store = () => new JsonStore<StoredEnvelope | null>(EXIMBANK_KEY_FILE, getDataDir(), null);

let decrypted: { data: string; key: string } | null = null;

// ① 시절(설정에서 입력 → 평문 settings.json의 `eximbankAuthKey`)에 저장된 키가 남아 있을 수 있다 — 실제로 개발자 PC에
// 남아 있었고, settings.json은 백업 zip에도 그대로 들어간다. 처음 읽을 때 키체인 봉투로 옮기고 평문 필드를 지운다
// (사용자가 직접 넣었던 키라 옮겨 주는 게 맞다). 이미 새 키가 있으면 옛 값은 지우기만 한다. 키링이 없어 봉투로 못 옮기면
// 잃지 않게 그대로 둔다(쓰지는 않는다). 프로세스당 한 번.
let legacyChecked = false;
function migrateLegacyKey(): void {
  if (legacyChecked) return;
  legacyChecked = true;
  const settings = new JsonStore<Record<string, unknown>>('settings.json', getDataDir(), {});
  const legacy = settings.read().eximbankAuthKey;
  if (legacy === undefined) return;
  try {
    if (typeof legacy === 'string' && legacy && !store().read()) setEximbankAuthKey(legacy);
  } catch {
    return; // SecureStorageUnavailableError 등 — 평문을 지우지 않는다
  }
  settings.update((current) => {
    const next = { ...current };
    delete next.eximbankAuthKey;
    return next;
  });
}

export function hasEximbankAuthKey(): boolean {
  migrateLegacyKey();
  return Boolean(store().read());
}

/** 저장된 키(복호화). 없거나 풀 수 없으면 null — 환율 조회는 "키 없음"과 같게 동작한다. */
export function getEximbankAuthKey(): string | null {
  migrateLegacyKey();
  const stored = store().read();
  if (!stored || typeof stored.data !== 'string') return null;
  if (decrypted && decrypted.data === stored.data && !shouldReseal(stored)) return decrypted.key;
  try {
    let json: string;
    if (stored.encrypted) {
      const decryptor = getDecryptor();
      if (!decryptor) return null;
      json = decryptor.decryptString(Buffer.from(stored.data, 'base64'));
    } else {
      json = Buffer.from(stored.data, 'base64').toString('utf-8');
    }
    const key = (JSON.parse(json) as { authKey?: unknown }).authKey;
    if (typeof key !== 'string' || !key) return null;
    if (shouldReseal(stored)) {
      setEximbankAuthKey(key);
      return key;
    }
    decrypted = { data: stored.data, key };
    return key;
  } catch {
    return null;
  }
}

/** 키체인으로 암호화해 저장한다 — 안전하게 암호화할 수 없으면 SecureStorageUnavailableError를 던진다. */
export function setEximbankAuthKey(authKey: string): void {
  store().write(sealJson(JSON.stringify({ authKey })));
}

export function clearEximbankAuthKey(): void {
  store().write(null);
  decrypted = null;
}

/** 캐시 키에 쓸 짧은 지문 — 키를 바꾸면 이전 키로 받은 "없음" 결과를 다시 쓰지 않게(원문은 남기지 않는다). */
export function eximbankKeyFingerprint(authKey: string): string {
  return createHash('sha256').update(authKey).digest('hex').slice(0, 12);
}
