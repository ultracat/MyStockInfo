// LS증권·DB증권 공용(2026-11-17) — 두 회사의 REST Open API는 같은 계열 시스템이라(TR 코드 CDPCQ04700 등이 겹치고, 토큰 발급·
// 응답 봉투 rsp_cd/rsp_msg·숫자 표기가 같다) 겹치는 부분을 여기 둔다. 각 회사의 요청 함수·봉투 차이는 ls/·db/ 폴더.
//   - 토큰: POST /oauth2/token, form(grant_type=client_credentials, appkey, appsecretkey, scope=oob) → access_token(또는 token)·
//     expires_in(또는 expire_in, 초). 공식 명세표와 예시가 이름을 다르게 적어 둘 다 받는다.
//   - 숫자: 정수 금액은 JSON 숫자, 소수(가격·비율·외화)는 소수 문자열로 온다(두 회사 공식 응답 예시) → xNum이 둘 다 읽는다.
//   - 계좌 거래내역 CDPCQ04700(양쪽 같은 TR·필드): 매매·입출금·배당이 한 표 — 매매·배당 해석을 여기서 같이 한다.
// ⚠⚠ 두 회사 모두 **실제 키로 한 번도 호출하지 않았다**(2026-11-17, 개발자에게 계좌가 없음). 키를 받으면 `npm run check:ls`/`check:db`부터.
import crypto from 'node:crypto';
import { getCredentialFields } from '../credentials';
import { getDataDir } from '../paths';
import { SecretJsonStore } from '../secretJsonStore';
import type { RateLimiter } from './rateLimiter';
import type { BrokerId, TradeRecord } from './types';

export const xStr = (v: unknown): string => String(v ?? '').trim();

/** 숫자 또는 소수 문자열("264000.00"·"-0.18350000"·"1,234") → 숫자. 못 읽으면 0. */
export function xNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = xStr(v).replace(/[,\s]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** 국내 종목번호 → 6자리. "A005930"(DB·LS 일부 TR), "KR7005930003"(ISIN, LS 거래내역 예시), "005930" 모두. */
export function krSymbol(v: unknown): string {
  const s = xStr(v).toUpperCase();
  if (/^KR7[0-9A-Z]{6}\d{3}$/.test(s)) return s.slice(3, 9);
  if (/^[AJQ][0-9A-Z]{6}$/.test(s)) return s.slice(1);
  return s;
}

/** YYYYMMDD → YYYY-MM-DD(빈 값·"00000000"은 ""). */
export function ymdDash(v: unknown): string {
  const s = xStr(v);
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

export const compactDate = (d: string) => d.replace(/-/g, '');
export const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** [from, to]를 최대 1년(같은 해) 구간으로 — DB CDPCQ04700은 조회 기간 최대 12개월(공식 예제), LS는 명세에 없어 같게. */
export function yearWindows(from: string, to: string): Array<[string, string]> {
  if (from > to) return [];
  const out: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const yearEnd = `${start.slice(0, 4)}-12-31`;
    out.push([start, yearEnd < to ? yearEnd : to]);
    start = `${Number(start.slice(0, 4)) + 1}-01-01`;
  }
  return out;
}

// ── 토큰 ───────────────────────────────────────────────────────────────────────
interface StoredToken {
  accessToken: string;
  expiresAt: number;
  keyHash: string;
}

export class XingTokenError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'XingTokenError';
  }
}

/**
 * 토큰 캐시 — `<브로커>-token.json`(SecretJsonStore, 백업에서 빠지는 이름 규칙)에 저장해 재시작 뒤에도 쓰고, 동시 요청은 발급
 * 하나를 공유하고, 앱키를 바꾸면(키 해시) 이전 토큰을 쓰지 않는다. DB는 발급이 **1분에 1건**이고 유효기간 안의 재발급은 같은 토큰을
 * 준다(공식) — 그래서 재발급은 만료·401(무효)일 때만. `getToken(stale)`: 무효라고 본 토큰이 이미 바뀌었으면 또 발급하지 않는다.
 */
