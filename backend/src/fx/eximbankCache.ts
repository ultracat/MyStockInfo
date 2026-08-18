import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/**
 * 한국수출입은행 API에서 날짜별로 받아온 매매기준율의 영구 로컬 캐시
 * (`searchdate(YYYYMMDD)` → 환율, 또는 그 날짜에 데이터가 없다는 뜻의 `null`).
 * 이 인증키는 앱에 미리 박아 넣은 개인 발급 키라(google/clientConfig.ts와 같은
 * 이유, fx/eximbankConfig.ts 참고), 테스트 배포 후 여러 사용자가 같은 키로
 * 동시에 쓰게 되면 요청량이 예상보다 커질 수 있다 — 과거 날짜의 환율은 절대
 * 바뀌지 않으므로(이미 고시된 매매기준율) 한 번 받아온 뒤로는 디스크 캐시만
 * 읽고 다시는 그 날짜로 API를 안 부른다(eximbankClient.ts의
 * `fetchEximbankRateForDate` 참고). 데이터 규모가 작아(하루 1건, 연 250여 영업일)
 * 다른 로컬 저장소와 같은 JsonStore로 충분하다.
 */
interface EximbankCacheFile {
  ratesByDate: Record<string, number | null>;
}

function store() {
  return new JsonStore<EximbankCacheFile>('eximbank-cache.json', getDataDir(), { ratesByDate: {} });
}

export type CachedRate = { hit: true; rate: number | null } | { hit: false };

export function getCachedRate(searchdate: string): CachedRate {
  const data = store().read();
  if (searchdate in data.ratesByDate) return { hit: true, rate: data.ratesByDate[searchdate] };
  return { hit: false };
}

export function setCachedRate(searchdate: string, rate: number | null): void {
  store().update((current) => ({ ratesByDate: { ...current.ratesByDate, [searchdate]: rate } }));
}
