// 한국 시간(KST, UTC+9 — 서머타임 없음) 날짜 도우미. 증권사·수출입은행의 "날짜"는 전부 한국 날짜인데,
// `new Date().getDate()`·`getDay()` 같은 OS 지역 시간 함수는 PC 시간대가 한국이 아니면(해외 거주·여행, CI) 하루가
// 어긋난다. 여기 함수들은 시간대와 무관하게 같은 답을 준다 — 지금 시각을 9시간 민 뒤 UTC 필드로 읽는다.
// 달력 계산(그 달 일수·요일·며칠 전)은 시각이 아니라 날짜 문자열 위에서 UTC 자정으로 한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 그 시각의 한국 날짜 'YYYY-MM-DD'. */
export function kstToday(now: number | Date = Date.now()): string {
  return new Date(+now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 그 시각의 한국 날짜 'YYYYMMDD'(증권사·수출입은행 요청 형식). */
export function kstTodayCompact(now: number | Date = Date.now()): string {
  return kstToday(now).replace(/-/g, '');
}

/** 그 시각의 한국 '시'(0~23). */
export function kstHour(now: number | Date = Date.now()): number {
  return new Date(+now + KST_OFFSET_MS).getUTCHours();
}

/** 그 시각의 한국 요일(0=일 … 6=토). */
export function kstWeekday(now: number | Date = Date.now()): number {
  return new Date(+now + KST_OFFSET_MS).getUTCDay();
}

/** 그 시각의 한국 자정부터 지난 분(0~1439) — "장이 열려 있을 시간인가" 같은 시각 비교용. */
export function kstMinuteOfDay(now: number | Date = Date.now()): number {
  const d = new Date(+now + KST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 'YYYY-MM-DD'(또는 'YYYYMMDD')에 날짜 수를 더한 'YYYY-MM-DD' — 달력 계산이라 시간대와 무관. */
export function addDays(ymd: string, days: number): string {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 그 날짜의 요일(0=일 … 6=토) — 달력 계산이라 시간대와 무관. */
export function weekdayOf(ymd: string): number {
  return parseYmdUtc(ymd).getUTCDay();
}

/** 그 달의 일수(year, month 1~12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM-DD' → 'YYYYMMDD'. */
export function compactYmd(ymd: string): string {
  return ymd.replace(/-/g, '');
}

function parseYmdUtc(ymd: string): Date {
  const s = ymd.replace(/-/g, '');
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}
