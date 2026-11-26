// LS증권(구 이베스트) REST Open API — 조회 TR만(주문 안 함). 2026-11-17 추가.
// 정본: 공식 명세 JSON https://openapi.ls-sec.co.kr/api/apis/public/tr-guides.json?download=true(포털 "OPEN API 가이드 다운로드")
// + TR별 가이드의 공식 응답 예시. ⚠ 포털 "시작하기" 페이지 예제(tr_id 헤더·GET·CANO)는 명세와 다르다 — 명세·TR 가이드만 따른다.
// ⚠⚠ **실제 키로 한 번도 호출하지 않았다**(개발자에게 LS 계좌가 없음). 키를 받으면 `npm run check:ls -- --record`부터.
//
// 규약(명세):
// - 전부 POST, `https://openapi.ls-sec.co.kr:8080` + 기능군 경로(/stock/accno, /overseas-stock/accno). 헤더 `authorization: Bearer`,
//   `tr_cd`(TR), `tr_cont`(Y/N), `tr_cont_key`(비어 있어도 항상 보낸다 — 포털 콘솔 코드 주석). 모의투자는 키가 따로(같은 도메인으로 추측).
// - 요청 `{"<TR>InBlock"|"<TR>InBlock1": {...}}`, 응답 `<TR>OutBlock`·`OutBlock1`… + `rsp_cd`/`rsp_msg`. C계열 OutBlock1은 입력을 되돌려
//   주는 블록이라 계좌번호(`AcntNo`)가 온다 — **앱키가 계좌 하나에 묶여(계좌 목록 TR 없음) 계좌번호는 여기서 읽는다**.
// - 성공 판정: 공식 오류코드표가 없다. 예시의 정상 코드 00000·00001·00136, 계속 00133, "조회내역 없음" 00200 — ⚠ 가정: HTTP 200이고
//   `rsp_cd`가 0으로 시작하면 정상(없으면 정상), 그 밖은 오류로 던진다. 실키로 확인할 것.
// - 연속조회: t계열은 본문 `cts_*`(t0424 `cts_expcode`), C계열은 응답 헤더 `tr_cont=Y` + `tr_cont_key`(헤더 정의·00133 예시로 본 추정).
// - 속도: TR별 `transactionPerSec`(t0424 2, C계열 1) — TR마다 리미터.
import { RateLimiter } from '../rateLimiter';
import { redactText } from '../../logRedact';
import { PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import { noteResponse } from '../responseShape';
import type { FetchOpts } from '../types';
import { compactDate, createXingTokenCache, xStr, yearWindows } from '../xingFamily';
import { kstToday } from '../../kstDate';
import { hasCredential } from '../../credentials';
import type { LsRequests, LsResponses } from './lsSpec.gen';

const BASE_URL = 'https://openapi.ls-sec.co.kr:8080';
const MAX_PAGES = 200;

/** 이 앱이 부르는 TR — 경로·초당 건수는 명세(snapshots/ls.json) 그대로. */
const TRS = {
  t0424: { path: '/stock/accno', tps: 2 },
  CSPAQ12200: { path: '/stock/accno', tps: 1 },
  COSOQ00201: { path: '/overseas-stock/accno', tps: 1 },
  CDPCQ04700: { path: '/stock/accno', tps: 1 },
} as const;
export type LsTr = keyof typeof TRS & keyof LsResponses;

const limiters = new Map<string, RateLimiter>();
const limiterFor = (key: string, tps: number) => {
  if (!limiters.has(key)) limiters.set(key, new RateLimiter({ tps }, `LS-${key}`));
  return limiters.get(key)!;
};
const tokens = createXingTokenCache({ broker: 'ls', label: 'LS증권', tokenUrl: `${BASE_URL}/oauth2/token`, limiter: limiterFor('token', 1) });

export class LsApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'LsApiError';
  }
}

