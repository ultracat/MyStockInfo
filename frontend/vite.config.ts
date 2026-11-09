import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // 포트는 scripts/dev.cjs가 빈 포트를 골라 MYSTOCK_VITE_PORT로 넘긴다(Electron도 같은
    // 값을 연다). strictPort는 유지 — Vite가 몰래 다른 포트로 옮겨 뜨면 Electron이
    // 엉뚱한 포트(남의 앱)를 열게 된다. 단독 실행(`npm run dev -w frontend`)은 5173.
    port: Number(process.env.MYSTOCK_VITE_PORT) || 5173,
    strictPort: true,
  },
});
