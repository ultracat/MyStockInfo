import { randomBytes } from 'node:crypto';
import { createApp } from './server';

/** apiToken은 `/api/*` 요청마다 요구하는 `Authorization: Bearer` 값이다
 *  (server.ts 참고). Electron은 실행할 때마다 새로 만들어 넘긴다. 안 주면
 *  (백엔드 단독 실행) 여기서 만들어 콘솔에 찍는다 — curl 등으로 확인할 때 쓴다. */
/** requestRestart는 백업 복원 직후 앱을 다시 띄울 때 쓴다(routes/backup.ts) — Electron
 *  메인만 넘긴다. */
/** extraOrigins는 CORS 허용 origin 추가분 — dev Vite가 5173이 아닌 포트로 떴을 때
 *  Electron 메인이 그 origin을 넘긴다(server.ts의 DEFAULT_ALLOWED_ORIGINS 참고). */
export function startServer(
  port = 4317,
  apiToken?: string,
  options: { requestRestart?: () => void; extraOrigins?: string[] } = {}
) {
  const token = apiToken ?? randomBytes(32).toString('base64url');
  if (!apiToken) console.log(`[backend] API token: ${token}`);
  const app = createApp({ apiToken: token, requestRestart: options.requestRestart, extraOrigins: options.extraOrigins });
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[backend] listening on http://127.0.0.1:${port}`);
  });

  // http.Server emits 'error' instead of throwing — without this listener,
  // Node treats it as an uncaught exception. In Electron that surfaces as
  // the generic "A JavaScript error occurred in the main process" popup
  // instead of a message that explains what actually happened (e.g. a
  // leftover process from a previous run still holding the port).
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[backend] 포트 ${port}이 이미 사용 중입니다. 이전 실행이 남아있는지 확인해주세요 ` +
          `(예: lsof -nP -iTCP:${port} -sTCP:LISTEN).`
      );
    } else {
      console.error('[backend] 서버 시작 실패:', err);
    }
  });

  return server;
}

// Allow running standalone: `npm run dev --workspace backend`.
if (require.main === module) {
  startServer();
}
