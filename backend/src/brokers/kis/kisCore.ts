// 한국투자증권 Open API 공통부 — 기본 URL·속도 제한·토큰(파일 캐시, 하루 발급 제한 보호)·요청 함수(kisGet).
// kisClient.ts를 2026-11-17 네 파일로 나눴다(kisCore·kisDomestic·kisStockDetail·kisOverseas). 다른 코드는 계속 kisClient.ts에서 import한다.
import { getCredentialFields, hasCredential } from '../../credentials';
import { RateLimiter } from '../rateLimiter';
import { getDataDir } from '../../paths';
import { SecretJsonStore } from '../../secretJsonStore';
import type { KisParamNames, KisResponses } from './kisSpec.gen';
import { noteKisResponse } from './kisResponseShape';

/** 이 앱이 부르는 KIS TR — 공식 예제 카탈로그·실제 응답 기록에서 만든 kisSpec.gen.ts의 키(`npm run kis:types`). */
export type KisTrId = keyof KisResponses;
/** 그 TR의 요청 파라미터 — 공식 예제에 없는 이름을 보내면 컴파일 오류다. */
export type KisParams<T extends KisTrId> = Partial<Record<KisParamNames[T], string>>;
type Elem<V> = V extends readonly (infer E)[] ? E : V;
/** 그 TR 응답 블록의 한 줄(배열이면 원소). 실측한 블록은 필드가 필수, 실측 전 블록은 선택. */
export type KisRow<T extends KisTrId, B extends keyof KisResponses[T]> = Elem<NonNullable<KisResponses[T][B]>>;

// koreainvestment/open-trading-api (examples_user/kis_auth.py, checked
// 2026-08-12): real-trading base URL. Paper trading
// (https://openapivts.koreainvestment.com:29443) isn't wired up here — this
// app is for viewing real holdings, not testing.
const BASE_URL = 'https://openapi.koreainvestment.com:9443';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// KIS's repo README doesn't publish an exact REST TPS figure in prose (only
// that paper-trading accounts are more restricted — "모의투자 계좌는 REST API
// 호출 제한이 낮습니다"), but the official example client
// (examples_user/kis_auth.py's smart_sleep) hardcodes the real numbers it
// paces itself to: 0.05s between calls on a real-trading account (20/s),
// 0.5s on paper trading (2/s). We stay well under that real-trading figure
// (4/s) since this is a background desktop app, not a latency-sensitive
// trading client, and because account-tier limits can be stricter than the
// example's default. EGW00201 (in the response body — see kisGet below) is
// the live signal that our effective limit is even tighter than that, and
// pushes future calls' pacing out via `penalizeUntil`, not just retries the
// one call that failed.
export const kisLimiter = new RateLimiter({ tps: 4 }, 'KIS');

// 주식일별주문체결조회(inquire-daily-ccld)는 실측 결과 inquire-balance와 같은 4건/초
// 페이싱으로도 EGW00201(초당 거래건수 초과)에 훨씬 잘 걸린다(위 kisLimiter 주석,
// backend/CLAUDE.md 참고) — 토큰/잔고조회와 한 페이싱을 공유하면 이 TR 하나 때문에
// 계정 전체가 더 자주 걸리므로, 토스 클라이언트가 TR/엔드포인트 그룹별로 별도
// RateLimiter를 두는 것(rateLimitGroups.ts)과 같은 방식으로 이 TR 전용 인스턴스를
// 분리해 더 보수적으로(1건/초) 페이싱한다. 페이지네이션(최대 50페이지) + "3개월
// 이내/이전" TR 분할로 짧은 시간에 여러 번 연속 호출되는 TR이라 재시도 여유도 더
// 필요해서, kisGet 호출 시 maxAttempts도 이 TR만 늘려서 넘긴다.
/** 연속조회 상한 — 닿으면 던진다(조용히 끊으면 배당 동기화·저장소 갱신이 잘린 목록으로 기존 기록을 지운다, 2026-11-17). */
export const MAX_PAGES = 200;

export const kisDailyCcldLimiter = new RateLimiter({ tps: 1 }, 'KIS-DailyCcld');

interface KisTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  access_token_token_expired?: string; // "YYYY-MM-DD HH:mm:ss"
}