export function isLsConfigured(): boolean {
  return hasCredential('ls');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LsPage<T extends LsTr> {
  body: LsResponses[T];
  trCont: string;
  trContKey: string;
}

export async function lsPost<T extends LsTr>(tr: T, input: LsRequests[T], cont?: { key: string }): Promise<LsPage<T>> {
  const { path, tps } = TRS[tr];
  return limiterFor(tr, tps).schedule(async () => {
    let stale: string | undefined;
    for (let attempt = 0; ; attempt++) {
      const token = await tokens.getToken(stale);
      let res: Response;
      let text: string;
      try {
        res = await fetch(`${BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            authorization: `Bearer ${token}`,
            tr_cd: tr,
            tr_cont: cont ? 'Y' : 'N',
            tr_cont_key: cont?.key ?? '',
            mac_address: '', // 법인만 필수(명세)
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(15_000),
        });
        text = await res.text();
      } catch (err) {
        throw new LsApiError(`LS증권 API 연결 오류: ${tr} (${(err as Error).message})`, 0, '');
      }
      if (res.status === 401 && stale === undefined) {
        stale = token;
        continue;
      }
      if (res.status === 429 && attempt < 3) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text);
      } catch {
        if (res.ok) throw new LsApiError(`LS증권 API 응답 해석 실패: ${tr}`, res.status, text);
      }
      const code = xStr(body.rsp_cd);
      if (!res.ok || (code && !code.startsWith('0'))) {
        const msg = redactText(xStr(body.rsp_msg), 120);
        throw new LsApiError(`LS증권 API 오류 ${tr}${code ? ` (${code})` : ` (HTTP ${res.status})`}${msg ? `: ${msg}` : ''}`, res.ok ? 502 : res.status, text);
      }
      noteResponse('ls', tr, body); // 응답 모양 관찰(값 없이) — ls-live.json과 비교·--record 기록
      return { body: body as LsResponses[T], trCont: xStr(res.headers.get('tr_cont')), trContKey: xStr(res.headers.get('tr_cont_key')) };
    }
  });
}

/** C계열 연속조회 — 응답 헤더 `tr_cont=Y`인 동안 `tr_cont_key`로 다음 페이지. 같은 키로 되돌아오면 멈추고, 상한에서는 던진다. */
export async function lsPostAll<T extends LsTr>(tr: T, input: LsRequests[T]): Promise<LsResponses[T][]> {
  const pages: LsResponses[T][] = [];
  const seen = new Set<string>();
  let cont: { key: string } | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await lsPost(tr, input, cont);
    pages.push(page.body);
    if (page.trCont.toUpperCase() !== 'Y' || !page.trContKey || seen.has(page.trContKey)) return pages;
    seen.add(page.trContKey);
    cont = { key: page.trContKey };
  }
  throw new LsApiError(`LS증권 연속조회가 ${MAX_PAGES}페이지를 넘어 끝까지 받지 못했습니다: ${tr}`, 502, '');
}

/** 블록 → 줄 배열(명세는 객체라고 해도 공식 예시가 배열인 블록이 있다 — COSOQ00201 OutBlock3·4). */
export function rowsOf<R>(v: R | readonly R[] | null | undefined): R[] {
  if (Array.isArray(v)) return (v as R[]).filter((r) => !!r && typeof r === 'object');
  return v && typeof v === 'object' ? [v as R] : [];
}

// ── 계좌·예수금 ────────────────────────────────────────────────────────────────
/** 주식계좌 예수금·잔고 요약(CSPAQ12200) — OutBlock1이 되돌려 주는 계좌번호(`AcntNo`)와 OutBlock2 예수금(`Dps`). */
export function fetchLsAccount(opts: FetchOpts = {}) {
  return withCache(
    'ls:account',
    PORTFOLIO_TTL_MS,
    async () => {
      const { body } = await lsPost('CSPAQ12200', { CSPAQ12200InBlock1: { BalCreTp: '1' } });
      const echo = rowsOf(body.CSPAQ12200OutBlock1)[0];
      const accountNo = xStr(echo?.AcntNo);
      if (!accountNo) throw new LsApiError('LS증권 CSPAQ12200 응답에 계좌번호(AcntNo)가 없습니다', 502, '');
      return { accountNo, summary: rowsOf(body.CSPAQ12200OutBlock2)[0] ?? null };
    },
    opts
  );
}

// ── 잔고 ───────────────────────────────────────────────────────────────────────
/** 국내 주식잔고2(t0424) — 평균단가 기준(prcgb 1)·체결기준(chegb 2)·제비용 포함(charge 1). 본문 `cts_expcode`로 연속조회. */
export function fetchLsDomesticBalance(opts: FetchOpts = {}) {
  return withCache(
    'ls:balance',
    PORTFOLIO_TTL_MS,
    async () => {
      type Row = NonNullable<LsResponses['t0424']['t0424OutBlock1']>[number];
      const items: Row[] = [];
      let summary: ReturnType<typeof rowsOf<NonNullable<LsResponses['t0424']['t0424OutBlock']>>>[number] | null = null;
      const seen = new Set<string>();
      let cts = '';
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await lsPost('t0424', { t0424InBlock: { prcgb: '1', chegb: '2', dangb: '0', charge: '1', cts_expcode: cts } }, cts ? { key: '' } : undefined);
        summary ??= rowsOf(page.body.t0424OutBlock)[0] ?? null;
        items.push(...rowsOf(page.body.t0424OutBlock1));
        const next = xStr(rowsOf(page.body.t0424OutBlock)[0]?.cts_expcode);
        if (!next || seen.has(next)) return { summary, items };
        seen.add(next);
        cts = next;
      }
      throw new LsApiError(`LS증권 잔고 연속조회가 ${MAX_PAGES}페이지를 넘었습니다`, 502, '');
    },
    opts
  );
}

/** 해외주식 종합잔고평가(COSOQ00201) — OutBlock3 통화별(외화예수금 `FcurrDps`), OutBlock4 종목. 기준일은 오늘(KST). */
export function fetchLsOverseasBalance(opts: FetchOpts = {}) {
  return withCache(
    'ls:overseas-balance',
    PORTFOLIO_TTL_MS,
    async () => {
      const { body } = await lsPost('COSOQ00201', {
        COSOQ00201InBlock1: { RecCnt: 1, BaseDt: compactDate(kstToday()), CrcyCode: 'ALL', AstkBalTpCode: '00' },
      });
      return { currencies: rowsOf(body.COSOQ00201OutBlock3), items: rowsOf(body.COSOQ00201OutBlock4) };
    },
    opts
  );
}

// ── 거래내역 ───────────────────────────────────────────────────────────────────
/** 계좌 거래내역(CDPCQ04700) — `qryTp`: 1 입출금 · 2 입출고 · 3 매매. 국내·해외(외화 줄) 모두. 기간 상한이 명세에 없어 1년씩 나눠 부른다. */
export function fetchLsLedger(from: string, to: string, qryTp: '1' | '2' | '3', opts: FetchOpts = {}) {
  return withCache(
    `ls:ledger:${qryTp}:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const rows: NonNullable<LsResponses['CDPCQ04700']['CDPCQ04700OutBlock3']> = [];
      for (const [a, b] of yearWindows(from, to)) {
        const pages = await lsPostAll('CDPCQ04700', {
          CDPCQ04700InBlock1: { RecCnt: 1, QryTp: qryTp, QrySrtDt: compactDate(a), QryEndDt: compactDate(b), SrtNo: 0, PdptnCode: '01', IsuLgclssCode: '00', IsuNo: '' },
        });
        for (const p of pages) rows.push(...rowsOf(p.CDPCQ04700OutBlock3));
      }
      return rows;
    },
    opts
  );
}
