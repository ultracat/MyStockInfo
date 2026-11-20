import type { ReactNode } from 'react';
import StockNameLink from './StockNameLink';

/**
 * 표의 종목 칸 — 종목코드를 보통 글씨(종목 링크)로, 전체 종목명은 아래 작은 글씨(`cell-sub cell-fullname`, 240px에서 줄바꿈)로
 * (2026-11-20, 사용자 요청 — 계좌 칸 `AccountCell`과 같은 모양). 예전엔 "이름 (코드)" 한 줄이라 긴 해외 ETF 이름이 220px에서 잘렸다.
 * `children`은 코드 뒤 첫 줄에 붙는다(메모·배지·"보유 없음" 등). 이름이 없거나 코드와 같으면 둘째 줄을 뺀다.
 * 쓰는 곳: 보유 종목·종목별 수익·배당 기록 목록·매매내역 표.
 */
export default function StockCell({
  symbol,
  name,
  url,
  children,
}: {
  symbol: string;
  name?: string | null;
  url: string | null | undefined;
  children?: ReactNode;
}) {
  return (
    <>
      <StockNameLink name={symbol} url={url} />
      {children}
      {name && name !== symbol && <span className="cell-sub cell-fullname">{name}</span>}
    </>
  );
}
