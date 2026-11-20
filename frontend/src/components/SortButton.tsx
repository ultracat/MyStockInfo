/**
 * 표 열 제목 정렬 버튼(종목별 수익·보유 종목 표 공용). 다른 열을 누르면 그 열의 기본 방향으로 — 금액은 큰 순서(▼),
 * 글자 열(`text`)은 가나다 순서(▲) — 같은 열을 한 번 더 누르면 순서 반대. 정렬할 수 있지만 지금 기준이 아닌 열은 흐린 ↕로
 * 표시한다(예전엔 일반 글자처럼 보여 눌러 정렬할 수 있다는 걸 몰랐다, 2026-11-20).
 *
 * `small`은 한 칸에 금액(위)·비율(아래)이 같이 있는 열의 두 번째 기준 — 칸 모양과 맞춰 제목 아래 작은 글씨로 둔다.
 * `title` 툴팁은 Electron에서 안 뜨므로 쓰지 않는다(frontend/CLAUDE.md 관심종목 절).
 */
export default function SortButton<K extends string>({
  sortKey,
  label,
  current,
  asc,
  onChange,
  text = false,
  small = false,
}: {
  sortKey: K;
  label: string;
  current: K;
  asc: boolean;
  onChange: (key: K, asc: boolean) => void;
  /** 글자 열 — 처음 누르면 가나다 순서. */
  text?: boolean;
  small?: boolean;
}) {
  const active = current === sortKey;
  return (
    <button
      className="ghost"
      style={{
        padding: 0,
        font: 'inherit',
        color: active ? 'var(--text)' : undefined,
        ...(small ? { display: 'block', fontSize: 12, marginTop: 2 } : null),
      }}
      onClick={() => onChange(sortKey, active ? !asc : text)}
    >
      {label}
      {active ? (asc ? ' ▲' : ' ▼') : <span style={{ color: 'var(--text-muted)' }}> ↕</span>}
    </button>
  );
}

/** `<th aria-sort>` 값 — 그 열의 기준(여럿이면 그중 하나)이 지금 정렬 기준일 때만. */
export function ariaSort<K extends string>(current: K, asc: boolean, ...keys: K[]): 'ascending' | 'descending' | undefined {
  return keys.includes(current) ? (asc ? 'ascending' : 'descending') : undefined;
}
