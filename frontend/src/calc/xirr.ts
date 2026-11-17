// 입금 기준 연환산 수익률(XIRR) — 보유 종목 화면 "입금 기준 투자원금과 수익" 카드. 순수 함수, 테스트 frontend/test/xirr.test.ts.
//
// 투자자 쪽 현금흐름으로 본다: 입금은 −(주머니에서 나감), 출금은 +, 마지막 날 지금 계좌 자산을 +로 둔다. 그 흐름의 순현재가치가 0이 되는
// 연 수익률을 찾는다(엑셀 XIRR과 같은 정의, 365일 기준). 백엔드는 입출금을 월별로 묶어 주므로 각 달의 15일에 일어난 것으로 본다 —
// 달 안의 날짜 차이는 몇 년 단위 수익률엔 거의 영향이 없다.

export interface DatedFlow {
  date: string; // YYYY-MM-DD
  amount: number;
}

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;

function npv(rate: number, flows: DatedFlow[], t0: number): number {
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, (dayNum(f.date) - t0) / 365), 0);
}

/** 연 수익률(0.12 = 12%) — 흐름에 +와 −가 둘 다 없거나 답을 못 찾으면 null. */
export function xirr(flows: DatedFlow[]): number | null {
  const fs = flows.filter((f) => Number.isFinite(f.amount) && f.amount !== 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return null;
  const t0 = dayNum(fs[0].date);
  // 이분법 — −99.99% ~ +10000% 사이에서 부호가 바뀌는 곳을 찾는다(뉴턴법보다 느리지만 발산하지 않는다).
  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo, fs, t0);
  const fHi = npv(hi, fs, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, fs, t0);
    if (Math.abs(fMid) < 1e-6 || hi - lo < 1e-9) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** 월별 순입금(입금 +) + 지금 자산 → 투자자 흐름. 같은 달은 더한다. */
export function flowsFromMonthlyNet(byMonth: Array<{ month: string; netKrw: number }>, assetsKrw: number, today: string): DatedFlow[] {
  const sum = new Map<string, number>();
  for (const m of byMonth) sum.set(m.month, (sum.get(m.month) ?? 0) + m.netKrw);
  const flows = [...sum.entries()].map(([month, net]) => ({ date: `${month}-15` < today ? `${month}-15` : today, amount: -net }));
  flows.push({ date: today, amount: assetsKrw });
  return flows;
}
