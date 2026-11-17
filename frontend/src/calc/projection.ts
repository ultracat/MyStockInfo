// 앞으로 12개월 예상 배당·배당 달력(배당금 화면) — 순수 함수, 테스트 frontend/test/projection.test.ts.
import type { DividendRecord, MonthlySummaryRow, UpcomingDividend } from '../types';
import { monthlySummaryRows, upcomingMonthlyRows, upcomingNet } from './dividends';

/** `today`(YYYY-MM-DD)가 속한 달부터 `n`개월(YYYY-MM). */
export function monthsFrom(today: string, n: number): string[] {
  const y0 = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, k) => {
    const y = y0 + Math.floor((m0 + k) / 12);
    const m = ((m0 + k) % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}

/**
 * 앞으로 n개월의 월별 막대 — `received`는 그 기간에 이미 받은 배당(이번 달 앞부분), `expected`는 다가오는 배당(받은 것은 호출부가
 * `excludeReceived`로 미리 뺀다)의 세후 추정. 빈 달도 0으로 채워 그래프에 n칸이 다 보이게 한다.
 */
export function projectionRows(
  items: UpcomingDividend[],
  records: DividendRecord[],
  today: string,
  n = 12
): { months: string[]; received: MonthlySummaryRow[]; expected: MonthlySummaryRow[] } {
  const months = monthsFrom(today, n);
  const inWindow = new Set(months);
  const got = new Map(monthlySummaryRows(records.filter((r) => inWindow.has(r.paidDate.slice(0, 7)))).map((r) => [r.month, r]));
  const received = months.map((month) => got.get(month) ?? { month, totalKrw: 0, totalUsd: 0, count: 0 });
  const expected = upcomingMonthlyRows(items, 'ALL', 'ALL').filter((r) => inWindow.has(r.month));
  return { months, received, expected };
}

/** 원화 환산 합계 — 달러는 `rateFor(month)`가 있을 때만(없으면 `unconverted`로 따로 센다). */
export function rowsKrw(rows: MonthlySummaryRow[], rateFor: (month: string) => number | null): { krw: number; unconvertedUsd: number } {
  let krw = 0;
  let unconvertedUsd = 0;
  for (const r of rows) {
    krw += r.totalKrw;
    if (r.totalUsd > 0) {
      const rate = rateFor(r.month);
      if (rate) krw += r.totalUsd * rate;
      else unconvertedUsd += r.totalUsd;
    }
  }
  return { krw: Math.round(krw), unconvertedUsd };
}

export interface CalendarEntry {
  kind: 'received' | 'upcoming';
  status?: UpcomingDividend['status'];
  broker: string;
  accountId: string | null;
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  /** 세후(받은 것은 기록 금액, 다가오는 것은 추정). */
  net: number;
}

/** 한 달의 날짜별 배당 — 받은 기록(지급일) + 다가오는 배당(지급일, 지급일 미정은 뺀다). 키는 YYYY-MM-DD. */
export function calendarEntries(records: DividendRecord[], items: UpcomingDividend[], month: string): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>();
  const push = (day: string, e: CalendarEntry) => byDay.set(day, [...(byDay.get(day) ?? []), e]);
  for (const r of records) {
    if (!r.paidDate.startsWith(month)) continue;
    push(r.paidDate, { kind: 'received', broker: r.broker, accountId: r.accountId, symbol: r.symbol, name: r.name, currency: r.currency, net: r.amount });
  }
  for (const i of items) {
    if (!i.payDate || !i.payDate.startsWith(month)) continue;
    push(i.payDate, {
      kind: 'upcoming', status: i.status, broker: i.broker, accountId: i.accountId, symbol: i.symbol, name: i.name, currency: i.currency,
      net: i.currency === 'USD' ? Math.round(upcomingNet(i) * 100) / 100 : Math.round(upcomingNet(i)),
    });
  }
  return byDay;
}

/** 달력 칸 — 그 달 1일이 있는 주의 일요일부터 마지막 날이 있는 주의 토요일까지(YYYY-MM-DD, 다른 달 날짜는 null). */
export function calendarGrid(month: string): Array<string | null> {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** 이전·다음 달(YYYY-MM). */
export function shiftMonth(month: string, delta: number): string {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
