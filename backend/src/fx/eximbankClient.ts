import { getSettings } from '../db/settings';

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
  return !!getSettings().eximbankAuthKey;
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

/**
 * USD/KRW 매매기준율(`deal_bas_r`) 조회 — 매 영업일 11시경 갱신되는 일별
 * 환율이라 주말/공휴일엔 그날 데이터가 없다. `searchdate`를 오늘부터 최대
 * 5일 전까지 하루씩 거슬러 올라가며 USD 항목이 있는 첫 응답을 쓴다(성공/실패
 * 사유를 세분화하진 않는다 — 인증키가 아예 잘못됐어도 같은 방식으로 계속
 * 재시도하다 5일 뒤 null을 반환한다. 5일이면 주말 낀 연휴는 대부분 커버되고,
 * 매 시도 최대 5초 타임아웃(위)과 곱해도 최악의 경우 총 대기가 30초 안쪽이다).
 * 인증키가 설정 안 돼 있으면 즉시 null.
 */
export async function fetchEximbankUsdKrwRate(): Promise<{ rate: number; asOf: string } | null> {
  const authKey = getSettings().eximbankAuthKey;
  if (!authKey) return null;

  for (let daysAgo = 0; daysAgo <= 5; daysAgo++) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const searchdate = yyyymmdd(date);

    let items: unknown;
    try {
      const res = await fetchWithTimeout(
        `${BASE_URL}?authkey=${encodeURIComponent(authKey)}&searchdate=${searchdate}&data=AP01`
      );
      if (!res.ok) continue;
      items = await res.json();
    } catch {
      continue; // 타임아웃(AbortError) 포함 — 이 날짜는 포기하고 다음 날짜로
    }
    if (!Array.isArray(items)) continue;

    const usd = (items as EximbankRateItem[]).find((i) => i.cur_unit === 'USD');
    if (!usd || usd.result !== 1) continue;

    const rate = parseKoreanNumber(usd.deal_bas_r);
    if (!Number.isFinite(rate) || rate <= 0) continue;

    return { rate, asOf: `${searchdate.slice(0, 4)}-${searchdate.slice(4, 6)}-${searchdate.slice(6, 8)}` };
  }

  return null;
}
