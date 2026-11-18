/**
 * 긴 화면 위쪽의 바로가기(배당금·실현손익·설정 — 카드가 많아 3,500px를 넘는다, 2026-11-18 UX 점검). 누르면 그 카드로 부드럽게 스크롤한다.
 * 스크롤 상자는 `.zoom-viewport`지만 scrollIntoView가 가장 가까운 스크롤 조상을 알아서 움직인다. 대상이 아직 없으면(조건부 카드) 아무 일도 없다.
 */
export default function SectionNav({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <nav className="section-nav no-print" aria-label="이 화면 바로가기">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
