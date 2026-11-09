import { fetchTossAccounts, fetchTossTransactions, type TossTransaction } from './tossClient';
import { listDividends, replaceSyncedDividends, type DividendCurrency, type NewDividendInput } from '../../db/dividends';
import { listAccountLabels } from '../../db/accountLabels';
import { listHoldings } from '../../db/holdingsStore';
import { listTrades } from '../../db/tradesStore';
import { resolveStockNames } from '../../stockNameResolver';
import type { DividendSyncKind, DividendSyncResult } from '../dividendSyncTypes';

// 토스증권 배당 동기화 — 공식 거래내역 API(`GET /api/v1/transactions`)의 배당을 **API 우선으로 로컬에 덮어쓴다**:
// 토스 계좌의 배당 기록은 동기화할 때마다 API 내용으로 통째로 교체된다(2026-11-09 사용자 결정). 그래서
// 토스 배당 행은 화면 수정·CSV/Sheets 가져오기 대상이 아니다(rowOwnership.ts의 `isDividendSyncOwned`).
//
// 아래 분류 규칙은 2026-11-09 사용자가 직접 입력해 온 토스 배당 수백 건을 API와 한 건씩 대조해
// 확인한 것이다(전부 설명됨, 날짜 차이 0일):
// - `DIVIDEND`: 일반 배당. 저장 금액은 세후(`netAmount`), 세금은 `tax`(배당 기록의 `amount`는 세후 기준).
//   미국 배당은 현지 원천징수가 이미 빠진 금액이라 tax=0, amount=netAmount.
// - **국내 ETF 분배금은 `DIVIDEND`가 아니라 `DEPOSIT`(symbol 있음, KRW)로 온다.**
// - **종목이 붙은 USD `DEPOSIT`은 "외화세금환급"**(토스 앱 라벨로 확인 — 미국 ETF 배당의
//   원천징수분이 이듬해 원금반환 재분류로 돌려받는 돈, 배당 회차마다 1건). 사용자 결정으로
//   배당 기록에 넣되 메모 `외화세금환급`을 붙인다.
// - **우선주 배당은 보통주 코드·보통주 ISIN으로 온다**(123455 → 123450). 저장 코드는 보유·매매한
//   같은 회사 코드를 따른다(`toHeldShareClass`).

export const TAX_REFUND_MEMO = '외화세금환급';

export interface TossDividendCandidate {
  symbol: string;
  currency: DividendCurrency;
  /** 세후(실수령). */
  amount: number;
  tax: number;
  paidDate: string;
  kind: DividendSyncKind;
  memo: string | null;
}

export interface ClassifyResult {
  candidates: TossDividendCandidate[];
  skipped: { unsettled: number; cancellation: number; other: number };
}

/** 거래내역 → 배당 기록 후보. 미결제(`settled=false`)는 결제된 뒤 동기화 때 들어오고, 취소 거래는
 *  원거래가 목록에서 이미 빠지므로(문서) 둘 다 건너뛴다. 종목 없는 입금(은행 입금)도 건너뛴다. */
export function classifyTossTransactions(txns: TossTransaction[]): ClassifyResult {
  const candidates: TossDividendCandidate[] = [];
  const skipped = { unsettled: 0, cancellation: 0, other: 0 };
  for (const t of txns) {
    if (!t.settled) { skipped.unsettled++; continue; }
    if (t.isCancellation) { skipped.cancellation++; continue; }
    const currency = t.currency === 'KRW' || t.currency === 'USD' ? t.currency : null;
    const amount = Number(t.netAmount);
    if (!currency || !t.symbol || !Number.isFinite(amount) || amount <= 0) { skipped.other++; continue; }

    let kind: DividendSyncKind | null = null;
    if (t.transactionType === 'DIVIDEND') kind = 'dividend';
    else if (t.transactionType === 'DEPOSIT') kind = currency === 'KRW' ? 'etfDistribution' : 'taxRefund';
    if (!kind) { skipped.other++; continue; }

    const tax = Number(t.tax);
    candidates.push({
      symbol: t.symbol,
      currency,
      amount,
      tax: Number.isFinite(tax) && tax > 0 ? tax : 0,
      paidDate: t.settlementDate,
      kind,
      memo: kind === 'taxRefund' ? TAX_REFUND_MEMO : null,
    });
  }
  return { candidates, skipped };
}

/** 국내 6자리 코드는 앞 5자리가 같으면 같은 회사의 보통주/우선주다(123450 / 123455). */
function companyKey(symbol: string): string {
  const s = symbol.toUpperCase();
  return /^\d{6}$/.test(s) ? `${s.slice(0, 5)}*` : s;
}

/** 저장할 종목 코드를 고른다. 토스는 우선주 배당을 보통주 코드로 주므로, 사용자가 실제로
 *  **보유·매매한** 같은 회사 코드가 딱 하나면 그 코드를 쓴다. 보유·매매에 없으면 배당 기록에서
 *  같은 방법으로 찾고, 그래도 정할 수 없으면(없거나 둘 이상) API 코드를 그대로 쓴다. */
