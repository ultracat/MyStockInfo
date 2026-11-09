import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';

/** 백업 zip 안의 `secrets.enc.json` 형식 — API 키·Google 연결 정보를 **사용자가 정한
 *  비밀번호**로 암호화한 것. 평소 저장소는 OS 키체인(safeStorage)으로 잠그지만 그 열쇠는
 *  PC 밖으로 못 나가서, 그대로 백업하면 다른 PC에서 못 연다 — 백업할 때만 비밀번호
 *  열쇠로 바꿔 잠그고, 복원할 때 그 PC의 키체인으로 다시 잠근다(backup.ts 참고).
 *
 *  KDF 파라미터를 파일에 같이 적어 두는 이유: 나중에 기본값을 올려도 예전 백업을
 *  계속 열 수 있게. */
export interface SealedSecrets {
  version: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

// N=2^16, r=8 → 약 64MB 메모리. 대입 공격 비용을 올리는 게 목적이고, 백업/복원 한 번에
// 한 번만 돌아서 수백 ms는 문제없다. 비동기 scrypt라 메인 프로세스를 붙잡지 않는다.
const DEFAULT_PARAMS = { N: 2 ** 16, r: 8, p: 1 };
const KEY_LENGTH = 32; // AES-256

export const MIN_BACKUP_PASSWORD_LENGTH = 8;

export class BackupPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupPasswordError';
  }
}

function deriveKey(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem 기본값(32MB)은 N=2^16을 못 받는다 — 필요량(128·N·r)의 두 배로 잡는다.
    const maxmem = 256 * params.N * params.r;
    scrypt(password, salt, KEY_LENGTH, { ...params, maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function sealSecrets(json: string, password: string): Promise<SealedSecrets> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, DEFAULT_PARAMS);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(json, 'utf-8'), cipher.final()]);
  return {
    version: 1,
    kdf: 'scrypt',
    ...DEFAULT_PARAMS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** 비밀번호가 틀리면 GCM 인증 태그 검증이 실패한다 — 그걸 BackupPasswordError로 바꾼다. */
export async function openSecrets(sealed: SealedSecrets, password: string): Promise<string> {
  if (sealed.version !== 1 || sealed.kdf !== 'scrypt') {
    throw new Error('지원하지 않는 백업 암호화 형식입니다. 앱을 최신 버전으로 업데이트해주세요.');
  }
  const key = await deriveKey(password, Buffer.from(sealed.salt, 'base64'), sealed);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf-8');
  } catch {
    throw new BackupPasswordError('백업 비밀번호가 올바르지 않습니다.');
  }
}