export interface KisEnvelope {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  // 대부분의 TR(잔고조회/일별체결조회)은 output1/output2를 쓰지만, 단일
  // 결과셋만 돌려주는 TR(주식현재가 시세 등)은 원장 JSON 키가 그냥 `output`
  // 하나다(공식 예제 kis_auth.py의 APIResp가 응답 JSON 키를 그대로
  // namedtuple 필드로 쓰는 걸 확인 — TR마다 실제 키가 다름, checked 2026-08-17).
  output?: unknown;
  output1?: unknown;
  output2?: unknown;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
  /** 국내휴장일조회(CTCA0903R)는 100 없는 이름으로 준다(공식 예제). */
  ctx_area_fk?: string;
  ctx_area_nk?: string;
}

// 응답 줄 타입은 실제 응답 기록(kis-live.json)과 공식 예제에서 생성한 kisSpec.gen.ts를 그대로 쓴다(2026-11-17 — 예전엔 손으로 옮긴
// 인터페이스에 `[key: string]: unknown`을 붙여 필드 이름 오타가 컴파일에서 안 잡혔다).
export type KisHoldingItem = KisRow<'TTTC8434R', 'output1'>;
export type KisAccountSummary = KisRow<'TTTC8434R', 'output2'>;
/** 주식일별주문체결조회 output1 — 3개월 이내(TTTC0081R)·이전(CTSC9215R) TR이 같은 모양이다(실측). */
export type KisDailyCcldItem = KisRow<'TTTC0081R', 'output1'>;

export class KisApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'KisApiError';
  }
}

export async function requireCredentials() {
  const creds = await getCredentialFields('kis');
  if (!creds) {
    throw new Error('한국투자증권 API 키가 설정되지 않았습니다. 설정 화면에서 앱키/앱시크릿/계좌번호를 입력해주세요.');
  }
  return creds;
}

interface StoredKisToken {
  accessToken: string;
  expiresAt: number;
}

// KIS caps token issuance at 1 per minute (EGW00133) and tokens are valid up
// to ~24h, so — unlike a plain in-memory cache — this must survive a backend
// restart: this project's dev workflow requires rebuilding + restarting
// Electron on every backend change (see CLAUDE.md), which previously reset
// an in-memory-only cache and immediately re-hit the 1/min limit on the next
// holdings load.
const tokenStore = () => new SecretJsonStore<StoredKisToken>('kis-token.json', getDataDir());
let cachedToken: StoredKisToken | null = null;

async function loadCachedToken(): Promise<StoredKisToken | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken;
  const persisted = await tokenStore().read();
  if (persisted && persisted.expiresAt > Date.now()) {
    cachedToken = persisted;
    return cachedToken;
  }
  return null;
}

