import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { getDataDir } from './paths';
import { APP_VERSION } from './generated/appInfo';
import { BackupPasswordError, MIN_BACKUP_PASSWORD_LENGTH, openSecrets, sealSecrets, type SealedSecrets } from './backupCrypto';
import { clearCredential, getCredentialFields, listConfiguredBrokers, setCredentialFields } from './credentials';
import * as googleStore from './google/store';
import type { GoogleAccountState } from './google/store';
import { getSecureStorageState } from './secureStorage';
import { BROKER_IDS } from './brokers/knownBrokers';
import { clearEximbankAuthKey, EXIMBANK_KEY_FILE, getEximbankAuthKey, setEximbankAuthKey } from './fx/eximbankKey';
import {
  clearGoogleClientCredentials,
  getGoogleClientCredentials,
  GOOGLE_CLIENT_FILE,
  setGoogleClientCredentials,
  type GoogleClientCredentials,
} from './google/clientCredentials';
import type { BrokerId } from './brokers/types';

/** 데이터 폴더 안의 파일만 백업 대상으로 인정한다 — 영문/숫자/점/하이픈/밑줄로
 *  된 평평한 파일명 + `.json`/`.sqlite` 확장자만. 경로 구분자나 `..`가 섞인
 *  이름은 이 패턴에 애초에 안 걸려서, 복원 시 이 패턴으로 다시 검증하면
 *  zip-slip(압축 해제 시 데이터 폴더 밖으로 쓰기)을 원천 차단한다. */
export const SAFE_FILENAME_RE = /^[\w.-]+\.(json|sqlite)$/;

// ─── 비밀 파일 다루기 ──────────────────────────────────────────────────────────
// 데이터 폴더의 비밀 파일은 zip에 원본 그대로 넣지 않는다.
// - 접속 토큰(`<브로커>-token.json`): 하루 안팎이면 만료되고 없으면 앱이 다시 받는다 — 아예 뺀다.
// - API 키·Google 연결·환율 인증키·Google OAuth 클라이언트(credentials.json, google-account.json, eximbank-key.json,
//   google-client.json): OS 키체인으로 잠겨 있어
//   다른 PC에선 못 연다. 사용자가 백업 비밀번호를 주면 풀어서 그 비밀번호로 다시 잠근
//   `secrets.enc.json` 하나로 넣는다(backupCrypto.ts). 비밀번호를 안 주면 넣지 않는다.
// 증권사가 늘 때마다 목록을 고치다 NH·키움 토큰이 백업에 평문으로 들어간 적이 있어(2026-11-16 보안 검토)
// 이름 규칙(`<브로커>-token.json`)으로 고른다 — 새 브로커 토큰 파일도 이 이름이면 자동으로 빠진다.
const ACCESS_TOKEN_FILE_RE = /^[a-z0-9]+-token\.json$/;
const isAccessTokenFile = (name: string) => ACCESS_TOKEN_FILE_RE.test(name);
const KEYCHAIN_FILES = new Set(['credentials.json', 'google-account.json', EXIMBANK_KEY_FILE, GOOGLE_CLIENT_FILE]);
const SECRETS_ENTRY = 'secrets.enc.json';

interface SecretsPayload {
  credentials: Partial<Record<BrokerId, Record<string, string>>>;
  google: GoogleAccountState;
  /** 한국수출입은행 환율 인증키(사용자 입력). 이 필드가 생기기 전 백업엔 없다(undefined → 지금 키를 그대로 둔다). */
  eximbankKey?: string | null;
  /** Google OAuth 클라이언트(사용자 입력). 없던 시절 백업은 undefined → 지금 값을 그대로 둔다. */
  googleClient?: GoogleClientCredentials | null;
}

export class BackupRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupRequestError';
  }
}

export interface RestoreResult {
  restored: string[];
  skipped: string[];
  /** restored: 백업의 API 키·Google 연결로 교체함 / not-in-backup: 비밀번호 없이 만든
   *  백업이라 지금 저장된 것을 그대로 둠 / keyring-unavailable: 키링 없는 Linux라 저장을
   *  거부함(지금 저장된 것도 그대로 둠, secureStorage.ts) */
  secrets: 'restored' | 'not-in-backup' | 'keyring-unavailable';
}

function collectSecrets(): SecretsPayload {
  const credentials: SecretsPayload['credentials'] = {};
  for (const broker of listConfiguredBrokers()) {
    const fields = getCredentialFields(broker);
    if (fields) credentials[broker] = fields;
  }
  return { credentials, google: googleStore.getState(), eximbankKey: getEximbankAuthKey(), googleClient: getGoogleClientCredentials() };
}

