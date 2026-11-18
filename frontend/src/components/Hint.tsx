import { useState, type ReactNode } from 'react';

/**
 * 카드 안의 회색 설명 문단 — 처음엔 **한 줄만** 보이고 "자세히"를 누르면 펼친다(2026-11-18 UX 점검: 카드마다 3~5줄 설명이 숫자보다
 * 먼저 눈에 들어와 화면이 길고 빽빽했다). 설명 내용은 그대로 두고 보이는 양만 줄인다 — 계산 근거·한계를 숨기지 않는다는 원칙은 유지.
 * `card`면 카드 상자로 감싼다(화면 맨 위의 단독 안내문).
 */
export default function Hint({ children, card = false }: { children: ReactNode; card?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hint${open ? ' open' : ''}${card ? ' card' : ''}`}>
      <div className="hint-body">{children}</div>
      <button type="button" className="hint-toggle no-print" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '접기' : '자세히'}
      </button>
    </div>
  );
}