async function fetchTokenUncached(): Promise<string> {
  const creds = await requireCredentials();

  const res = await kisLimiter.schedule(() =>
    fetch(`${BASE_URL}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: creds.appKey,
        appsecret: creds.appSecret,
      }),
    })
  );

  const text = await res.text();
  if (!res.ok) {
    throw new KisApiError('한국투자증권 토큰 발급 실패', res.status, text);
  }

  const data = JSON.parse(text) as KisTokenResponse;
  const expiresInSec = data.expires_in ?? 86400;
  // 60s safety buffer before expiry.
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (expiresInSec - 60) * 1000 };
  await tokenStore().write(cachedToken);
  return cachedToken.accessToken;
}

// 캐시된 토큰이 만료/부재 상태일 때 동시에 들어온 호출들이 각자 fetchTokenUncached를
// 부르면 KIS 토큰을 중복 발급하게 된다 — 문서화된 "1일 1회 발급 제한"(EGW00133,
// kis-token.json 주석 참고)에 걸리면 그날 하루 종일 API가 막힌다. in-flight
// 프로미스를 공유해서 동시 요청이 실제 발급 요청 하나만 타게 한다.
let inFlightFetch: Promise<string> | null = null;

function fetchToken(): Promise<string> {
  if (!inFlightFetch) {
    inFlightFetch = fetchTokenUncached().finally(() => {
      inFlightFetch = null;
    });
  }
  return inFlightFetch;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const token = await loadCachedToken();
    if (token) return token.accessToken;
  }
  return fetchToken();
}

/**
 * KIS reports application-level errors inside a 200 response body
 * (`rt_cd`/`msg_cd`/`msg1`), not via HTTP status — confirmed against
 * examples_user/kis_auth.py's APIResp wrapper. `EGW00201` is the
 * documented "초당 거래건수 초과" (per-second call count exceeded) code, so
 * that's what triggers our backoff-and-retry here (1s, 2s, 4s + jitter),
 * separate from the Toss client's HTTP-429/header-based approach.
 */
/**
 * `trCont` is KIS's continuation flag for paginated (연속조회) TRs — pass ''
 * on the first call and 'N' on follow-ups, echoing back the `ctx_area_fk100`/
 * `ctx_area_nk100` values the previous page returned in its body (per
 * examples_user/kis_auth.py's `_url_fetch`/`smart_sleep` pattern). The
 * response's own `tr_cont` header (returned here) is 'M' or 'F' when another
 * page is available. inquire-balance (this file's only other caller) never
 * pages, so it just omits the param and gets the default ''.
 */
export async function kisGet<T extends KisTrId>(
  path: string,
  trId: T,
  params: KisParams<T>,
  trCont = '',
  limiter: RateLimiter = kisLimiter,
  maxRetries = 3
): Promise<KisEnvelope & KisResponses[T] & { trCont: string }> {
  const creds = await requireCredentials();
  const query = new URLSearchParams(params as Record<string, string>);

  const doFetch = async (token: string) =>
    fetch(`${BASE_URL}${path}?${query}`, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'text/plain',
        authorization: `Bearer ${token}`,
        appkey: creds.appKey,
        appsecret: creds.appSecret,
        tr_id: trId,
        tr_cont: trCont,
        custtype: 'P',
      },
    });

  return limiter.schedule(async () => {
    let token = await getToken();

    for (let attempt = 0; ; attempt++) {
      let res = await doFetch(token);

      if (res.status === 401) {
        token = await getToken(true);
        res = await doFetch(token);
      }

      const text = await res.text();

      let json: KisEnvelope | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      // 문서상 EGW00201/EGW00215는 "200 응답 바디 안의 rt_cd/msg_cd"로 온다고
      // 되어 있지만, 실사용 중 부하가 몰리면 같은 msg_cd가 담긴 바디를 HTTP
      // 500으로도 보낸다(실측: `inquire-daily-ccld`에 짧은 간격으로 여러 요청을
      // 동시에 보냈더니 res.status===500 + 이 msg_cd 조합이 실제로 나왔다).
      // 그래서 이 판단은 res.ok 여부보다 먼저 한다 — 그래야 500으로 온
      // rate-limit 에러도 재시도/penalizeUntil을 타고, res.ok 체크가 먼저면 이
      // 분기에 닿기도 전에 곧장 throw돼서 재시도 로직 자체가 무력화된다(실제로
      // 그렇게 프론트까지 에러가 새어나간 걸 확인하고 고쳤다).
      //  - EGW00201 ("초당 거래건수를 초과하였습니다", no "원장" mention):
      //    OUR OWN per-account quota — slow down every future call through
      //    this limiter, not just retry this one, since our steady-state
      //    pacing (see kisLimiter above) is apparently still faster than
      //    what this account/tier actually allows.
      //  - EGW00215 ("원장에서 허용 가능한 초당 거래건수를 초과하였습니다"):
      //    a ledger-wide 120 TPS cap shared across *all* KIS customers on
      //    this specific (heavy) TR, unrelated to our own pacing — the doc
      //    explicitly says to just retry, so we do, without penalizing our
      //    own limiter for another customer's traffic.
      if (json && (json.msg_cd === 'EGW00201' || json.msg_cd === 'EGW00215')) {
        const backoffMs = 2 ** attempt * 1000 + Math.random() * 250;
        if (json.msg_cd === 'EGW00201') {
          limiter.penalizeUntil(Date.now() + backoffMs);
        }
        if (attempt < maxRetries) {
          await sleep(backoffMs);
          continue;
        }
        throw new KisApiError(`한국투자증권 API 오류 (${json.msg_cd}): ${json.msg1}`, res.status, text);
      }

      if (!res.ok) {
        throw new KisApiError(`한국투자증권 API 호출 실패: ${path}`, res.status, text);
      }
      if (!json) {
        throw new KisApiError(`한국투자증권 API 응답 파싱 실패: ${path}`, res.status, text);
      }
      if (json.rt_cd !== '0') {
        throw new KisApiError(`한국투자증권 API 오류 (${json.msg_cd}): ${json.msg1}`, res.status, text);
      }

      // 응답 모양 관찰(값 없이) — 기록(kis-live.json)과 필드가 달라졌으면 로그 파일에 한 번 경고, kis:record면 모양을 모은다.
      noteKisResponse(trId, json as unknown as Record<string, unknown>);
      return { ...(json as KisEnvelope & KisResponses[T]), trCont: res.headers.get('tr_cont') ?? '' };
    }
  });
}

export function isKisConfigured(): boolean {
  // Existence check only — see the matching comment in tossClient.ts.
  return hasCredential('kis');
}