export function toHeldShareClass(
  apiSymbol: string,
  positionSymbols: ReadonlySet<string>,
  recordedSymbols: ReadonlySet<string> = new Set()
): string {
  if (!/^\d{6}$/.test(apiSymbol)) return apiSymbol;
  for (const pool of [positionSymbols, recordedSymbols]) {
    const sameCompany = [...pool].filter((s) => companyKey(s) === companyKey(apiSymbol));
    if (sameCompany.length === 1) return sameCompany[0];
    if (sameCompany.length > 1) return apiSymbol; // 보통주·우선주를 둘 다 다룸 — 어느 쪽인지 알 수 없다
  }
  return apiSymbol;
}

let inFlight: Promise<DividendSyncResult> | null = null;

/** 모든 토스 계좌의 배당·국내 ETF 분배금·외화세금환급으로 그 계좌의 배당 기록을 통째로 교체한다.
 *  동시 호출은 실제 동기화 하나로 합친다(in-flight 공유). */
export function syncTossDividends(): Promise<DividendSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(): Promise<DividendSyncResult> {
  const accounts = await fetchTossAccounts({ forceRefresh: true });
  const labels = listAccountLabels('toss');
  const result: DividendSyncResult = {
    broker: 'toss',
    added: 0,
    removed: 0,
    unchanged: 0,
    total: 0,
    byKind: { dividend: 0, etfDistribution: 0, taxRefund: 0 },
    skipped: 0,
  };

  // 우선주 코드 보정용 — 사용자가 토스에서 실제로 보유·매매한 코드, 그다음 기존 배당 기록의 코드.
  const allDividends = listDividends();
  const tossHoldings = listHoldings({ broker: 'toss' });
  const tossTrades = listTrades({ broker: 'toss' });
  const positionSymbols = new Set<string>([...tossHoldings.map((h) => h.symbol), ...tossTrades.map((t) => t.symbol)]);
  const recordedSymbols = new Set<string>(allDividends.filter((d) => d.broker === 'toss').map((d) => d.symbol));

  // 종목명: 이미 아는 이름(배당·보유·매매 기록) → 토스/KIS/KB 자동조회 → 그래도 없으면 심볼.
  const knownNames = new Map<string, string>();
  for (const r of [...tossHoldings, ...tossTrades, ...allDividends]) {
    if (r.name && r.name !== r.symbol && !knownNames.has(r.symbol.toUpperCase())) knownNames.set(r.symbol.toUpperCase(), r.name);
  }

  const perAccount: Array<{ aliases: Set<string>; rows: Array<NewDividendInput & { kind: DividendSyncKind }> }> = [];
  for (const acc of accounts) {
    const seq = String(acc.accountSeq);
    const label = labels.find((l) => l.accountId === seq);
    // 배당 기록의 계좌 칸은 토스 accountSeq·API 계좌번호·별칭의 표시용 번호 중 무엇으로든 적혀 있을 수 있다 —
    // 전부 같은 계좌로 보고 교체한다. 새 기록은 사람이 읽는 번호(표시용 번호 > API 계좌번호)로 쓴다.
    const aliases = new Set([seq, acc.accountNo, label?.accountNumber].filter((v): v is string => !!v));
    const accountId = label?.accountNumber || acc.accountNo || seq;

    const txns = await fetchTossTransactions(acc.accountSeq, { types: ['DIVIDEND', 'DEPOSIT'] });
    const { candidates, skipped } = classifyTossTransactions(txns);
    result.skipped += skipped.unsettled + skipped.cancellation;
    perAccount.push({
      aliases,
      rows: candidates.map((c) => ({
        broker: 'toss',
        accountId,
        symbol: toHeldShareClass(c.symbol, positionSymbols, recordedSymbols),
        name: '',
        currency: c.currency,
        amount: c.amount,
        tax: c.tax,
        paidDate: c.paidDate,
        memo: c.memo,
        kind: c.kind,
      })),
    });
  }

  const unknown = [
    ...new Set(perAccount.flatMap((a) => a.rows.map((r) => r.symbol.toUpperCase())).filter((s) => !knownNames.has(s))),
  ];
  if (unknown.length > 0) {
    const { namesBySymbol } = await resolveStockNames(unknown).catch(() => ({ namesBySymbol: {} as Record<string, string> }));
    for (const [s, n] of Object.entries(namesBySymbol)) knownNames.set(s, n);
  }

  for (const { aliases, rows } of perAccount) {
    const r = replaceSyncedDividends(
      'toss',
      // 계좌 칸이 빈 토스 기록은 토스 계좌가 하나뿐일 때만 그 계좌 것으로 본다.
      (accountId) => (accountId ? aliases.has(accountId) : accounts.length === 1),
      rows.map(({ kind: _kind, ...row }) => ({ ...row, name: knownNames.get(row.symbol.toUpperCase()) ?? row.symbol }))
    );
    result.added += r.added;
    result.removed += r.removed;
    result.unchanged += r.unchanged;
    result.total += rows.length;
    for (const row of rows) result.byKind[row.kind]++;
  }
  return result;
}
