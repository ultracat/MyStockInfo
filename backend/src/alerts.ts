// OS 알림(2026-11-17) — 관심종목 목표가 도달, 배당 입금(동기화로 새 배당 기록이 생김), 보유 종목에 새 매수 유의사항.
//
// - 알림은 **Electron 메인 프로세스의 `Notification`**으로 띄운다(이 백엔드가 메인 프로세스 안에서 돈다). 렌더러는 보안 하드닝으로 브라우저
//   권한(알림 포함)을 전부 거절하므로(electron/CLAUDE.md) 화면에서 띄우지 않는다. Electron 밖(테스트·단독 실행)이면 콘솔에만 찍는다.
// - 켜기/끄기와 목표가는 planner.json(db/planner.ts). 같은 알림을 반복하지 않게 `alert-state.json`에 적는다:
//   목표가는 조건마다 **하루 한 번**, 유의사항은 처음 보는 유형만(없어졌다 다시 붙으면 다시 알림), 첫 실행은 지금 붙어 있는 것을 기록만 한다.
// - 배당 입금: 화면의 배당 동기화든 백그라운드 동기화든 새 기록이 생기면 알린다(dividendSyncAll.ts의 onDividendsAdded). 앱이 켜져 있으면
//   한국 시간 9~21시에 4시간마다 백그라운드로 동기화한다 — KIS 권리현황·토스 거래내역 전체를 받는 무거운 작업이라 자주 하지 않는다.
//   지급일이 7일보다 오래된 기록(처음 동기화·과거 보정)은 알리지 않는다.
// - 개인 정보: 알림은 이 PC의 OS 알림 센터에만 뜬다(종목·금액 포함). 외부로 보내지 않는다.
import { getDataDir } from './paths';
import { JsonStore } from './jsonStore';
import { getPlanner } from './db/planner';
import { listHoldings } from './db/holdingsStore';
import { resolveStockPrices } from './stockNameResolver';
import { getActiveWarnings, todayKst } from './marketInsights';
import { onDividendsAdded, syncAllDividends } from './dividendSyncAll';
import type { DividendRecord } from './db/dividends';

interface AlertState {
  /** `${symbol}:above|below` → 마지막으로 알린 날(KST). */
  priceNotified: Record<string, string>;
  /** 종목 → 지금 붙어 있다고 본 유의사항 유형. */
  warningsSeen: Record<string, string[]>;
  warningsInitialized: boolean;
  lastBackgroundDividendSync: string | null;
}

function stateStore() {
  return new JsonStore<AlertState>('alert-state.json', getDataDir(), {
    priceNotified: {},
    warningsSeen: {},
    warningsInitialized: false,
    lastBackgroundDividendSync: null,
  });
}

type Notify = (title: string, body: string) => void;

function electronNotify(): Notify | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    if (!electron?.Notification?.isSupported?.()) return null;
    return (title, body) => {
      const n = new electron.Notification({ title, body });
      // 알림을 누르면 앱 창을 앞으로.
      n.on('click', () => {
        const w = electron.BrowserWindow.getAllWindows()[0];
        if (w) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
      });
      n.show();
    };
  } catch {
    return null;
  }
}

let notifyImpl: Notify = (title, body) => console.log(`[alerts] ${title} — ${body}`);

/** 테스트가 알림을 가로챌 때 쓴다. */
export function setNotifier(fn: Notify): void {
  notifyImpl = fn;
}

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const money = (v: number, currency: string) => (currency === 'USD' ? `$${v.toFixed(2)}` : won(v));

/** 관심종목 목표가 — 조건마다 하루 한 번. 돌려준 값은 알린 건수. */
export async function checkTargetPrices(today = todayKst()): Promise<number> {
  const { alerts, watchTargets } = getPlanner();
  if (!alerts.targetPrice || watchTargets.length === 0) return 0;
  const { pricesBySymbol } = await resolveStockPrices(watchTargets.map((w) => w.symbol));
  const store = stateStore();
  const state = store.read();
  const notified = { ...state.priceNotified };
  let count = 0;
  for (const w of watchTargets) {
    const price = pricesBySymbol[w.symbol];
    if (!(price > 0)) continue;
    const hits: Array<['above' | 'below', number]> = [];
    if (w.above !== null && price >= w.above) hits.push(['above', w.above]);
    if (w.below !== null && price <= w.below) hits.push(['below', w.below]);
    for (const [dir, target] of hits) {
      const key = `${w.symbol}:${dir}`;
      if (notified[key] === today) continue;
      notified[key] = today;
      count++;
      notifyImpl(
        `목표가 도달 — ${w.symbol}`,
        `현재가 ${price.toLocaleString('ko-KR')}이(가) ${dir === 'above' ? '목표 이상' : '목표 이하'}(${target.toLocaleString('ko-KR')})입니다.`
      );
    }
  }
  if (count) store.write({ ...state, priceNotified: notified });
  return count;
}

