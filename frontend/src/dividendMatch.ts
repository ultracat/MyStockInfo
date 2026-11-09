import type { BrokerId, DividendRecord, AccountLabel } from './types';
import { resolveDividendAccountId } from './accountLabels';

/** (증권사, 내부 accountId, 종목) 묶음 키 — 보유종목 행과 배당 기록을 같은 키로 맞춘다. */
export function dividendKey(broker: BrokerId, accountId: string, symbol: string): string {
  return `${broker}|${accountId}|${symbol}`;
}

/**
 * 배당 기록을 "이 계좌의 이 종목" 단위로 묶는다 — 보유 종목 화면(Dashboard.tsx)의
 * "배당 포함 손익금액" 열/카드와 대시보드(Overview.tsx)의 "총 손익금액(배당 포함)"
 * 카드가 같은 매칭 규칙을 쓰도록 한 곳에 둔다(한쪽만 고치면 두 화면 숫자가 어긋남).
 *
 * - 배당 기록의 계좌는 자유 입력이라 `resolveDividendAccountId`로 내부 accountId로
 *   되돌린다(토스: 표시용 번호 "158-01-…" → accountSeq "1").
 * - 계좌가 빈 배당 기록은 `soleAccountIdFor(broker)`가 계좌 하나를 돌려줄 때만(그
 *   증권사 계좌가 딱 하나) 그 계좌 것으로 본다 — 여러 개면 어느 계좌인지 알 수 없어 뺀다.
 */
export function groupDividendsByAccountSymbol(
  dividends: DividendRecord[],
  labels: AccountLabel[],
  soleAccountIdFor: (broker: BrokerId) => string | null
): Map<string, DividendRecord[]> {
  const out = new Map<string, DividendRecord[]>();
  for (const d of dividends) {
    const acct = resolveDividendAccountId(labels, d.broker, d.accountId) ?? soleAccountIdFor(d.broker);
    if (!acct) continue;
    const key = dividendKey(d.broker, acct, d.symbol);
    const list = out.get(key);
    if (list) list.push(d);
    else out.set(key, [d]);
  }
  return out;
}
