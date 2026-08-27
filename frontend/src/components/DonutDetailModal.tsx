export interface DonutDetailRow {
  symbol: string;
  name: string;
  valueKrw: number;
  /** 값 옆에 덧붙일 부가 정보(배당 횟수, 보유수량 등) — 호출부마다 의미가 다르다. */
  meta?: string;
}

/**
 * DonutChart의 가운데 숫자를 눌렀을 때 뜨는 종목별 상세 목록 모달(Overview.tsx의
 * 보유종목/배당금 비중 카드가 공유). 표(`<table>`) 대신 종목명 아래에 나머지 값을
 * 줄바꿈해 쌓는 목록으로 그려서, 종목명이 길어도 창 폭에 상관없이 가로 스크롤 없이
 * 한 번에 다 보인다.
 */
export default function DonutDetailModal({
  title,
  totalValueKrw,
  rows,
  formatValue,
  onClose,
}: {
  title: string;
  totalValueKrw: number;
  rows: DonutDetailRow[];
  formatValue: (v: number) => string;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {rows.length}개 종목 · 총 {formatValue(totalValueKrw)}
        </p>
        {rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>표시할 데이터가 없습니다.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((r) => (
              <div key={r.symbol} style={{ padding: '10px 0', borderBottom: '1px solid var(--gridline)' }}>
                <div>
                  {r.name} ({r.symbol})
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    marginTop: 2,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    flexWrap: 'wrap',
                  }}
                >
                  {r.meta && (
                    <>
                      <span>{r.meta}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>{formatValue(r.valueKrw)}</span>
                  <span>·</span>
                  <span>
                    {totalValueKrw > 0 ? `${((r.valueKrw / totalValueKrw) * 100).toFixed(1)}%` : '-'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
