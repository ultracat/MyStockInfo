import { useCallback, useEffect, useState } from 'react';

/** 돋보기 줌의 배율 한계. 0.5 아래는 글자가 읽히지 않고, 3 위는 한 화면에 한두 줄만 남는다. */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

/** 키보드·버튼으로 한 번에 움직이는 양(10%p). 핀치는 이것과 무관하게 연속적이다. */
const STEP = 0.1;

const STORAGE_KEY = 'mystock.zoom';

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** 1% 단위로 맞춘다 — 핀치는 연속값이라 그냥 두면 "107.3%"가 표시기에 그대로 뜬다. */
const snap = (z: number) => Math.round(z * 100) / 100;

function readStoredZoom(): number {
  // localStorage는 접근 자체가 throw할 수 있다(스토리지가 막힌 환경). 줌은 부가
  // 기능이므로 실패하면 조용히 100%로 시작한다.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? snap(clamp(parsed)) : 1;
  } catch {
    return 1;
  }
}

/**
 * 앱 화면의 돋보기 줌(CSS `transform: scale`) 배율을 관리한다.
 *
 * **이 state 하나가 배율의 단일 원천이다** — "실제 적용된 값"을 DOM에서 역산해
 * 읽는 경로를 두지 않는다. 두 곳에서 읽으면 반드시 어긋난다.
 *
 * 입력 세 가지를 모두 받는다:
 * - **트랙패드 핀치**: Chromium이 `ctrlKey`가 붙은 `wheel` 이벤트로 바꿔서 보낸다
 *   (실제 `Ctrl` 키는 안 눌려 있다). 연속값이라 배율에 곱한다.
 * - **Ctrl/Cmd + 휠**: 마우스 사용자용. 핀치보다 한 번의 `deltaY`가 훨씬 커서
 *   계수를 따로 둔다.
 * - **Cmd/Ctrl + `+` `-` `0`**: 필수다. 핀치가 ctrl+wheel로 오는 것은 Chromium의
 *   변환이라 OS·트랙패드 드라이버에 의존하고(리눅스 터치패드는 보장 못 함),
 *   터치스크린 핀치는 아래 `setVisualZoomLevelLimits(1,1)`에 막혀 이 경로로 안 온다.
 */
export function useZoom() {
  const [zoom, setZoom] = useState<number>(readStoredZoom);

  const zoomIn = useCallback(() => setZoom((z) => snap(clamp(z + STEP))), []);
  const zoomOut = useCallback(() => setZoom((z) => snap(clamp(z - STEP))), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  // 배율 저장. state가 원천이고 이 effect는 저장만 한다 — 여기서 "적용"까지 하면
  // 값이 같을 때 effect가 건너뛰어 화면과 state가 어긋난다.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(zoom));
    } catch {
      // 저장 실패는 무시한다 — 다음 실행에서 100%로 시작할 뿐이다.
    }
  }, [zoom]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // 핀치(ctrlKey) 또는 Cmd+휠. 둘 다 아니면 평범한 스크롤이므로 건드리지 않는다.
      const isPinch = e.ctrlKey;
      const isModifierWheel = e.metaKey;
      if (!isPinch && !isModifierWheel) return;

      // passive: false로 등록했기 때문에 이게 실제로 먹는다 — 안 막으면 Chromium의
      // 기본 페이지 줌이나 스크롤이 같은 제스처에 같이 걸린다.
      e.preventDefault();

      // 곱셈으로 움직인다. 덧셈으로 하면 200%에서의 한 칸이 50%에서의 한 칸보다
      // 체감상 훨씬 작다.
      const sensitivity = isPinch ? 0.01 : 0.003;
      setZoom((z) => snap(clamp(z * Math.exp(-e.deltaY * sensitivity))));
    };

    // capture: true — 안쪽 패널이나 브라우저 기본 동작보다 먼저 가로챈다.
    // passive: false — 그래야 preventDefault가 무시되지 않는다.
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      // Cmd+Shift+= 는 key가 '+'로, Cmd+= 는 '='로 온다 — 둘 다 "확대"로 받는다.
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomIn, zoomOut, resetZoom]);

  return { zoom, zoomIn, zoomOut, resetZoom };
}
