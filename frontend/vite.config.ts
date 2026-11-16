import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 렌더러 CSP(Content-Security-Policy) — 패키징 빌드의 index.html에만 <meta>로 넣는다.
// 화면은 file://로 열려서(electron loadFile) 응답 헤더를 붙일 곳이 없다.
//
// 목적: 화면에 다른 출처의 스크립트가 끼어들어 로컬 백엔드(계좌·자격증명)를 호출하는 일을 막는다.
// 렌더러가 쓰는 것은 자기 파일(./assets/*)과 백엔드(http://127.0.0.1:<포트>/api)뿐이다.
// - 백엔드 포트는 4317부터 빈 포트로 옮겨 다닐 수 있어(electron/src/main.ts) 포트는 와일드카드.
// - style-src도 'self'만 — React의 style={{}}는 CSSOM으로 넣어 CSP에 걸리지 않는다.
//   <style> 태그나 style="" 문자열을 쓰는 라이브러리를 들이면 그때 여기를 같이 본다.
// - 외부 링크(토스 종목 페이지 등)는 화면 안에서 열지 않고 시스템 브라우저로 넘긴다(main.ts) — CSP와 무관.
// - 광고·외부 위젯을 넣는다면 이 화면이 아니라 격리된 별도 뷰에서 띄운다(여기에 도메인을 추가하지 않는다).
//
// dev(`npm run dev`)에는 넣지 않는다 — Vite HMR이 인라인 스크립트와 ws://를 쓴다.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  'connect-src http://127.0.0.1:*',
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'mystock-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [react(), cspMeta()],
  base: './',
  server: {
    // 포트는 scripts/dev.cjs가 빈 포트를 골라 MYSTOCK_VITE_PORT로 넘긴다(Electron도 같은
    // 값을 연다). strictPort는 유지 — Vite가 몰래 다른 포트로 옮겨 뜨면 Electron이
    // 엉뚱한 포트(남의 앱)를 열게 된다. 단독 실행(`npm run dev -w frontend`)은 5173.
    port: Number(process.env.MYSTOCK_VITE_PORT) || 5173,
    strictPort: true,
  },
});
