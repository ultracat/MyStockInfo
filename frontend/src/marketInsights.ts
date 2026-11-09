import { useEffect, useState } from 'react';
import { api } from './api';
import type { ActiveWarning, MarketSession, MarketStatus } from './types';

// 토스 시장 정보 보조 기능의 화면 쪽 공용 훅(백엔드 src/marketInsights.ts와 짝). 토스 미연동·실패면 빈 값이라
// 쓰는 화면은 이 정보가 없을 때도 예전처럼 동작해야 한다.

/** 종목들의 활성 매수 유의사항(정리매매·투자경고·VI 등). 종목 목록이 바뀔 때만 다시 묻는다(백엔드가 30분 캐시). */
export function useStockWarnings(symbols: string[]): Record<string, ActiveWarning[]> {
  const [bySymbol, setBySymbol] = useState<Record<string, ActiveWarning[]>>({});
  const key = [...new Set(symbols)].sort().join(',');
  useEffect(() => {
    if (!key) {
      setBySymbol({});
      return;
    }
    let cancelled = false;
    api
      .getStockWarnings(key.split(','))
      .then((r) => !cancelled && setBySymbol(r.bySymbol))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return bySymbol;
}

/** 국내·미국 장 상태 — 10분마다 다시 묻는다(세션 경계를 놓치지 않게). */
export function useMarketStatus(): { kr: MarketStatus | null; us: MarketStatus | null } {
  const [status, setStatus] = useState<{ kr: MarketStatus | null; us: MarketStatus | null }>({ kr: null, us: null });
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getMarketStatus()
        .then((s) => !cancelled && setStatus(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return status;
}

const SESSION_LABEL: Record<MarketSession, string> = {
  day: '데이마켓',
  pre: '프리마켓',
  regular: '정규장',
  after: '애프터마켓',
  closed: '장 마감',
};

export function describeMarket(name: string, s: MarketStatus | null): string | null {
  if (!s) return null;
  if (s.session === 'closed' && s.holidayToday) return `${name} 휴장`;
  return `${name} ${SESSION_LABEL[s.session]}`;
}

/** 시세가 움직일 수 있는 세션이 하나라도 열려 있나 — 둘 다 모르면(토스 미연동) true로 둬서 예전처럼 새로고침한다. */
export function anyMarketOpen(status: { kr: MarketStatus | null; us: MarketStatus | null }): boolean {
  if (!status.kr && !status.us) return true;
  return [status.kr, status.us].some((s) => s && s.session !== 'closed');
}
