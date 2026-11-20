// 표 정렬 공용(순수 함수, 테스트: frontend/test/sort.test.ts) — 보유 종목·종목별 수익 표가 같이 쓴다.

/**
 * 숫자 기준 정렬. 값이 없는 행(환율 미적용·투자금 0이라 비율 없음)은 **방향과 상관없이 맨 뒤** —
 * null을 0으로 치면 큰 순서에선 중간, 작은 순서에선 맨 위로 튀어 순서가 뒤죽박죽처럼 보인다.
 * 값이 같으면 원래 순서를 유지한다(Array.sort는 안정 정렬).
 */
export function sortByValue<T>(rows: T[], valueOf: (r: T) => number | null, asc: boolean): T[] {
  const dir = asc ? 1 : -1;
  return rows
    .map((r) => ({ r, v: valueOf(r) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === null ? (b.v === null ? 0 : 1) : -1;
      return (a.v - b.v) * dir;
    })
    .map((x) => x.r);
}

const textCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

/** 글자 기준 정렬(가나다, 숫자는 크기순 — "계좌2" < "계좌10"). 빈 값은 방향과 상관없이 맨 뒤. */
export function sortByText<T>(rows: T[], textOf: (r: T) => string | null | undefined, asc: boolean): T[] {
  const dir = asc ? 1 : -1;
  return rows
    .map((r) => ({ r, t: textOf(r) || null }))
    .sort((a, b) => {
      if (a.t === null || b.t === null) return a.t === null ? (b.t === null ? 0 : 1) : -1;
      return textCollator.compare(a.t, b.t) * dir;
    })
    .map((x) => x.r);
}
