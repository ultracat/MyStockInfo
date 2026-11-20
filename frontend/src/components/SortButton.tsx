/**
 * 표 열 제목 정렬 버튼(종목별 수익·보유 종목 표 공용). 다른 열을 누르면 그 열로 큰 순서(▼),
 * 같은 열을 한 번 더 누르면 순서 반대(▲). 정렬할 수 있지만 지금 기준이 아닌 열은 흐린 ↕로 표시한다
 * (예전엔 일반 글자처럼 보여 눌러 정렬할 수 있다는 걸 몰랐다, 2026-11-20).
 */
export default function SortButton<K extends string>({
  sortKey,
  label,
  current,
  asc,
  onChange,
}: {
  sortKey: K;
  label: string;
  current: K;
  asc: boolean;
  onChange: (key: K, asc: boolean) => void;
}) {
  const active = current === sortKey;
  return (
    <button
      className="ghost"
      style={{ padding: 0, font: 'inherit', color: active ? 'var(--text)' : undefined }}
      onClick={() => onChange(sortKey, active ? !asc : false)}
      title="눌러서 이 열로 정렬 (한 번 더 누르면 순서 반대)"
    >
      {label}
      {active ? (asc ? ' ▲' : ' ▼') : <span style={{ color: 'var(--text-muted)' }}> ↕</span>}
    </button>
  );
}