export function createXingTokenCache(opts: { broker: BrokerId; label: string; tokenUrl: string; limiter: RateLimiter }) {
  const store = () => new SecretJsonStore<StoredToken>(`${opts.broker}-token.json`, getDataDir());
  let cached: StoredToken | null = null;
  let inFlight: Promise<string> | null = null;
  const keyHash = (k: string) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 16);

  async function creds() {
    const c = await getCredentialFields(opts.broker);
    if (!c?.appKey || !c?.appSecret) throw new Error(`${opts.label} API 키가 설정되지 않았습니다. 설정 화면에서 앱키/시크릿키를 입력해주세요.`);
    return c;
  }

  async function issue(): Promise<string> {
    const c = await creds();
    const body = new URLSearchParams({ grant_type: 'client_credentials', appkey: c.appKey, appsecretkey: c.appSecret, scope: 'oob' });
    const res = await opts.limiter.schedule(() =>
      fetch(opts.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      })
    );
    const text = await res.text();
    if (!res.ok) throw new XingTokenError(`${opts.label} 토큰 발급 실패 (HTTP ${res.status})`, res.status, text);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new XingTokenError(`${opts.label} 토큰 응답을 해석하지 못했습니다`, res.status, text);
    }
    const token = xStr(data.access_token ?? data.token);
    if (!token) throw new XingTokenError(`${opts.label} 토큰 응답에 access_token이 없습니다`, res.status, text);
    const sec = xNum(data.expires_in ?? data.expire_in) || 86400;
    cached = { accessToken: token, expiresAt: Date.now() + (sec - 60) * 1000, keyHash: keyHash(c.appKey) };
    await store().write(cached);
    return token;
  }

  return {
    creds,
    async getToken(staleToken?: string): Promise<string> {
      const hash = keyHash((await creds()).appKey);
      const valid = (t: StoredToken | null) => !!t && t.keyHash === hash && t.expiresAt > Date.now();
      if (!valid(cached)) cached = (await store().read()) ?? null;
      if (valid(cached) && cached!.accessToken !== staleToken) return cached!.accessToken;
      if (!inFlight) inFlight = issue().finally(() => (inFlight = null));
      return inFlight;
    },
  };
}

// ── 계좌 거래내역(CDPCQ04700) 해석 — LS·DB 같은 TR·필드 ────────────────────────────
/** 두 회사의 CDPCQ04700 줄에 공통으로 있는 필드(명세 스냅샷 ls.json·db.json에서 확인). 값은 숫자·문자열 섞임. */
export interface LedgerRow {
  TrdDt?: string;
  TrdNo?: number | string;
  SmryNm?: string;
  CancTpNm?: string;
  IsuNo?: string;
  IsuNm?: string;
  TrdQty?: number | string;
  TrdUprc?: number | string;
  TrdAmt?: number | string;
  AdjstAmt?: number | string;
  CmsnAmt?: number | string;
  TaxSumAmt?: number | string;
  MnyDvdAmt?: number | string;
  Ictax?: number | string;
  Ihtax?: number | string;
  CrcyCode?: string;
  FcurrAmt?: number | string;
  FcurrTrdAmt?: number | string;
}

const isCancel = (r: LedgerRow) => /취소|정정/.test(`${xStr(r.SmryNm)} ${xStr(r.CancTpNm)}`);

/**
 * 매매(QryTp 3) 줄 → 체결. ⚠ 가정(적요 값 목록이 명세에 없음): 적요(`SmryNm`)에 "매수"/"매도". id = `<브로커>-<거래일>-<거래번호>`.
 * 외화 줄(`CrcyCode` USD)은 외화 거래금액(`FcurrTrdAmt`, 없으면 `FcurrAmt`) ÷ 수량을 단가로. 그 밖의 통화는 뺀다(앱 통화 모델이 KRW/USD).
 * 해외 종목번호는 회사마다 형식이 달라(ISIN·심볼) `overseasSymbol`로 바꾼다.
 */
