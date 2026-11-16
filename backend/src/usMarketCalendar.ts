// 미국 증시(NYSE) 정기 휴장일 — 다가오는 배당의 미국 종목 추정 날짜(기준일·지급일)에 쓴다(upcomingDividends.ts).
//
// API가 아니라 규칙으로 계산한다:
// - 토스 `market-calendar/US`는 기준일 앞뒤 3영업일만 주고(한 달치를 보려면 여러 번 불러야 함) 토스 키가 있어야 한다 —
//   다가오는 배당은 한국투자증권 키만으로 돌아야 한다.
// - KIS 해외결제일자조회(`CTOS5011R`)는 휴장일이 아니라 거래일별 결제일을 준다.
// 규칙은 NYSE 공식 휴장일표(nyse.com/markets/hours-calendars, 2026~2028 확인 2026-11-16)와 맞춘다:
// - 고정일(1/1·6/19·7/4·12/25)이 토요일이면 전날 금요일, 일요일이면 다음 월요일에 쉰다.
//   단 **1/1이 토요일이면 쉬지 않는다**(전년 12/31 금요일은 정상 개장 — 2028년이 그 경우).
// - 6/19(Juneteenth)는 2022년부터.
// - 굿프라이데이 = 부활절 이틀 전(그레고리력 부활절 계산).
// ⚠ 국가 애도일 같은 **임시 휴장**(예: 2025-01-09)은 알 수 없다 — 추정 날짜가 하루 어긋날 수 있다.

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 일 ~ 6 토
}

/** 그 달의 n번째 `wd` 요일(n = -1이면 마지막). */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = weekday(y, m, 1);
    return iso(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return iso(y, m, last - ((weekday(y, m, last) - wd + 7) % 7));
}

/** 고정일 휴일의 대체 휴장일 — 토요일이면 금요일, 일요일이면 월요일. */
function observed(y: number, m: number, d: number): string {
  const w = weekday(y, m, d);
  const t = Date.UTC(y, m - 1, d) + (w === 6 ? -1 : w === 0 ? 1 : 0) * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/** 그레고리력 부활절(익명 그레고리력 알고리즘). */
function easter(y: number): { m: number; d: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

/** 그해 NYSE 정기 휴장일(YYYY-MM-DD, 날짜순). */
export function nyseHolidays(y: number): string[] {
  const out: string[] = [];
  if (weekday(y, 1, 1) !== 6) out.push(observed(y, 1, 1)); // 1/1이 토요일이면 쉬지 않는다
  out.push(nthWeekday(y, 1, 1, 3)); // 마틴 루터 킹 데이 — 1월 셋째 월요일
  out.push(nthWeekday(y, 2, 1, 3)); // 대통령의 날 — 2월 셋째 월요일
  const ea = easter(y);
  out.push(new Date(Date.UTC(y, ea.m - 1, ea.d) - 2 * 864e5).toISOString().slice(0, 10)); // 굿프라이데이
  out.push(nthWeekday(y, 5, 1, -1)); // 메모리얼 데이 — 5월 마지막 월요일
  if (y >= 2022) out.push(observed(y, 6, 19)); // 준틴스
  out.push(observed(y, 7, 4)); // 독립기념일
  out.push(nthWeekday(y, 9, 1, 1)); // 노동절 — 9월 첫째 월요일
  out.push(nthWeekday(y, 11, 4, 4)); // 추수감사절 — 11월 넷째 목요일
  out.push(observed(y, 12, 25)); // 크리스마스
  return out.sort();
}

/**
 * `from`~`to`(YYYY-MM-DD)에 걸친 NYSE 휴장일을 `{날짜: false}`로 — `planSymbolDividends`의 영업일 달력(`BusinessDays`) 모양.
 * 없는 날짜는 받는 쪽이 주말만 쉬는 날로 보므로 휴장일만 넣으면 된다.
 */
export function usMarketClosedDays(from: string, to: string): Record<string, boolean> {
  const cal: Record<string, boolean> = {};
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const d of nyseHolidays(y)) if (d >= from && d <= to) cal[d] = false;
  }
  return cal;
}
