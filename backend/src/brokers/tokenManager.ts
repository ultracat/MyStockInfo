// 증권사 접속 토큰 공용 관리자(2026-11-26) — 예전엔 토스·KIS·KB·키움·NH·LS/DB(xingFamily)가 각자 같은 일을 따로 구현해
// 401 재발급 경쟁·자격증명 변경 감지가 브로커마다 달랐다(리뷰). 여기 한 곳에서:
//
// 1. **동시 발급 공유** — 캐시가 없거나 만료일 때 동시에 들어온 요청은 발급 한 번을 같이 기다린다.
// 2. **무효 토큰 비교(`getToken(staleToken)`)** — 401 등으로 "이 토큰은 죽었다"고 본 요청은 그 토큰을 넘긴다. 캐시가 이미
//    다른 토큰으로 바뀌었으면(다른 요청이 먼저 재발급) 또 발급하지 않고 그걸 쓴다. 예전 토스·KIS·KB·키움은 401마다 무조건
//    재발급해서, 동시에 401을 받은 요청들이 서로의 새 토큰을 무효화했다(토스는 재발급하면 이전 토큰이 바로 죽는다,
//    KIS는 발급 빈도 제한 EGW00133, NH는 재발급마다 계좌주에게 보안 알림, DB는 1분 1건).
// 3. **자격증명 키 해시(`keyHash`)** — 토큰과 함께 앱키(토스는 Client ID)의 sha256 앞 16자를 저장하고 지금 키와 다르면 쓰지
//    않는다(원문은 저장하지 않는다). 해시 형식은 예전 NH·키움·xingFamily와 같아서 그 파일들은 그대로 이어 쓴다.
//    해시가 없는 예전 파일(KIS·KB)은 한 번 받아들이고 지금 키 해시를 붙여 다시 쓴다 — 업그레이드만으로 재발급하지 않게.
//    (예전 앱에서 키를 바꿨다면 그때 401 → 재발급으로 이미 새 파일이 됐을 것이고, 그 뒤 변경은 아래 4가 지운다.)
// 4. **자격증명 저장·삭제 훅(`invalidateBrokerTokens`)** — credentials.ts의 setCredentialFields/clearCredential이 부른다.
//    그 브로커의 메모리 캐시·진행 중 발급 결과를 버리고 `<브로커>-token.json`을 지운다(키를 지운 뒤 디스크에 토큰이 남지 않게,
//    앱키는 같고 시크릿만 바꾼 경우도 새로 받게). 클라이언트 모듈이 아직 로드되지 않았어도 파일은 이름 규칙으로 지운다.
//    발급 도중에 무효화되면(세대 번호 `generation`이 바뀜) 그 결과는 캐시·파일에 남기지 않는다.
//
// 브로커별 차이는 호출부가 넘긴다: 발급 요청 모양·만료 계산(버퍼 포함)·리미터는 `issue`, 파일 저장 여부는 `persist`
// (토스는 메모리만 — 실행마다 새로 받는다, KIS·KB·NH·키움·LS·DB는 파일), 어떤 응답을 "토큰 무효"로 볼지는 각 요청 함수.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../paths';
import { SecretJsonStore } from '../secretJsonStore';
import { invalidateCacheByPrefix } from './responseCache';
import type { BrokerId } from './types';

export interface IssuedToken {
  accessToken: string;
  /** epoch ms — 안전 여유(보통 60초)를 이미 뺀 값. */
  expiresAt: number;
}

interface StoredToken extends IssuedToken {
  /** 예전 KIS·KB 파일엔 없다(위 3). */
  keyHash?: string;
}

export interface TokenManagerOptions<C> {
  broker: BrokerId;
  /** 자격증명 읽기 — 없으면 던진다(각 브로커의 "API 키가 설정되지 않았습니다" 메시지). */
  loadCreds: () => Promise<C>;
  /** 토큰이 묶이는 자격증명 값(앱키·Client ID). 해시해서 비교한다. */
  keyOf: (creds: C) => string;
  /** 실제 발급(HTTP). loadCreds가 돌려준 같은 자격증명을 받는다. */
  issue: (creds: C) => Promise<IssuedToken>;
  /** true면 `<broker>-token.json`(SecretJsonStore)에 저장해 재시작 뒤에도 쓴다. */
  persist: boolean;
}

