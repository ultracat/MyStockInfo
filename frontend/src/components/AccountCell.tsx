import type { AccountLabel } from '../types';
import { accountParts } from '../accountLabels';

/**
 * 표 칸의 계좌 표시 — 계좌번호를 보통 글씨로, 별칭은 아래 작은 글씨(`cell-sub`)로(2026-11-20, 사용자 제안).
 * 예전엔 "별칭 · 계좌번호"를 한 줄로 이어 써서 계좌 열이 넓었다. `sub`를 주면 별칭 앞에 붙인다
 * (실현손익·다가오는 배당처럼 "증권사 · 계좌" 한 칸인 표 — 증권사 이름을 아래 줄로).
 * select 옵션처럼 한 줄이어야 하는 곳은 그대로 `formatAccountOption`.
 */
export default function AccountCell({ accountId, entry, sub }: { accountId: string; entry?: AccountLabel; sub?: string }) {
  return <AccountLines {...accountParts({ id: accountId }, entry)} sub={sub} />;
}

/** 이미 `accountParts`로 나눠 둔 값을 그린다(보유 종목 표 행처럼 계산 단계에서 만들어 둔 경우). */
export function AccountLines({ number, label, sub }: { number: string; label?: string; sub?: string }) {
  const second = [sub, label].filter(Boolean).join(' · ');
  return (
    <>
      <span className="cell-account">{number}</span>
      {second && <span className="cell-sub cell-account">{second}</span>}
    </>
  );
}
