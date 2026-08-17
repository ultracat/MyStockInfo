import { getSettings } from '../db/settings';

// 한국수출입은행 Open API(환율, data=AP01). 도메인이 2025-06-25에
// www.koreaexim.go.kr로 이전됐고 구 도메인(oapi.koreaexim.go.kr)은 2026-04-30
// 폐쇄 예정이라 신 도메인만 쓴다(공공데이터포털 등록 페이지 공지 확인,
// checked 2026-08-17). 요청/응답 형식은 공식 사용 예제(Java/Spring Boot,
// Python) 여러 개와 실제 응답 샘플을 교차 확인해 반영했다 — 다만 이 저장소
// 환경에서는 공식 도메인이 WAF/봇 차단 챌린지(302 리다이렉트 루프) 뒤에 있어
// curl로 라이브 응답까지는 확인하지 못했다. 실제 인증키로 최초 사용 시 반드시
// 재검증할 것.
const BASE_URL = 'https://www.koreaexim.go.kr/site/program/financial/exchangeJSON';

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

// 이 저장소 개발 환경에서 실제로 이 도메인이 응답 없이 계속 걸리는(hang) 걸
// 확인했다(WAF/봇 차단 챌린지로 추정, 302 리다이렉트 루프 — 실제 인증키로도
// 64초(=8회×8초) 동안 전부 타임아웃, `_debug-eximbank`로 실측, 2026-08-17) —
// 이 환경 자체의 네트워크 제약일 가능성이 높지만(Java/Python 공식 사용 예제가
// 여럿 존재), fetch에 기본 타임아웃이 없어서 대비는 필요하다: 타임아웃이 없으면
// "토스 실패 시 몇 초 안에 대체"라는 이 기능의 목적이 최악의 경우 무한 대기로
// 무너진다. 5초로 잡은 이유: 정상 응답이면 국내 API라 1~2초면 충분하고, 실패
// 시나리오(worst case, 아래 5일 재시도 전부 실패)의 총 대기 시간을 30초 안으로
// 묶어두기 위함.
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