/** 보유 종목의 새 매수 유의사항(토스) — 처음 실행은 기록만. */
export async function checkNewWarnings(): Promise<number> {
  if (!getPlanner().alerts.warnings) return 0;
  const symbols = [...new Set(listHoldings().filter((h) => h.quantity > 0).map((h) => h.symbol))];
  if (symbols.length === 0) return 0;
  const active = await getActiveWarnings(symbols);
  const store = stateStore();
  const state = store.read();
  const names = new Map(listHoldings().map((h) => [h.symbol, h.name]));
  let count = 0;
  const seen: Record<string, string[]> = {};
  for (const [symbol, list] of Object.entries(active)) {
    const types = list.map((w) => w.type);
    seen[symbol] = types;
    if (!state.warningsInitialized) continue;
    const before = new Set(state.warningsSeen[symbol] ?? []);
    for (const w of list) {
      if (before.has(w.type)) continue;
      count++;
      notifyImpl(`매수 유의사항 — ${names.get(symbol) ?? symbol}`, `${w.label}이(가) 새로 붙었습니다(보유 종목 ${symbol}).`);
    }
  }
  store.write({ ...state, warningsSeen: seen, warningsInitialized: true });
  return count;
}

/** 새 배당 기록 → 알림(최근 7일 지급분만, 많으면 한 번에 묶어서). */
export function notifyDividends(added: DividendRecord[], today = todayKst()): number {
  if (!getPlanner().alerts.dividendReceived) return 0;
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  const recent = added.filter((d) => d.paidDate >= weekAgo && d.paidDate <= today);
  if (recent.length === 0) return 0;
  if (recent.length <= 3) {
    for (const d of recent) notifyImpl(`배당 입금 — ${d.name || d.symbol}`, `${money(d.amount, d.currency)} (세후, ${d.paidDate})`);
  } else {
    const krw = recent.filter((d) => d.currency !== 'USD').reduce((s, d) => s + d.amount, 0);
    const usd = recent.filter((d) => d.currency === 'USD').reduce((s, d) => s + d.amount, 0);
    notifyImpl(`배당 입금 ${recent.length}건`, [krw ? won(krw) : null, usd ? `$${usd.toFixed(2)}` : null].filter(Boolean).join(' · ') + ' (세후)');
  }
  return recent.length;
}

/** 한국 시간 9~21시, 마지막 백그라운드 동기화에서 4시간이 지났으면 배당 동기화(새 기록은 위 리스너가 알린다). */
export async function maybeBackgroundDividendSync(now = Date.now()): Promise<boolean> {
  if (!getPlanner().alerts.dividendReceived) return false;
  const hourKst = new Date(now + 9 * 3600_000).getUTCHours();
  if (hourKst < 9 || hourKst >= 21) return false;
  const store = stateStore();
  const last = store.read().lastBackgroundDividendSync;
  if (last && now - Date.parse(last) < 4 * 3600_000) return false;
  store.update((s) => ({ ...s, lastBackgroundDividendSync: new Date(now).toISOString() }));
  await syncAllDividends();
  return true;
}

let started = false;

/** startServer가 부른다 — Electron 안에서만 OS 알림, 밖이면 콘솔. 목표가 5분, 유의사항 2시간, 배당 30분마다 확인(첫 확인은 2분 뒤). */
export function startAlertSchedule(): void {
  if (started) return;
  started = true;
  const native = electronNotify();
  if (native) notifyImpl = native;
  onDividendsAdded((added) => {
    try {
      notifyDividends(added);
    } catch (e) {
      console.warn(`[alerts] 배당 알림 실패: ${(e as Error).message}`);
    }
  });
  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    void fn().catch((e) => console.warn(`[alerts] ${name} 확인 실패: ${(e as Error).message}`));
  const prices = safe('목표가', () => checkTargetPrices());
  const warnings = safe('매수 유의사항', () => checkNewWarnings());
  const dividends = safe('배당 동기화', () => maybeBackgroundDividendSync());
  setTimeout(() => {
    prices();
    warnings();
    dividends();
    setInterval(prices, 5 * 60_000).unref();
    setInterval(warnings, 2 * 3600_000).unref();
    setInterval(dividends, 30 * 60_000).unref();
  }, 2 * 60_000).unref();
}
