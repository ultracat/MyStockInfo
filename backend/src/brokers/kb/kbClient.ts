import { getCredentialFields, hasCredential } from '../../credentials';
import { RateLimiter } from '../rateLimiter';
import { createTokenManager } from '../tokenManager';
import { fetchWithTimeout } from '../../http/fetchWithTimeout';
import type { HoldingPosition, TradeRecord } from '../types';
import { noteResponse } from '../responseShape';
import type { KbRequests, KbResponses } from './kbSpec.gen';

/** 이 앱이 부르는 KB TR — 공식 명세(계좌 TR은 고정 기준 커밋)에서 만든 kbSpec.gen.ts의 키. */
export type KbTr = keyof KbResponses;

// kbsecurities/kb-openapi(공식 레포, example/python/README.md) 확인 — B2C(개인용)
// Open API는 운영 서버만 있고 별도 샌드박스/모의투자 서버는 제공되지 않는다.
const BASE_URL = 'https://developer.kbsec.com:32484';

// 공식 example 레포에 Rate limit 수치가 명시돼 있지 않다(가이드 페이지에도 "호출
// 제한 정책"이라고만 언급되고 세부 수치는 없음) — 실제 응답 헤더에서 근거를 찾을
// 때까지 KIS(4tps)보다 더 보수적인 값으로 시작한다. 429/제한 관련 에러가 실측되면
// RateLimiter의 penalizeUntil로 자동 보정된다(kisLimiter와 같은 메커니즘).
const kbLimiter = new RateLimiter({ tps: 2 }, 'KB');

export class KbApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = 'KbApiError';
  }
}

async function requireCredentials() {
  const creds = await getCredentialFields('kb');
  if (!creds) {
    throw new Error('KB증권 API 키가 설정되지 않았습니다. 설정 화면에서 appKey/appSecret을 입력해주세요.');
  }
  return creds;
}

export function isKbConfigured(): boolean {
  return hasCredential('kb');
}

// accountId는 KB API로 보내는 값이 아니라(KB가 계좌번호를 요청 파라미터로 안
// 받음) routes/kb.ts가 "동기화 결과를 어느 로컬 accountId에 쓸지" 정하는 데만
// 쓰는 로컬 설정값이다 — credentialFields.ts에 세 번째 필드로 등록해뒀다.
export async function getKbLinkedAccountId(): Promise<string | null> {
  const creds = await getCredentialFields('kb');
  const accountId = creds?.accountId?.trim();
  return accountId ? accountId : null;
}

interface KbTokenResponseBody {
  access_token?: string;
  accessToken?: string;
  expires_in?: number;
  expiresIn?: number;
  [key: string]: unknown;
}

interface KbEnvelope<T = Record<string, unknown>> {
  dataHeader?: { ipAddr?: string; macAddr?: string; [key: string]: unknown };
  dataBody?: T;
  [key: string]: unknown;
}

