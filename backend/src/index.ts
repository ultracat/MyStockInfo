import { createApp } from './server';

export function startServer(port = 4317) {
  const app = createApp();
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
