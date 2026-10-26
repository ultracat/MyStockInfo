import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface DonutDetailRow {
  symbol: string;
  name: string;
  valueKrw: number;
  /** 값 옆에 덧붙일 부가 정보(배당 횟수, 보유수량 등) — 호출부마다 의미가 다르다. */
  meta?: string;
  /** 지정하면 "이름 (심볼)" 대신 이 텍스트를 제목 줄에 쓴다 — 계좌처럼 심볼이
   *  없는 행용(심볼 자리는 React key로만 쓰인다). */
  label?: string;
  /** 행 아래에 작게 펼쳐 보여줄 내역(계좌별 보기의 종목별 금액 등). */
  details?: { label: string; valueKrw: number }[];
}

/** 같은 모달 안에서 전환할 수 있는 보기 하나(예: 종목별 / 계좌별). */
export interface DonutDetailView {
  id: string;
  label: string;
  rows: DonutDetailRow[];
  /** 요약 줄의 "N개 종목" 부분 — 보기마다 세는 대상이 달라서. */
  countLabel: (n: number) => string;
}

/**
 * DonutChart의 가운데 숫자를 눌렀을 때 뜨는 종목별 상세 목록 모달(Overview.tsx의
 * 보유종목/배당금 비중 카드가 공유). 표(`<table>`) 대신 종목명 아래에 나머지 값을
 * 줄바꿈해 쌓는 목록으로 그려서, 종목명이 길어도 창 폭에 상관없이 가로 스크롤 없이
 * 한 번에 다 보인다.
 *
 * `views`를 넘기면 제목 아래에 보기 전환 버튼이 생긴다(월별 배당 내역의 종목별 /
 * 계좌별) — 첫 번째 보기가 기본이고, `rows`는 무시된다. 안 넘기면 예전과 똑같이
 * `rows` 하나만 보여준다.
 */
export default function DonutDetailModal({
  title,
  totalValueKrw,
  rows,
  views,
  formatValue,
  onClose,
}: {
  title: string;
  totalValueKrw: number;
  rows?: DonutDetailRow[];
  views?: DonutDetailView[];
  formatValue: (v: number) => string;
  onClose: () => void;
}) {
  const [viewId, setViewId] = useState(views?.[0]?.id ?? null);
  const activeView = views?.find((v) => v.id === viewId) ?? views?.[0];
  const shownRows = activeView ? activeView.rows : (rows ?? []);
  const countText = activeView ? activeView.countLabel(shownRows.length) : `${shownRows.length}개 종목`;

  // ⚠ `document.body`로 portal한다 — `.modal-overlay`는 `position: fixed`인데,
  // 이 모달을 여는 화면(Overview.tsx 등)은 화면 줌의 `transform: scale`이 걸린
  // `.main` 안에 있다. **`transform`이 걸린 요소는 그 안의 `position: fixed`의
  // 기준(containing block)이 된다** — 그대로 두면 `inset: 0` 배경이 화면이 아니라
  // `.main` 기준이 되어 위치가 어긋나고, 배율만큼 같이 확대된다.
  // (styles.css의 "화면 줌" 절 참고.)
  return createPortal(
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
        {views && views.length > 1 && (
          <div role="group" aria-label="보기 전환" style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {views.map((v) => (
              <button
                key={v.id}
                className={v.id === activeView?.id ? 'primary' : 'ghost'}
                aria-pressed={v.id === activeView?.id}
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => setViewId(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {countText} · 총 {formatValue(totalValueKrw)}
        </p>
        {shownRows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>표시할 데이터가 없습니다.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {shownRows.map((r) => (
              <div key={r.symbol} style={{ padding: '10px 0', borderBottom: '1px solid var(--gridline)' }}>
                <div>{r.label ?? `${r.name} (${r.symbol})`}</div>
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
                {r.details && r.details.length > 0 && (
                  <ul
                    style={{
                      margin: '6px 0 0',
                      paddingLeft: 16,
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {r.details.map((d) => (
                      <li key={d.label}>
                        {d.label} · {formatValue(d.valueKrw)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