function parseSecretsPayload(json: string): SecretsPayload {
  const raw = JSON.parse(json) as Partial<SecretsPayload>;
  const credentials: SecretsPayload['credentials'] = {};
  for (const [broker, fields] of Object.entries(raw.credentials ?? {})) {
    if (!BROKER_IDS.includes(broker as BrokerId) || !fields || typeof fields !== 'object') continue;
    const clean = Object.fromEntries(
      Object.entries(fields).filter((e): e is [string, string] => typeof e[1] === 'string')
    );
    credentials[broker as BrokerId] = clean;
  }
  const eximbankKey =
    raw.eximbankKey === undefined ? undefined : typeof raw.eximbankKey === 'string' && raw.eximbankKey ? raw.eximbankKey : null;
  const gc = raw.googleClient as Partial<GoogleClientCredentials> | null | undefined;
  const googleClient =
    gc === undefined
      ? undefined
      : gc && typeof gc.clientId === 'string' && typeof gc.clientSecret === 'string' && gc.clientId && gc.clientSecret
        ? { clientId: gc.clientId, clientSecret: gc.clientSecret }
        : null;
  return { credentials, google: (raw.google ?? {}) as GoogleAccountState, eximbankKey, googleClient };
}

/** 데이터 폴더(`getDataDir()`)를 zip으로 묶는다 — 화이트리스트 없이 폴더에 실제로 있는
 *  파일 그대로(배당·보유종목·매매내역·종목명 캐시 등) 넣는다. "백업 = 데이터 폴더
 *  전체"가 가장 단순하고 저장소가 하나 늘어도 이 함수를 안 고쳐도 된다. 예외는 위
 *  비밀 파일(접속 토큰·키체인 파일)뿐이다. */
