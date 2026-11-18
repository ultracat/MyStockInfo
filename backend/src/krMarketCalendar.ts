// 국내 증시(KRX) 휴장일 표 — 다가오는 배당의 국내 추정 날짜(기준일·지급일)에 쓴다(upcomingDividends.ts가 `krMarketClosedDays`를 국내 달력에 깐다).
// KIS 국내휴장일조회(`CTCA0903R`)는 이번 달~다음 달 초까지만 받으므로(공식 예제 "1일 1회"), 그 뒤 12개월 예상은 예전엔 주말만 쉬는 날로
// 봐서 설·추석 연휴에 지급일이 하루~며칠 어긋났다(2026-11-18). KIS 값이 있는 날짜는 그걸 쓰고, 없는 날짜만 이 표를 본다.
//
// 출처: 한국천문연구원 천문우주지식정보 월력요항(astro.kasi.re.kr, 2026·2027 확인 2026-11-18 — 우주항공청 발표). 대체공휴일 포함.
// KRX 추가 휴장: 근로자의 날(5/1 — 2027년부터 법정 공휴일 "노동절"), **연말 휴장일**(12/31, 주말·공휴일이면 직전 영업일).
// ⚠ 선거일·임시공휴일은 정해질 때 들어간다(월력요항에 없음). **해마다 6월쯤 다음 해 월력요항이 나오면 여기 한 해를 더한다** —
//   표에 없는 해는 주말만 쉬는 날로 본다(예전 동작).
const HOLIDAYS: Record<number, string[]> = {
  2026: [
    '01-01',
    '02-16', '02-17', '02-18', // 설날
    '03-02', // 대체(3·1절)
    '05-01', // 근로자의 날(KRX 휴장)
    '05-05',
    '05-25', // 대체(부처님오신날 5/24)
    '06-03', // 전국동시지방선거
    '08-17', // 대체(광복절)
    '09-24', '09-25', '09-26', // 추석
    '10-05', // 대체(개천절)
    '10-09',
    '12-25',
  ],
  2027: [
    '01-01',
    '02-08', '02-09', // 설날(2/6~8) + 대체 — 2/6·2/7은 주말
    '03-01',
    '05-03', // 대체(노동절 5/1)
    '05-05',
    '05-13', // 부처님오신날
    '07-19', // 대체(제헌절 7/17)
    '08-16', // 대체(광복절)
    '09-14', '09-15', '09-16', // 추석
    '10-04', // 대체(개천절)
    '10-11', // 대체(한글날)
    '12-27', // 대체(기독탄신일)
  ],
};

function isWeekend(date: string): boolean {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
}

const holidaySet = new Set(Object.entries(HOLIDAYS).flatMap(([y, ds]) => ds.map((d) => `${y}-${d}`)));

/** 이 해의 휴장일 표가 있나 — 없으면 주말만 본다. */
export function hasKrHolidayTable(year: number): boolean {
  return year in HOLIDAYS;
}

/** 연말 휴장일 — 12/31부터 거슬러 첫 평일·비공휴일. 표가 없는 해는 null. */
export function krYearEndClosing(year: number): string | null {
  if (!hasKrHolidayTable(year)) return null;
  for (let d = 31; d >= 24; d--) {
    const date = `${year}-12-${String(d).padStart(2, '0')}`;
    if (!isWeekend(date) && !holidaySet.has(date)) return date;
  }
  return null;
}

/** 국내 증시가 쉬는 날인가(주말 포함) — 표에 없는 해는 주말만. */
export function isKrMarketClosed(date: string): boolean {
  if (isWeekend(date)) return true;
  if (holidaySet.has(date)) return true;
  return krYearEndClosing(Number(date.slice(0, 4))) === date;
}

/** 기간 안의 휴장일(평일만, 값 false) — upcomingDividends.ts가 KIS 휴장일 위에 깐다(미국 `usMarketClosedDays`와 같은 모양). */
export function krMarketClosedDays(from: string, to: string): Record<string, boolean> {
  const cal: Record<string, boolean> = {};
  for (const d of holidaySet) if (d >= from && d <= to && !isWeekend(d)) cal[d] = false;
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const ye = krYearEndClosing(y);
    if (ye && ye >= from && ye <= to) cal[ye] = false;
  }
  return cal;
}