export interface TokenManager<C> {
  /** 유효한 토큰. `staleToken`을 주면 그 토큰은 쓰지 않는다(이미 바뀌었으면 바뀐 걸, 아니면 새로 발급). */
  getToken(staleToken?: string): Promise<string>;
  /** 자격증명 읽기(요청 헤더에 앱키를 싣는 브로커용) — loadCreds 그대로. */
  creds(): Promise<C>;
}

export function credentialKeyHash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function tokenFileName(broker: BrokerId): string {
  return `${broker}-token.json`;
}

const resetters = new Map<BrokerId, Set<() => void>>();

/** 자격증명을 저장·삭제했을 때 — 그 브로커의 메모리 토큰·진행 중 발급 결과를 버리고 토큰 파일을 지운다. */
export function invalidateBrokerTokens(broker: BrokerId): void {
  for (const reset of resetters.get(broker) ?? []) reset();
  fs.rmSync(path.join(getDataDir(), tokenFileName(broker)), { force: true });
  // 이전 키로 받은 응답 캐시도 버린다(보유·잔고 30초 등) — 키 이름이 전부 '<브로커>:'로 시작한다.
  invalidateCacheByPrefix(`${broker}:`);
}

export function createTokenManager<C>(opts: TokenManagerOptions<C>): TokenManager<C> {
  const store = () => new SecretJsonStore<StoredToken>(tokenFileName(opts.broker), getDataDir());
  let cached: (IssuedToken & { keyHash: string }) | null = null;
  let inFlight: { hash: string; gen: number; promise: Promise<string> } | null = null;
  let generation = 0;

  const set = resetters.get(opts.broker) ?? new Set<() => void>();
  resetters.set(opts.broker, set);
  set.add(() => {
    generation++;
    cached = null;
    inFlight = null;
  });

  async function readPersisted(hash: string): Promise<(IssuedToken & { keyHash: string }) | null> {
    if (!opts.persist) return null;
    const gen = generation;
    const p = await store().read();
    if (gen !== generation || !p || typeof p.accessToken !== 'string' || !(p.expiresAt > Date.now())) return null;
    if (p.keyHash !== undefined && p.keyHash !== hash) return null;
    const token = { accessToken: p.accessToken, expiresAt: p.expiresAt, keyHash: hash };
    if (p.keyHash === undefined) await store().write(token); // 해시 없는 예전 파일 — 지금 키로 표시해 둔다
    return token;
  }

  function startIssue(creds: C, hash: string): Promise<string> {
    const gen = generation;
    const promise = (async () => {
      const t = await opts.issue(creds);
      if (gen === generation) {
        cached = { accessToken: t.accessToken, expiresAt: t.expiresAt, keyHash: hash };
        if (opts.persist) await store().write(cached);
      }
      return t.accessToken;
    })();
    const entry = { hash, gen, promise };
    inFlight = entry;
    promise
      .finally(() => {
        if (inFlight === entry) inFlight = null;
      })
      .catch(() => {
        /* 오류는 promise를 기다리는 호출부가 받는다 */
      });
    return promise;
  }

  return {
    creds: opts.loadCreds,
    async getToken(staleToken?: string): Promise<string> {
      const creds = await opts.loadCreds();
      const hash = credentialKeyHash(opts.keyOf(creds));
      if (!cached || cached.keyHash !== hash || !(cached.expiresAt > Date.now())) {
        cached = null;
        const persisted = await readPersisted(hash);
        // 파일을 읽는 사이 다른 요청의 발급이 끝나 cached가 채워졌으면 그쪽(더 새 것)을 둔다.
        if (!cached) cached = persisted;
      }
      if (cached && cached.accessToken !== staleToken) return cached.accessToken;
      // 진행 중인 발급이 같은 키·같은 세대면 같이 기다린다 — 그 결과는 staleToken과 다른 새 토큰이다.
      if (inFlight && inFlight.hash === hash && inFlight.gen === generation) return inFlight.promise;
      return startIssue(creds, hash);
    },
  };
}
