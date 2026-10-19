import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { StockLinkEntry } from '../types';
import { resolveStockLink, stockLinkMap } from '../stockLinks';

/**
 * 종목명을 외부 링크(토스증권 종목 페이지 등)로 그리는 공용 셀 — 보유 종목/배당금/
 * 매매내역/관심종목 표가 같은 모양·동작을 쓰도록 한 곳에 둔다. `url`이 없으면 지금처럼
 * 텍스트만 그린다. `target="_blank"`는 Electron에선 setWindowOpenHandler가 시스템
 * 브라우저로 넘기고(electron/src/main.ts), 웹 모드에선 새 탭으로 열린다.
 *
 * 링크 클릭은 행 클릭으로 번지지 않게 막는다 — 관심종목 표처럼 행을 누르면 상세가
 * 열리는 화면에서 링크를 눌렀는데 상세까지 바뀌지 않도록.
 */
export default function StockNameLink({ name, url }: { name: string; url: string | null | undefined }) {
  if (!url) {
    return (
      <span className="cell-name-truncate" title={name}>
        {name}
      </span>
    );
  }
  return (
    <a
      className="cell-name-truncate"
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`${name} — 외부 페이지 열기`}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </a>
  );
}

/** 화면 마운트 시 사용자 입력 링크를 한 번 불러와 `(symbol, currency) → url | null`을
 *  돌려준다(관리는 "종목 링크" 화면, 여기선 읽기만). 불러오기 전/실패 시에도 자동
 *  링크(국내 규칙 등)는 바로 동작한다. */
export function useStockLinkResolver(): (symbol: string, currency: string | null | undefined) => string | null {
  const [entries, setEntries] = useState<StockLinkEntry[]>([]);
  useEffect(() => {
    api.listStockLinks().then(setEntries).catch(() => {});
  }, []);
  const saved = useMemo(() => stockLinkMap(entries), [entries]);
  return useCallback((symbol, currency) => resolveStockLink(symbol, currency, saved).url, [saved]);
}
