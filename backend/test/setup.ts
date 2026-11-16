import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SecretJsonStore } from '../src/secretJsonStore';

// 각 테스트 파일은 node --test가 별도 프로세스로 돌린다 — 파일마다 임시 데이터 폴더를
// 하나 잡는다. 다른 모듈보다 **먼저** import해야 한다(paths.ts의 getDataDir()가
// 처음 불릴 때 이 값을 읽고 고정한다).
export const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mystock-test-'));
process.env.MYSTOCK_DATA_DIR = DATA_DIR;

process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

/** 테스트 사이에 데이터 폴더를 비운다. JsonStore 캐시는 ENOENT를 보면 스스로 지운다. */
export function resetDataDir(): void {
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name.endsWith('.sqlite')) continue; // 열린 SQLite 핸들 — 지우지 않는다
    fs.rmSync(path.join(DATA_DIR, name), { force: true });
  }
}

export function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8')) as T;
}

/** 접속 토큰처럼 SecretJsonStore(봉투)로 저장된 파일을 풀어서 읽는다. */
export async function readSecretJson<T extends object>(name: string): Promise<T> {
  const raw = readJson<{ data?: unknown; encrypted?: unknown }>(name);
  assert.ok(typeof raw.data === 'string' && typeof raw.encrypted === 'boolean', `${name}은 봉투 형식이어야 한다(평문 저장 금지)`);
  const value = await new SecretJsonStore<T>(name, DATA_DIR).read();
  assert.ok(value, `${name}을 풀 수 있어야 한다`);
  return value;
}
