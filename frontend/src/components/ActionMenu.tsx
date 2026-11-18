import { useEffect, useRef, type ReactNode } from 'react';

/**
 * "가져오기·내보내기 ▾" 같은 버튼 묶음 메뉴 — 화면 머리에 CSV·Google Sheets 버튼 4~5개가 한 줄로 늘어서 정작 새로고침·필터가
 * 묻혔다(2026-11-18 UX 점검). 안의 버튼은 그대로 두고 감싸기만 한다. 버튼을 누르면 닫히고(선택 상자 조작은 열린 채), 바깥을 누르거나
 * Esc면 닫힌다. `<details>`라 키보드(Enter/Space)로도 열린다. 패널은 position:absolute라 화면 줌과 같이 커진다(포털 불필요).
 */
export default function ActionMenu({
  label,
  children,
  align = 'right',
}: {
  label: string;
  children: ReactNode;
  /** 패널을 버튼의 어느 쪽 끝에 맞출지 — 화면 머리(오른쪽 끝)는 right, 줄 왼쪽에 있으면 left. */
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details ref={ref} className="action-menu">
      <summary className="ghost-button">{label} ▾</summary>
      <div
        className="action-menu-panel"
        style={align === 'left' ? { left: 0, right: 'auto' } : undefined}
        onClick={(e) => {
          // 버튼 핸들러(파일 선택 창 열기 포함)가 먼저 돈 뒤 닫는다
          if ((e.target as HTMLElement).closest('button') && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
