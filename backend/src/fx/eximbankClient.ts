import { withCache } from '../brokers/responseCache';
import { EXIMBANK_AUTH_KEY } from './eximbankConfig';
import { getCachedRate, setCachedRate } from './eximbankCache';

// 한국수출입은행 Open API(환율, data=AP01). 공공데이터포털 공지("도메인이
// 2025-06-25에 www.koreaexim.go.kr로 이전, 구 도메인은 2026-04-30 폐쇄 예정")를
// 보고 처음엔 신 도메인(www.koreaexim.go.kr)을 썼는데, **실측 결과 신 도메인은
// 쿼리 파라미터가 붙은 요청에 응답 자체를 안 주고(WAF/봇 차단 추정 — authkey만
// 붙여도 재현됨), 오히려 "폐쇄 예정"이라던 구 도메인(oapi.koreaexim.go.kr)이
// 실제 인증키로 정상 응답했다**(200 OK, 사용자 실제 발급 키로 확인,
// checked 2026-08-17) — 그래서 문서상 공지와 반대로 구 도메인을 쓴다. 응답
// 필드(result/cur_unit/ttb/tts/deal_bas_r/cur_nm 등)는 이 실제 응답과 공식 사용
// 예제(Java/Spring Boot, Python)를 교차 확인해 반영했다. 구 도메인이 나중에 진짜
// 폐쇄되면 이 URL도 www.koreaexim.go.kr로 다시 바꿔야 한다 — 그땐 이 파일의
// 타임아웃/재시도 로직이 그대로 안전망 역할을 한다.
const BASE_URL = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';

export function isEximbankConfigured(): boolean {
  return !!EXIMBANK_AUTH_KEY;
}

interface EximbankRateItem {
  result: number;
  cur_unit: string;
  cur_nm: string;
  ttb: string;
  tts: string;
  deal_bas_r: string;
  [key: string]: unknown;
}

// "1,320.1"처럼 천단위 콤마가 붙은 숫자 문자열을 파싱한다.
function parseKoreanNumber(s: unknown): number {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function yyyymmdd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

// fetch엔 기본 타임아웃이 없다 — 위 BASE_URL 주석에 적은 대로 신 도메인이
// 응답 없이 계속 걸리는(hang) 걸 실제로 겪어봐서, 도메인을 구 도메인으로
// 바꾼 지금도 방어적으로 타임아웃을 건다(구 도메인이 정상 응답할 땐 0.1초
// 남짓이라 5초면 넉넉하다). 타임아웃이 없으면 "토스 실패 시 몇 초 안에 대체"
// 라는 이 기능의 목적이 최악의 경우 무한 대기로 무너진다 — 5초 × 아래 최대
// 6회 재시도로 총 대기 시간을 30초 안쪽으로 묶어둔다.
const REQUEST_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isPastDate(searchdate: string): boolean {
  return searchdate < yyyymmdd(new Date());
}

// 인증키가 없으면 즉시 null(예외 아님 — 미연동은 정상 상태). 그 외 실패
// 사유(주말/공휴일이라 그날 데이터가 없음, 타임아웃, 응답 형식 이상 등)는
// 세분화하지 않고 전부 null로 뭉뚱그린다 — 호출부(아래 두 함수) 각자가
// "그 날짜는 없다"는 사실만 알면 되고, 왜 없는지는 알 필요가 없어서다.
//
// **디스크 캐시(eximbankCache.ts)를 이 경계에서 확인/기록한다** — 이 인증키가
// 앱 빌드에 미리 박힌 개인 발급 키라(eximbankConfig.ts), 테스트 배포 후 여러
// 사용자가 같은 키로 반복 조회하면 요청량이 예상보다 커질 수 있어서, 한 번
// 확인한 날짜는 다시 API를 안 부르게 한다. 지나간 날짜의 결과(환율이든 "그날
// 데이터 없음"이든)는 캐시하지만, **오늘 날짜는 "데이터 없음"을 캐시하지
// 않는다** — 매매기준율이 보통 11시경에야 고시되므로, 그 전에 조회하면 아직
// null이 정상이고 그날 나중에 다시 물으면 값이 생겨야 한다(반면 한 번 값이
// 생기면 그 값은 그날 다시 안 바뀌므로 정상 캐시). 네트워크/타임아웃/응답
// 형식 오류는 일시적 문제일 수 있어 아예 캐시하지 않는다(다음 호출에 재시도).
async function fetchEximbankRateForDate(authKey: string, searchdate: string): Promise<number | null> {
  const cached = getCachedRate(searchdate);
  if (cached.hit && (cached.rate !== null || isPastDate(searchdate))) {
    return cached.rate;
  }

  let items: unknown;
  try {
    const res = await fetchWithTimeout(
      `${BASE_URL}?authkey=${encodeURIComponent(authKey)}&searchdate=${searchdate}&data=AP01`
    );
    if (!res.ok) return null;
    items = await res.json();
  } catch {
    return null; // 타임아웃(AbortError) 포함
  }
  if (!Array.isArray(items)) return null;

  const usd = (items as EximbankRateItem[]).find((i) => i.cur_unit === 'USD');
  if (!usd || usd.result !== 1) {
    if (isPastDate(searchdate)) setCachedRate(searchdate, null);
    return null;
  }

  const rate = parseKoreanNumber(usd.deal_bas_r);
  const result = Number.isFinite(rate) && rate > 0 ? rate : null;
  if (result !== null) setCachedRate(searchdate, result);
  return result;
}

/**
 * USD/KRW 매매기준율(`deal_bas_r`) 조회 — 매 영업일 11시경 갱신되는 일별
 * 환율이라 주말/공휴일엔 그날 데이터가 없다. `searchdate`를 오늘부터 최대
 * 5일 전까지 하루씩 거슬러 올라가며 USD 항목이 있는 첫 응답을 쓴다(5일이면
 * 주말 낀 연휴는 대부분 커버되고, 매 시도 최대 5초 타임아웃(위)과 곱해도
 * 최악의 경우 총 대기가 30초 안쪽이다). 인증키가 설정 안 돼 있으면 즉시 null.
 */
export async function fetchEximbankUsdKrwRate(): Promise<{ rate: number; asOf: string } | null> {
  if (!EXIMBANK_AUTH_KEY) return null;

  for (let daysAgo = 0; daysAgo <= 5; daysAgo++) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const searchdate = yyyymmdd(date);

    const rate = await fetchEximbankRateForDate(EXIMBANK_AUTH_KEY, searchdate);
    if (rate === null) continue;

    return { rate, asOf: `${searchdate.slice(0, 4)}-${searchdate.slice(4, 6)}-${searchdate.slice(6, 8)}` };
  }

  return null;
}