export function mapLedgerTrades(rows: LedgerRow[], prefix: string, overseasSymbol: (raw: string) => string = (s) => s): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const r of rows) {
    const summary = xStr(r.SmryNm);
    const side = summary.includes('매수') ? 'BUY' : summary.includes('매도') ? 'SELL' : null;
    const date = ymdDash(r.TrdDt);
    const quantity = Math.abs(xNum(r.TrdQty));
    const raw = xStr(r.IsuNo);
    if (!side || !date || quantity <= 0 || !raw || isCancel(r)) continue;
    const cur = xStr(r.CrcyCode).toUpperCase() || 'KRW';
    const fee = Math.abs(xNum(r.CmsnAmt));
    const tax = Math.abs(xNum(r.TaxSumAmt));
    const base = { id: `${prefix}-${xStr(r.TrdDt)}-${xStr(r.TrdNo)}`, name: xStr(r.IsuNm) || null, side, quantity, commission: fee > 0 ? fee : null, tax: tax > 0 ? tax : null, executedAt: date } as const;
    if (cur === 'KRW') {
      out.push({ ...base, symbol: krSymbol(raw), price: Math.abs(xNum(r.TrdUprc)), amount: Math.abs(xNum(r.TrdAmt)), currency: 'KRW' });
    } else if (cur === 'USD') {
      const amount = Math.abs(xNum(r.FcurrTrdAmt)) || Math.abs(xNum(r.FcurrAmt));
      out.push({ ...base, symbol: overseasSymbol(raw), price: amount / quantity, amount, currency: 'USD' });
    }
  }
  return out;
}

export interface LedgerDividend {
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  /** 세후(실수령). */
  amount: number;
  tax: number;
  paidDate: string;
  kind: 'dividend' | 'etfDistribution';
}

/**
 * 입출금(QryTp 1) 줄 중 배당·분배 → 배당. DB 공식 예시: 적요 "배당금입금"(SmryNo 1104), `TrdAmt = AdjstAmt = MnyDvdAmt`.
 * ⚠ 가정(세금이 0인 예시뿐이라 확인 못 함): `MnyDvdAmt`(없으면 `TrdAmt`)가 세전, 세금 = `TaxSumAmt`(없으면 소득세+주민세),
 *   세후 = 정산금액(`AdjstAmt`)이 있으면 그것, 없으면 세전 − 세금. 원화 줄만(해외 배당은 회사별 별도 TR — db/dbClient.ts).
 */
export function classifyLedgerDividends(rows: LedgerRow[], opts: { taxDeferred?: boolean } = {}): LedgerDividend[] {
  const out: LedgerDividend[] = [];
  for (const r of rows) {
    const summary = xStr(r.SmryNm);
    if (isCancel(r) || /출금/.test(summary)) continue;
    const kind = summary.includes('분배') ? 'etfDistribution' : summary.includes('배당') || xNum(r.MnyDvdAmt) > 0 ? 'dividend' : null;
    const raw = xStr(r.IsuNo);
    const paidDate = ymdDash(r.TrdDt);
    const cur = xStr(r.CrcyCode).toUpperCase() || 'KRW';
    if (!kind || !raw || !paidDate || cur !== 'KRW') continue;
    const gross = Math.abs(xNum(r.MnyDvdAmt)) || Math.abs(xNum(r.TrdAmt));
    // ISA·연금저축·IRP는 원천징수가 없다(db/accountTaxTypes.ts isTaxDeferredAccount) — 세금 칸에 계산값이 와도 세전 그대로.
    const tax = opts.taxDeferred ? 0 : Math.abs(xNum(r.TaxSumAmt)) || Math.abs(xNum(r.Ictax)) + Math.abs(xNum(r.Ihtax));
    const amount = opts.taxDeferred ? gross : Math.abs(xNum(r.AdjstAmt)) || gross - tax;
    if (amount > 0) out.push({ symbol: krSymbol(raw), name: xStr(r.IsuNm) || krSymbol(raw), currency: 'KRW', amount, tax, paidDate, kind });
  }
  return out;
}