// example/python/README.md(공식): 토큰 발급 요청도 dataHeader(ipAddr/macAddr만
// 사용) + dataBody({appKey, appSecret, grantType:"client_credentials"}) 포맷으로
// 감싼다. 응답의 access_token은 dataBody.access_token 경로.
//
// kis-token.json과 같은 이유로 kb-token.json에 영속화한다 — 이 프로젝트 dev 워크플로가 백엔드를 고칠 때마다 Electron을
// 재시작하므로, 메모리 캐시만 쓰면 재시작마다 토큰을 새로 발급받게 된다. KB의 토큰 발급 빈도 제한은 공식 문서에 수치가
// 없어(KIS의 EGW00133 같은 규정은 확인 못함) 일단 안전하게 영속화해둔다. 동시 발급 공유·401 재발급 경쟁 방지(staleToken)·
// 앱키 해시·자격증명 변경 시 무효화는 공용 tokenManager.ts(2026-11-26 — 예전엔 401마다 무조건 재발급, 키를 바꿔도 옛 토큰 사용).
const tokens = createTokenManager({
  broker: 'kb',
  persist: true,
  loadCreds: requireCredentials,
  keyOf: (creds) => creds.appKey,
  async issue(creds) {
    const res = await kbLimiter.schedule(() =>
      fetchWithTimeout(`${BASE_URL}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataHeader: { ipAddr: '', macAddr: '' },
          dataBody: {
            appKey: creds.appKey,
            appSecret: creds.appSecret,
            grantType: 'client_credentials',
          },
        }),
        label: 'KB증권',
      })
    );

    const text = await res.text();
    if (!res.ok) {
      throw new KbApiError('KB증권 토큰 발급 실패', res.status, text);
    }

    let parsed: KbEnvelope<KbTokenResponseBody>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new KbApiError('KB증권 토큰 발급 응답이 JSON이 아닙니다', res.status, text);
    }

    const body = parsed.dataBody ?? (parsed as unknown as KbTokenResponseBody);
    const accessToken = body.access_token ?? body.accessToken;
    if (!accessToken) {
      throw new KbApiError('KB증권 토큰 발급 응답에서 access_token을 찾지 못했습니다', res.status, text);
    }

    // expires_in이 응답에 없을 수 있어(공식 example에 명시 안 됨) 55분을 보수적
    // 기본값으로 쓴다 — 실제 값이 이보다 짧으면 API 호출 시 401을 받게 되는데,
    // kbPost가 401을 만나면 토큰을 다시 받아 한 번 재시도한다.
    const expiresInSec = body.expires_in ?? body.expiresIn ?? 55 * 60;
    return { accessToken, expiresAt: Date.now() + (expiresInSec - 60) * 1000 };
  },
});

// example/python/README.md(공식): 일반 TR 조회는 dataHeader(토큰 발급과 동일하게
// ipAddr/macAddr만) + dataBody(TR별 조회조건)로 감싸고, 헤더에 appKey와
// "Authorization: bearer <token>"(소문자 bearer 고정)을 싣는다.
// 실측 확인(2026-08-17, 실제 appKey로 SSQM2952/SSQM1801/SWQA2301 호출): 계좌
// 관련 TR은 example/python/README.md의 설명("서버에서 호출하는 경우 비워서
// 보내도 문제없음")과 달리 ipAddr/macAddr가 빈 문자열이면 "입력 전문
// [dataHeader.ipAddr/macAddr]를 확인해 주세요"로 거부된다(투자정보 카테고리
// 얘기였던 듯) — 데스크톱 앱이라 사용자의 실제 공인 IP/MAC을 알 방법이 없으므로
// 형식만 맞춘 placeholder 값을 채운다(감사 로그용 필드로 보이고, 실제 값 검증은
// 안 하는 것으로 확인됨).
const DEFAULT_TR_DATA_HEADER = { ipAddr: '127.0.0.1', macAddr: '00:00:00:00:00:00' };

export async function kbPost<T extends KbTr>(
  tr: T,
  dataBody: Partial<KbRequests[T]>,
  dataHeader: { ipAddr: string; macAddr: string } = DEFAULT_TR_DATA_HEADER
): Promise<KbEnvelope<KbResponses[T]>> {
  const creds = await requireCredentials();
  const endpoint = `/api/v1/${tr.toLowerCase()}`;

  const doFetch = async (token: string) =>
    fetchWithTimeout(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      label: 'KB증권',
      headers: {
        'Content-Type': 'application/json',
        appKey: creds.appKey,
        Authorization: `bearer ${token}`,
      },
      body: JSON.stringify({
        dataHeader,
        dataBody,
      }),
    });

  return kbLimiter.schedule(async () => {
    let token = await tokens.getToken();
    let res = await doFetch(token);

    if (res.status === 401) {
      // 실패한 토큰을 넘긴다 — 그새 다른 요청이 이미 새로 받았으면 또 발급하지 않고 그걸 쓴다.
      token = await tokens.getToken(token);
      res = await doFetch(token);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new KbApiError(`KB증권 API 호출 실패 (${endpoint})`, res.status, text);
    }

    let parsed: KbEnvelope<KbResponses[T]>;
    try {
      parsed = JSON.parse(text) as KbEnvelope<KbResponses[T]>;
    } catch {
      throw new KbApiError(`KB증권 API 응답이 JSON이 아닙니다 (${endpoint})`, res.status, text);
    }
    noteResponse('kb', tr, parsed); // 응답 모양 관찰(값 없이) — kb-live.json과 비교·--record 기록
    return parsed;
  });
}

function numFromKb(v: unknown): number {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

function strFromKb(v: unknown): string {
  return String(v ?? '').trim();
}

export function marketFromCurrency(currency: string): 'KR' | 'US' | null {
  return currency === 'KRW' ? 'KR' : currency === 'USD' ? 'US' : null;
}

// KB증권 Open API는 appKey/appSecret 자체가 특정 계좌 하나에 이미 묶여 있다(실측
// 확인 — SSQM1801/SSQM2952/SWQA2301 어디에도 계좌번호를 넘기는 입력 필드가 없고,
// 계좌 목록을 조회하는 TR도 이 스펙(93종) 안에 없다 — 토스처럼 계좌 목록 API가
// 있는 것도, KIS처럼 계좌번호를 매 요청에 실어 보내는 것도 아니다). 그래서 이
// 파일은 `BrokerAdapter` 전체를 구현하지 않고(계좌 여러 개를 넘겨받는 인터페이스와
// 안 맞음), routes/kb.ts가 "지금 연결된 그 계좌 하나"를 동기화하는 용도로만 직접
// 가져다 쓴다 — 실제로 어떤 계좌가 연결돼 있는지는 KB Open API 포털에서 앱 등록 시
// 사용자가 정한 것이고, 이 앱은 그 결과를 알 방법이 없다(계좌번호를 응답으로
// 돌려주는 필드도 없음). 사용자가 Settings에서 그 계좌의 실제 accountId를 직접
// 지정해 로컬 저장소에 동기화한다.
//
// 필드 매핑 근거: kbsecurities/kb-openapi(공식) frontend/src/app/openapi-test/
// samples.generated.json의 SSQM2952(계좌자산평가) outputSpec — is_cd/is_nm/hld_q/
// byng_amt/now_prc/byng_avr_prc/val_amt/val_pl/val_yld/crncy_cd/mkt_clsf. 실제
// appKey로 호출해 요청 포맷(제약 파라미터)까지는 확인했지만, 연결된 계좌가 현재
// 비어 있어(실측, 2026-08-17) 0이 아닌 실제 값으로 필드 단위 검증은 못 했다 —
// 특히 is_cd가 6자리 단축코드인지 12자리 표준(ISIN)코드인지 확인 불가라 있는
// 그대로(trim만) symbol에 넣는다. 실제 보유종목이 들어오면 반드시 재검증할 것.
export async function fetchKbPortfolio(): Promise<HoldingPosition[]> {
  const res = await kbPost('SSQM2952', {
    excg_mktpr_ccd: 'A',
  });
  const rows = res.dataBody?.Record1 ?? [];

  return rows.map((r) => {
    const purchaseAmount = numFromKb(r.byng_amt);
    const marketValue = numFromKb(r.val_amt);
    return {
      symbol: strFromKb(r.is_cd),
      name: strFromKb(r.is_nm),
      // 공식 명세(SSQM2952)엔 시장 필드가 없다 — 예전 코드는 명세에 없는 `mkt_clsf`를 읽어 늘 null이었다(2026-11-17 생성 타입이
      // 짚음). 통화로 정한다(토스·KIS와 같은 KR/US 관례).
      market: marketFromCurrency(strFromKb(r.crncy_cd)),
      currency: strFromKb(r.crncy_cd) || null,
      quantity: numFromKb(r.hld_q),
      lastPrice: numFromKb(r.now_prc),
      averagePurchasePrice: numFromKb(r.byng_avr_prc),
      purchaseAmount,
      marketValue,
      profitLossAmount: numFromKb(r.val_pl),
      // KIS의 evlu_pfls_rt와 같은 관례(백분율 숫자 문자열)로 가정해 100으로
      // 나눈다 — KIS adapter(kisAdapter.ts)와 동일 패턴, 실측 미검증.
      profitLossRate: numFromKb(r.val_yld) / 100,
      commission: null,
      tax: null,
    } satisfies HoldingPosition;
  });
}

// SWQA2301(계좌원장 거래내역 조회)만 시작일/종료일 범위를 받는다 — 트레이딩
// 카테고리의 SSQM2341(계좌별주문체결조회)은 실측 결과 단일 ordr_dt(주문일자) 없이는
// "주문일자를 확인하십시오"로 거부돼(2026-08-17) 날짜 범위 조회에 안 맞는다.
// inq_clsf5/inq_clsf6('1')로 매수/매도만 필터링해서 입금/출금/입고/출고 같은
// 비매매 거래를 서버 단에서 제외한다 — smry_nm(적요명)의 "매수"/"매도" 텍스트로
// side를 가른다(dl_typ_cd 같은 숫자 코드의 정확한 의미를 실측으로 확인 못 해서,
// KB가 이미 한글로 내려주는 라벨을 그대로 신뢰하는 쪽이 더 안전하다고 판단).
// SIQM4900(종목기본정보, "투자정보" 카테고리 — 계좌 무관) — 종목코드로 종목명을
// 조회하는 마스터데이터 API. 공식 스펙(kbsecurities/kb-openapi
// frontend/src/app/openapi-test/samples.generated.json, id "Tkb_SIQM4900_B2C",
// checked 2026-08-17) 확인 — input `stnd_is_cd`(표준종목코드, 예시가 6자리
// "005930"), output `hngl_is_nm`(한글종목명). `stockNameResolver.ts`의
// `resolveStockNames`가 토스/KIS 둘 다 실패한 나머지에 대한 마지막 대체 조회로
// 쓴다(토스 → KIS → KB 순서 중 3번째). **다른 KB TR들처럼 앱 등록 시 이 TR에 대한
// 권한이 없으면 호출이 거부될 수 있다**(SSQM0005가 그랬던 전례, backend/CLAUDE.md
// "KB증권 Open API" 절 참고) — 그 경우도 예외를 던지지 않고 null을 돌려줘서 다음
// 단계(CSV의 name 컬럼 직접 입력)로 자연스럽게 넘어가게 한다.
export async function fetchKbStockName(symbol: string): Promise<string | null> {
  try {
    const res = await kbPost('SIQM4900', { stnd_is_cd: symbol });
    const name = res.dataBody?.hngl_is_nm?.trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function fetchKbTradeHistory(from: string, to: string): Promise<TradeRecord[]> {
  // ⚠ 공식 명세(고정 기준 159480c)엔 연속조회 키 `nxt_key`(입력·출력)가 있다 — 지금은 첫 페이지만 받는다. 연동 계좌가 0건이라 연속조회가
  //   실제로 어떻게 오는지 확인할 수 없어 그대로 둔다(거래가 생기면 `check:kb`로 nxt_key가 오는지 보고 연속조회를 붙일 것).
  const res = await kbPost('SWQA2301', {
    inq_clsf: '0',
    inq_clsf5: '1',
    inq_clsf6: '1',
    strt_dt: from.replace(/-/g, ''),
    end_dt: to.replace(/-/g, ''),
    srt_clsf: '2',
  });
  const rows = res.dataBody?.Record1 ?? [];

  return rows.map((r) => {
    const dlDt = strFromKb(r.dl_dt);
    const executedAt = dlDt.length === 8 ? `${dlDt.slice(0, 4)}-${dlDt.slice(4, 6)}-${dlDt.slice(6, 8)}` : dlDt;
    const smryNm = strFromKb(r.smry_nm);
    const currencyName = strFromKb(r.crncy_clsf_nm);

    return {
      id: `${dlDt}-${strFromKb(r.dl_sq)}`,
      symbol: strFromKb(r.stnd_is_cd),
      name: strFromKb(r.is_nm) || null,
      side: smryNm.includes('매수') ? 'BUY' : 'SELL',
      quantity: numFromKb(r.q),
      price: numFromKb(r.dl_uprc),
      amount: numFromKb(r.dl_amt),
      currency: currencyName.includes('원') ? 'KRW' : currencyName.includes('달러') || currencyName.includes('USD') ? 'USD' : currencyName || 'KRW',
      commission: numFromKb(r.fee),
      tax: numFromKb(r.dl_tx),
      executedAt,
    } satisfies TradeRecord;
  });
}
