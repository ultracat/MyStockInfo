import { APP_VERSION } from './generated/appInfo';
import { getSettings } from './db/settings';

// 새 버전 알림(2026-11-16) — 자동 업데이트는 코드 서명이 있어야 안전해서 아직 없다. 대신 GitHub 공개 릴리스 API로 최신
// 버전만 확인해 화면에 "새 버전이 나왔습니다"를 띄운다(설치는 사용자가 릴리스 페이지에서). 보안 수정이 기존 사용자에게
// 닿게 하려는 것.
// - 키가 필요 없는 공개 API(익명 한도 시간당 60회) — 6시간 메모리 캐시라 앱 하나가 하루 몇 번만 부른다.
// - GitHub이 받는 건 요청 IP와 일반 User-Agent(`MyStock/<버전>`)뿐이다. 개인정보가 싫으면 정보 화면에서 끈다
//   (settings.json의 `updateCheck: false`).
// - 실패(오프라인·한도)는 조용히 "모름"으로 — 알림 기능이 앱을 방해하면 안 된다.

const LATEST_URL = 'https://api.github.com/repos/ultracat/MyStockInfo/releases/latest';
const CACHE_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

export interface UpdateStatus {
  enabled: boolean;
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  checkedAt: string | null;
}

let cache: { at: number; latest: string | null; url: string | null } | null = null;

/** "1.10.0" > "1.9.3" 같은 숫자 비교. 형식이 다르면 비교하지 않는다(false). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => Number(n));
  const a = parse(candidate);
  const b = parse(current);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((n) => !Number.isInteger(n) || n < 0)) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function fetchLatest(): Promise<{ latest: string | null; url: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(LATEST_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `MyStock/${APP_VERSION}` },
    });
    if (!res.ok) return { latest: null, url: null };
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
    if (body.draft || body.prerelease || typeof body.tag_name !== 'string') return { latest: null, url: null };
    // 링크는 이 저장소의 릴리스 페이지만 받는다(응답이 이상해도 엉뚱한 주소를 열지 않게).
    const url = typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/ultracat/MyStockInfo/releases/')
      ? body.html_url
      : 'https://github.com/ultracat/MyStockInfo/releases/latest';
    return { latest: body.tag_name.replace(/^v/, ''), url };
  } catch {
    return { latest: null, url: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function getUpdateStatus(opts: { force?: boolean } = {}): Promise<UpdateStatus> {
  const enabled = getSettings().updateCheck !== false;
  if (!enabled) return { enabled, current: APP_VERSION, latest: null, newer: false, url: null, checkedAt: null };
  if (opts.force || !cache || Date.now() - cache.at > CACHE_MS) {
    const r = await fetchLatest();
    // 실패했으면 지난 성공 결과를 버리지 않는다 — 일시적 오프라인에 알림이 사라졌다 나타났다 하지 않게.
    if (r.latest || !cache) cache = { at: Date.now(), ...r };
  }
  return {
    enabled,
    current: APP_VERSION,
    latest: cache.latest,
    newer: cache.latest ? isNewerVersion(cache.latest, APP_VERSION) : false,
    url: cache.url,
    checkedAt: new Date(cache.at).toISOString(),
  };
}