export async function createBackupZip(password?: string): Promise<{ buffer: Buffer; includesSecrets: boolean }> {
  if (password !== undefined && password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new BackupRequestError(`백업 비밀번호는 ${MIN_BACKUP_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  }
  const dataDir = getDataDir();
  const zip = new AdmZip();

  for (const name of fs.readdirSync(dataDir)) {
    if (!SAFE_FILENAME_RE.test(name)) continue; // 혹시 모를 임시 파일(.tmp 등) 제외
    if (isAccessTokenFile(name) || KEYCHAIN_FILES.has(name)) continue;
    zip.addLocalFile(path.join(dataDir, name));
  }

  const includesSecrets = password !== undefined;
  if (includesSecrets) {
    const sealed = await sealSecrets(JSON.stringify(collectSecrets()), password);
    zip.addFile(SECRETS_ENTRY, Buffer.from(JSON.stringify(sealed, null, 2)));
  }

  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), appVersion: APP_VERSION, includesSecrets }, null, 2)
    )
  );

  return { buffer: zip.toBuffer(), includesSecrets };
}

/** 백업 zip을 데이터 폴더에 풀어 넣는다 — 기존 파일은 덮어쓴다. 비밀번호 확인을
 *  **파일을 쓰기 전에** 끝낸다(틀리면 아무것도 안 바뀜). 직접 `fs.writeFileSync`로 쓰고
 *  열린 SQLite 핸들·토큰 메모리 캐시는 그대로라, 복원 뒤에는 앱을 다시 시작한다
 *  (routes/backup.ts — 패키징된 앱은 자동 재시작). */
// 복원 입력 상한(2026-11-16 보안 재검토) — 백업 파일은 사용자가 고르지만, 조작된 파일 하나로 앱이 멈추거나
// 이상한 파일이 심기지 않게 한다. 실제 백업은 수 MB라 넉넉하다.
const MAX_RESTORE_ENTRIES = 500;
const MAX_RESTORE_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_RESTORE_TOTAL_BYTES = 300 * 1024 * 1024;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** 압축을 푼 내용이 그 확장자의 형식인지 — JSON은 파싱되는지, SQLite는 헤더가 맞는지. */
function contentLooksValid(name: string, data: Buffer): boolean {
  if (name.endsWith('.sqlite')) return data.length >= SQLITE_MAGIC.length && data.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
  try {
    const value = JSON.parse(data.toString('utf-8'));
    // 예전 형식 백업의 키체인 파일은 **이 PC 키체인으로 암호화된 봉투**만 받는다 — 평문 봉투(`encrypted:false`)를
    // 받으면 조작된 백업이 남의 API 키를 심을 수 있다(그 키로 조회되는 건 남의 계좌지만, 사용자는 모른다).
    if (KEYCHAIN_FILES.has(name)) return isEncryptedEnvelopeFile(value);
    return true;
  } catch {
    return false;
  }
}

function isEncryptedEnvelopeFile(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const envelopes = Object.values(value as Record<string, unknown>);
  // google-account.json은 봉투 하나, credentials.json은 브로커별 봉투 맵.
  const single = value as { data?: unknown; encrypted?: unknown };
  if (typeof single.data === 'string') return single.encrypted === true;
  return envelopes.every(
    (e) => typeof e === 'object' && e !== null && typeof (e as { data?: unknown }).data === 'string' && (e as { encrypted?: unknown }).encrypted === true
  );
}

export async function restoreBackupZip(buf: Buffer, password?: string): Promise<RestoreResult> {
  const dataDir = getDataDir();
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  // 풀기 전에 선언된 크기로 먼저 거른다(압축 폭탄). 실제로 푼 크기는 아래에서 다시 본다.
  if (entries.length > MAX_RESTORE_ENTRIES) throw new BackupRequestError('백업 파일에 항목이 너무 많습니다. MyStock 백업 파일이 맞는지 확인해주세요.');
  const declaredTotal = entries.reduce((sum, e) => sum + e.header.size, 0);
  if (declaredTotal > MAX_RESTORE_TOTAL_BYTES || entries.some((e) => e.header.size > MAX_RESTORE_ENTRY_BYTES)) {
    throw new BackupRequestError('백업 파일을 풀면 너무 큽니다. MyStock 백업 파일이 맞는지 확인해주세요.');
  }

  const secretsEntry = entries.find((e) => e.entryName === SECRETS_ENTRY);
  let payload: SecretsPayload | null = null;
  if (secretsEntry) {
    if (!password) {
      throw new BackupPasswordError(
        '이 백업에는 비밀번호로 암호화한 API 키가 들어 있습니다. 백업할 때 정한 비밀번호를 입력해주세요.'
      );
    }
    const sealed = JSON.parse(secretsEntry.getData().toString('utf-8')) as SealedSecrets;
    payload = parseSecretsPayload(await openSecrets(sealed, password));
  }

  const restored: string[] = [];
  const skipped: string[] = [];
  const toWrite: { name: string; data: Buffer }[] = [];
  for (const entry of entries) {
    const name = entry.entryName;
    if (name === 'manifest.json' || name === SECRETS_ENTRY) continue;
    // 접속 토큰은 예전 백업에 들어 있어도 쓰지 않는다(없으면 다시 받는다).
    // 키체인 파일은 예전 형식 백업(secrets.enc.json 없음)에서만 받는다 — 같은 PC면 열린다.
    const unsafe = !SAFE_FILENAME_RE.test(name);
    if (unsafe || isAccessTokenFile(name) || (secretsEntry && KEYCHAIN_FILES.has(name))) {
      skipped.push(name);
      continue;
    }
    const data = entry.getData();
    if (data.length > MAX_RESTORE_ENTRY_BYTES || !contentLooksValid(name, data)) {
      skipped.push(name);
      continue;
    }
    toWrite.push({ name, data });
  }
  // 검사를 모두 통과한 뒤에 쓴다 — 중간에 형식이 틀린 항목이 있어도 일부만 덮어쓰지 않게.
  for (const { name, data } of toWrite) {
    fs.writeFileSync(path.join(dataDir, name), data, { mode: 0o600 });
    restored.push(name);
  }

  if (!payload) return { restored, skipped, secrets: 'not-in-backup' };
  if (getSecureStorageState().kind === 'unavailable') return { restored, skipped, secrets: 'keyring-unavailable' };

  // 백업의 비밀 정보가 기준이다 — 백업에 없는 브로커 키는 지운다.
  for (const broker of listConfiguredBrokers()) {
    if (!payload.credentials[broker]) clearCredential(broker);
  }
  for (const [broker, fields] of Object.entries(payload.credentials)) {
    setCredentialFields(broker as BrokerId, fields!);
  }
  googleStore.replaceState(payload.google);
  if (payload.eximbankKey === null) clearEximbankAuthKey();
  else if (payload.eximbankKey !== undefined) setEximbankAuthKey(payload.eximbankKey);
  if (payload.googleClient === null) clearGoogleClientCredentials();
  else if (payload.googleClient !== undefined) setGoogleClientCredentials(payload.googleClient);
  // 지금 PC에 남은 접속 토큰은 복원 전 키로 받은 것일 수 있다 — 지워서 새 키로 다시 받게 한다.
  for (const name of fs.readdirSync(dataDir)) {
    if (isAccessTokenFile(name)) fs.rmSync(path.join(dataDir, name), { force: true });
  }

  return { restored, skipped, secrets: 'restored' };
}
