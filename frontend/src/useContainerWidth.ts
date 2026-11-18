import { useCallback, useEffect, useState } from 'react';

/**
 * 차트가 들어갈 상자의 폭(레이아웃 px — 화면 줌의 transform과 무관). 예전 차트는 폭을 480px 기준으로 고정해 넓은 카드의 절반만 썼다
 * (2026-11-18 UX 점검). 상자가 아직 안 그려졌거나(숨긴 화면 = display:none → 0) 측정 전이면 `fallback`을 돌려 이전 모양 그대로 그린다.
 * ⚠ 콜백 ref다 — 차트는 데이터가 없을 때 상자 없이 안내 문구만 그리다가 나중에 상자를 그리므로, 마운트 때 한 번 재는 useRef+effect로는
 * 상자를 놓쳤다(순자산 추이가 계속 480px이던 것).
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(fallback = 480) {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 4 ? w : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, width] as const;
}
