/** Always placed as the last (rightmost) element of a card's header row. */
export default function CollapseToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button className="ghost" onClick={onClick}>
      {collapsed ? '펼치기 ▸' : '접기 ▾'}
    </button>
  );
}
