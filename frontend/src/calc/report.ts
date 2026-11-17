// 월간·연간 보고서(보고서 화면) — 순수 함수, 테스트 frontend/test/report.test.ts.
// 기간(YYYY-MM 또는 YYYY)에 들어가는 배당·매매·실현손익과 순자산 기록(일별 스냅샷)을 모은다. 보유 현황은 "작성 시점" 값이다
// (과거 시점의 보유를 재구성하지 않는다 — 보고서에 그렇게 적는다).
import type { DividendRecord, SnapshotRecord, StoredTrade } from '../types';
import type { RealizedSale } from './realizedGains';
import { estimateOverseasCapitalGainsTax } from './realizedGains';

export interface ReportInput {
  period: string; // YYYY-MM | YYYY
  dividends: DividendRecord[];
  trades: StoredTrade[];
  sales: RealizedSale[];
  snapshots: SnapshotRecord[];
  rateFor: (month: string) => number | null;
}

export interface Report {
  period: string;
  kind: 'month' | 'year';
  netWorth: { start: SnapshotRecord | null; end: SnapshotRecord | null; changeKrw: number | null };
  dividends: {
    totalKrw: number;
    count: number;
    unconvertedUsd: number;
    byMonth: Array<{ month: string; krw: number }>;
    topSymbols: Array<{ symbol: string; name: string; krw: number }>;
  };
  trades: { buyKrw: number; sellKrw: number; buyCount: number; sellCount: number; unconvertedUsd: number };
  realized: { totalKrw: number; overseasKrw: number; domesticKrw: number; estimatedOverseasTaxKrw: number | null; count: number };
}

export function buildReport(input: ReportInput, isTaxAdvantaged: (broker: string, accountId: string) => boolean): Report {
  const { period, rateFor } = input;
  const kind = period.length === 4 ? 'year' : 'month';
  const inPeriod = (date: string) => date.startsWith(period);
  const toKrw = (amount: number, currency: string, month: string): number | null => {
    if (currency !== 'USD') return amount;
    const r = rateFor(month);
    return r ? amount * r : null;
  };

  // 순자산 — 기간 안 첫 기록과 마지막 기록
  const snaps = input.snapshots.filter((s) => inPeriod(s.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const start = snaps[0] ?? null;
  const end = snaps[snaps.length - 1] ?? null;

  // 배당
  let divTotal = 0;
  let divUnconverted = 0;
  let divCount = 0;
  const byMonth = new Map<string, number>();
  const bySymbol = new Map<string, { name: string; krw: number }>();
  for (const d of input.dividends) {
    if (!inPeriod(d.paidDate)) continue;
    divCount++;
    const month = d.paidDate.slice(0, 7);
    const v = toKrw(d.amount, d.currency, month);
    if (v === null) {
      divUnconverted += d.amount;
      continue;
    }
    divTotal += v;
    byMonth.set(month, (byMonth.get(month) ?? 0) + v);
    const cur = bySymbol.get(d.symbol) ?? { name: d.name, krw: 0 };
    cur.krw += v;
    bySymbol.set(d.symbol, cur);
  }

  // 매매
  const tr = { buyKrw: 0, sellKrw: 0, buyCount: 0, sellCount: 0, unconvertedUsd: 0 };
  for (const t of input.trades) {
    if (!inPeriod(t.executedAt)) continue;
    const v = toKrw(t.amount, t.currency, t.executedAt.slice(0, 7));
    if (t.side === 'BUY') tr.buyCount++;
    else tr.sellCount++;
    if (v === null) {
      tr.unconvertedUsd += t.amount;
      continue;
    }
    if (t.side === 'BUY') tr.buyKrw += v;
    else tr.sellKrw += v;
  }

  // 실현손익 — 일반 계좌만(ISA·연금은 과세 체계가 달라 실현손익 화면과 같이 뺀다)
  const sales = input.sales.filter((s) => inPeriod(s.date) && !isTaxAdvantaged(s.broker, s.accountId));
  const overseas = sales.filter((s) => s.currency !== 'KRW').reduce((s, x) => s + x.gainKrw, 0);
  const domestic = sales.filter((s) => s.currency === 'KRW').reduce((s, x) => s + x.gainKrw, 0);

  return {
    period,
    kind,
    netWorth: { start, end, changeKrw: start && end ? Math.round(end.totalMarketValueKrw - start.totalMarketValueKrw) : null },
    dividends: {
      totalKrw: Math.round(divTotal),
      count: divCount,
      unconvertedUsd: divUnconverted,
      byMonth: [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, krw]) => ({ month, krw: Math.round(krw) })),
      topSymbols: [...bySymbol.entries()]
        .map(([symbol, v]) => ({ symbol, name: v.name, krw: Math.round(v.krw) }))
        .sort((a, b) => b.krw - a.krw)
        .slice(0, 10),
    },
    trades: { ...tr, buyKrw: Math.round(tr.buyKrw), sellKrw: Math.round(tr.sellKrw) },
    realized: {
      totalKrw: Math.round(overseas + domestic),
      overseasKrw: Math.round(overseas),
      domesticKrw: Math.round(domestic),
      // 해외 양도세는 연 단위라 연간 보고서에만
      estimatedOverseasTaxKrw: kind === 'year' ? estimateOverseasCapitalGainsTax(overseas) : null,
      count: sales.length,
    },
  };
}
