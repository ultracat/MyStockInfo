import { formatKrw, usdFmt } from '../../format';

const SMALL_LINE = { fontSize: 12, fontWeight: 400 as const, color: 'var(--text-muted)', marginTop: 2 };

/**
 * 원화 전용이면 기존과 동일하게 한 줄만 보여준다. 달러 보유분이 섞여 있을 때만(현재는
 * 토스의 해외주식 계좌만 해당) 원화/달러/합계(환산) 3줄로 나눠 보여준다 — 굵은 글씨는
 * 합계(환산) 한 줄에만 쓰고, 원화/달러 개별 줄은 작은 글씨로 내린다. `hasUsd`는 이
 * 타일 하나의 금액(예: 손익금액 0원)이 아니라 포트폴리오 전체가 달러 보유분을
 * 갖고 있는지로 판단해서 넘겨받는다 — 그래야 예컨대 손익금액이 우연히 0이어도
 * 3줄 구조가 깨지지 않는다. 환율은 이 화면에서 이미 비중(weight) 계산에 쓰던
 * effectiveFxRate(설정 수동 입력 > 토스 실시간 환율)를 그대로 재사용한다.
 */
export function AmountTile({
  label,
  krwAmount,
  usdAmount,
  hasUsd,
  fxRate,
  signed = false,
  note,
}: {
  label: string;
  /** null이면 "아직 데이터가 없다"는 뜻(예: 예수금을 한 번도 입력/조회 못한
   *  CSV 전용 계좌) — 0원과 구분해 "정보 없음"으로 보여준다. */
  krwAmount: number | null;
  usdAmount: number | null;
  hasUsd: boolean;
  fxRate: number | null;
  signed?: boolean;
  /** 카드 맨 아래 작은 안내 한 줄(예: 일부 배당 환율 미적용). */
  note?: string;
}) {
  const noteLine = note ? <div style={SMALL_LINE}>{note}</div> : null;
  const sign = (v: number) => (signed && v >= 0 ? '+' : '');
  const fmt = (v: number) => `${sign(v)}${formatKrw(v)}`;
  const tone = (v: number) => (signed ? (v >= 0 ? 'text-good' : 'text-critical') : '');

  if (!hasUsd) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        {krwAmount === null ? (
          <div className="value" style={{ color: 'var(--text-muted)' }}>
            정보 없음
          </div>
        ) : (
          <div className={`value ${tone(krwAmount)}`}>{fmt(krwAmount)}</div>
        )}
        {noteLine}
      </div>
    );
  }

  const usd = usdAmount ?? 0;
  const totalKrw = (krwAmount ?? 0) + (fxRate ? usd * fxRate : 0);
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      {/* 0인 통화 줄은 뺀다 — 달러만 있는 계좌에 "+0원" 줄이 붙어 같은 값이 두 번 보였다(2026-11-18). */}
      {(krwAmount ?? 0) !== 0 && <div style={SMALL_LINE}>{fmt(krwAmount ?? 0)}</div>}
      {usd !== 0 && (
        <div style={SMALL_LINE}>
          {sign(usd)}
          {usdFmt.format(usd)}
        </div>
      )}
      <div className={`value ${tone(totalKrw)}`} style={{ marginTop: 2 }}>
        {fxRate ? fmt(totalKrw) : '환율 미적용'}
      </div>
      {noteLine}
    </div>
  );
}

/**
 * 손익률은 브로커가 이미 계산해서 내려주는 단일 값(`fallbackRate`)이 있어서
 * 원화 전용일 땐 그걸 그대로 보여준다. 달러가 섞여 있으면 원화/달러 손익률은
 * 통화가 같은 금액끼리 나눈 값이라 환율이 없어도 정확하지만(각 통화 내에서의
 * 순수 수익률), 합계 손익률은 두 통화를 하나로 합쳐야 하므로 AmountTile의
 * "합계(환산)"와 같은 effectiveFxRate로 직접 계산한다 — 브로커가 주는
 * fallbackRate를 재사용하지 않는 이유는, 그러면 이 화면의 다른 합계(환산) 금액
 * 타일들과 다른 환율 가정을 쓰게 되어 숫자가 서로 안 맞을 수 있기 때문.
 */
export function RateTile({
  label,
  krwPl,
  krwInvested,
  usdPl,
  usdInvested,
  hasUsd,
  fxRate,
  fallbackRate,
}: {
  label: string;
  krwPl: number;
  krwInvested: number;
  usdPl: number | null;
  usdInvested: number | null;
  hasUsd: boolean;
  fxRate: number | null;
  fallbackRate: number | null;
}) {
  const fmt = (r: number | null) => (r === null ? '-' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(2)}%`);
  const tone = (r: number | null) => ((r ?? 0) >= 0 ? 'text-good' : 'text-critical');

  if (!hasUsd) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        <div className={`value ${tone(fallbackRate)}`}>{fmt(fallbackRate)}</div>
      </div>
    );
  }

  const krwRate = krwInvested > 0 ? krwPl / krwInvested : null;
  const usdRate = usdInvested && usdInvested > 0 ? (usdPl ?? 0) / usdInvested : null;
  const investedTotalKrw = krwInvested + (fxRate ? (usdInvested ?? 0) * fxRate : 0);
  const plTotalKrw = krwPl + (fxRate ? (usdPl ?? 0) * fxRate : 0);
  const totalRate = fxRate && investedTotalKrw > 0 ? plTotalKrw / investedTotalKrw : null;

  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      {krwRate !== null && <div style={SMALL_LINE}>원화 {fmt(krwRate)}</div>}
      {usdRate !== null && <div style={SMALL_LINE}>달러 {fmt(usdRate)}</div>}
      <div className={`value ${tone(totalRate)}`} style={{ marginTop: 2 }}>
        {fxRate ? fmt(totalRate) : '환율 미적용'}
      </div>
    </div>
  );
}
