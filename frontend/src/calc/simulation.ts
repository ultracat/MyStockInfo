// 은퇴·목표 자산 시뮬레이션(분석 화면) — 순수 함수, 테스트 frontend/test/analysis.test.ts.
//
// 매달: 적립(월초) → 총수익률로 불어남. 총수익률 = 가격 상승 + 배당. 배당을 재투자하면 그대로 자산에 남고, 재투자하지 않으면 배당(세후)을
// 꺼내 쓴 것으로 보고 자산에서 뺀다(받은 배당은 따로 센다). 월 적립은 해마다 `contributionGrowthPct`만큼 늘린다.
// 물가(`inflationPct`)로 나눈 "오늘 돈 가치"도 같이 낸다. 세금은 배당 원천징수(15.4%)만 반영 — 매매 차익 세금·수수료는 무시한 단순 모델.

export interface SimulationInput {
  startKrw: number;
  monthlyKrw: number;
  /** 연 총수익률(%) — 가격 + 배당. */
  annualReturnPct: number;
  /** 연 배당수익률(%) — 총수익률 중 배당 몫. */
  dividendYieldPct: number;
  reinvest: boolean;
  contributionGrowthPct: number;
  inflationPct: number;
  years: number;
  /** 배당 원천징수율(기본 15.4%) — ISA·연금이면 0. */
  dividendTaxPct?: number;
}

export interface SimulationYear {
  year: number;
  contributedKrw: number;
  valueKrw: number;
  /** 오늘 돈 가치(물가 반영). */
  realValueKrw: number;
  /** 그해 받은 세후 배당. */
  dividendsKrw: number;
  /** 그해 말 자산 기준 월 배당(세후). */
  monthlyDividendKrw: number;
}

export function simulate(input: SimulationInput): SimulationYear[] {
  const monthlyTotal = Math.pow(1 + input.annualReturnPct / 100, 1 / 12) - 1;
  const monthlyDiv = input.dividendYieldPct / 100 / 12;
  const divTax = (input.dividendTaxPct ?? 15.4) / 100;
  let value = Math.max(0, input.startKrw);
  let contributed = value;
  let monthly = Math.max(0, input.monthlyKrw);
  const out: SimulationYear[] = [];
  for (let y = 1; y <= Math.min(60, Math.max(1, Math.round(input.years))); y++) {
    let dividends = 0;
    for (let m = 0; m < 12; m++) {
      value += monthly;
      contributed += monthly;
      const dividendNet = value * monthlyDiv * (1 - divTax);
      // 총수익률에서 배당세만큼 덜 불어난다; 재투자하지 않으면 세후 배당을 꺼낸다
      value = value * (1 + monthlyTotal) - value * monthlyDiv * divTax;
      if (!input.reinvest) value -= dividendNet;
      dividends += dividendNet;
    }
    const realValue = value / Math.pow(1 + input.inflationPct / 100, y);
    out.push({
      year: y,
      contributedKrw: Math.round(contributed),
      valueKrw: Math.round(value),
      realValueKrw: Math.round(realValue),
      dividendsKrw: Math.round(dividends),
      monthlyDividendKrw: Math.round((value * (input.dividendYieldPct / 100) * (1 - divTax)) / 12),
    });
    monthly *= 1 + input.contributionGrowthPct / 100;
  }
  return out;
}

/** 목표(오늘 돈 가치 기준 자산, 또는 월 배당)에 처음 닿는 해 — 없으면 null. */
export function yearsToTarget(rows: SimulationYear[], targetAssetsKrw: number | null, targetMonthlyDividendKrw: number | null, inflationPct: number): { assets: number | null; dividend: number | null } {
  const assets = targetAssetsKrw ? rows.find((r) => r.realValueKrw >= targetAssetsKrw)?.year ?? null : null;
  const dividend = targetMonthlyDividendKrw
    ? rows.find((r) => r.monthlyDividendKrw / Math.pow(1 + inflationPct / 100, r.year) >= targetMonthlyDividendKrw)?.year ?? null
    : null;
  return { assets, dividend };
}

/** 비관·보통·낙관 — 수익률 ±2%p. */
export function scenarios(input: SimulationInput): Array<{ label: string; returnPct: number; rows: SimulationYear[] }> {
  return [
    { label: '비관', returnPct: input.annualReturnPct - 2 },
    { label: '보통', returnPct: input.annualReturnPct },
    { label: '낙관', returnPct: input.annualReturnPct + 2 },
  ].map((s) => ({ ...s, rows: simulate({ ...input, annualReturnPct: s.returnPct }) }));
}