async function computeEximbankMonthlyAvgUsdKrwRate(
  month: string
): Promise<{ rate: number; sampleCount: number } | null> {
  if (!EXIMBANK_AUTH_KEY) return null;

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) return null;

  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === monthNum;
  const lastDay = isCurrentMonth ? Math.min(daysInMonth, today.getDate()) : daysInMonth;

  const weekdaySearchdates: string[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, monthNum - 1, day);
    const weekday = date.getDay(); // 0=일, 6=토
    if (weekday === 0 || weekday === 6) continue;
    weekdaySearchdates.push(yyyymmdd(date));
  }
  if (weekdaySearchdates.length === 0) return null;

  const rates = await Promise.all(weekdaySearchdates.map((d) => fetchEximbankRateForDate(EXIMBANK_AUTH_KEY, d)));
  const valid = rates.filter((r): r is number => r !== null);
  if (valid.length === 0) return null;

  return { rate: valid.reduce((sum, r) => sum + r, 0) / valid.length, sampleCount: valid.length };
}

// 이미 끝난 달의 평균은 다시 안 바뀌니 길게(30일, 이 프로세스가 사는 동안은
// 사실상 영구) 캐싱한다. 아직 진행 중인 이번 달만 새 영업일이 마감될 때마다
// 평균이 계속 움직이므로 짧게(4시간, 토스 일봉 캐시(tossClient.ts의
// CANDLE_CACHE_TTL_MS)와 같은 근거) 캐싱한다.
const PAST_MONTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CURRENT_MONTH_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * 어느 한 달("YYYY-MM")의 영업일별 매매기준율 평균 — 배당금처럼 특정 날짜에
 * 귀속되는 달러 금액을 "오늘 환율"이 아니라 "그 달 평균 환율"로 환산하고
 * 싶을 때 쓴다(`Overview.tsx`/`Dividends.tsx`의 배당금 원화 환산이 이걸
 * 쓴다). 그 달의 평일(주말은 애초에 데이터가 없어 API를 아예 안 부름)마다
 * `fetchEximbankRateForDate`를 병렬로 호출해 값이 나온 날짜만 평균낸다 —
 * 공휴일은 그 날짜만 자연히 null로 빠지므로 별도 휴일 목록이 필요 없다.
 * 이번 달처럼 아직 안 끝난 달은 오늘까지만 센다. 값을 하나도 못 구했으면
 * (인증키 없음, 그 달 전체가 응답 실패 등) null.
 */
export async function fetchEximbankMonthlyAvgUsdKrwRate(
  month: string
): Promise<{ rate: number; sampleCount: number } | null> {
  const now = new Date();
  const isCurrentMonth = month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return withCache(`eximbank:monthly-avg:${month}`, isCurrentMonth ? CURRENT_MONTH_TTL_MS : PAST_MONTH_TTL_MS, () =>
    computeEximbankMonthlyAvgUsdKrwRate(month)
  );
}
