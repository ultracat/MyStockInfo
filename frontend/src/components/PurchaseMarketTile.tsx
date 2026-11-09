import { formatKrw, usdFmt } from '../format';

const SUB_LABEL = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 };
const SMALL_LINE = { fontSize: 12, fontWeight: 400 as const, color: 'var(--text-muted)', marginTop: 2 };

interface Amount {
  krw: number;
  /** 달러 보유분 — `hasUsd`일 때만 쓴다. */
  usd?: number | null;
}

/**
 * "총 매입금액"과 "총 평가금액"을 카드 하나에 나란히 보여준다(사용자 요청 — 두 값은 늘
 * 같이 비교해서 보므로). 보유 종목 화면(Dashboard.tsx)과 대시보드(Overview.tsx)가 공용.
 *
 * 달러가 섞이면(`hasUsd`) 굵은 값은 합계(환산) 하나만 두고 그 아래에 원화·달러를 작게
 * 적는다 — Dashboard.tsx의 AmountTile과 같은 "굵은 글씨는 합계 한 줄에만" 규칙.
 * 원화만이면(대시보드는 이미 원화 환산 합계만 넘김) 값 한 줄씩만 보인다.
 */
export default function PurchaseMarketTile({
  purchase,
  market,
  hasUsd = false,
  fxRate = null,
}: {
  purchase: Amount;
  market: Amount;
  hasUsd?: boolean;
  fxRate?: number | null;
}) {
  function block(label: string, a: Amount) {
    const usd = a.usd ?? 0;
    return (
      <div style={{ minWidth: 0 }}>
        <div style={SUB_LABEL}>{label}</div>
        <div className="value">
          {!hasUsd ? formatKrw(a.krw) : fxRate ? formatKrw(a.krw + usd * fxRate) : '환율 미적용'}
        </div>
        {hasUsd && (
          <div style={SMALL_LINE}>
            {formatKrw(a.krw)} · {usdFmt.format(usd)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stat-tile" style={{ flex: 2, minWidth: 320 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {block('총 매입금액', purchase)}
        {block('총 평가금액', market)}
      </div>
    </div>
  );
}
