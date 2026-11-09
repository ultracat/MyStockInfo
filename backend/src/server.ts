import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { settingsRouter } from './routes/settings';
import { accountsRouter } from './routes/accounts';
import { holdingsRouter } from './routes/holdings';
import { holdingsStoreRouter } from './routes/holdingsStore';
import { dividendsRouter } from './routes/dividends';
import { marketInfoRouter } from './routes/marketInfo';
import { tradesRouter } from './routes/trades';
import { tradesStoreRouter } from './routes/tradesStore';
import { stockInfoRouter } from './routes/stockInfo';
import { accountLabelsRouter } from './routes/accountLabels';
import { kbRouter } from './routes/kb';
import { googleRouter } from './routes/google';
import { aboutRouter } from './routes/about';
import { watchlistRouter } from './routes/watchlist';
import { portfolioSnapshotsRouter } from './routes/portfolioSnapshots';
import { createBackupRouter } from './routes/backup';
import { accountTaxTypesRouter } from './routes/accountTaxTypes';
import { kisReportsRouter } from './routes/kisReports';
import { tossReportsRouter } from './routes/tossReports';
import { nhReportsRouter } from './routes/nhReports';
import { stockLinksRouter } from './routes/stockLinks';

// 127.0.0.1에만 리슨해도 **같은 머신의 브라우저에서 열린 아무 웹페이지**가 이 서버로
// fetch할 수 있다(로컬 리슨은 다른 머신만 막는다) — 예전엔 `cors()`가 모든 origin을
// 허용해서 그 페이지가 백업 zip(계좌번호·보유종목·KIS/KB 토큰)을 그대로 읽을 수
// 있었다. 이제는 앱을 켤 때마다 만드는 무작위 토큰을 `/api/*` 요청마다
// `Authorization: Bearer <token>`으로 요구한다 — 토큰은 Electron 메인이 렌더러를
// 열 때 URL 해시로만 넘기므로(electron/src/main.ts) 다른 페이지는 알 수 없다.
// CORS 허용 origin을 좁힌 건 보조 수단이고, 실제로 막는 건 토큰이다(origin
// `null`은 sandboxed iframe도 보낼 수 있다).
// dev Vite 포트는 scripts/dev.cjs가 빈 포트를 골라 정하므로(5173이 아닐 수 있음)
// Electron 메인이 그 origin을 `extraOrigins`로 넘긴다 — 와일드카드(localhost:*)로
// 넓히지 않는다.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173', // dev: Vite(기본 포트, 백엔드 단독 실행 + Vite 단독 실행)
  'null', // 패키징: loadFile()로 연 file:// 페이지의 Origin
];

function tokenMatches(header: string | undefined, token: string): boolean {
  const prefix = 'Bearer ';
  if (!header?.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createApp(options: { apiToken: string; requestRestart?: () => void; extraOrigins?: string[] }) {
  const app = express();

  app.use(cors({ origin: [...DEFAULT_ALLOWED_ORIGINS, ...(options.extraOrigins ?? [])] }));
  // cors()가 preflight(OPTIONS)에 먼저 응답하고 끝내므로 여기까지 오는 건 실제
  // 요청뿐이다 — preflight엔 커스텀 헤더가 실리지 않아 토큰 검사를 하면 안 된다.
  app.use('/api', (req, res, next) => {
    if (tokenMatches(req.headers.authorization, options.apiToken)) return next();
    res.status(401).json({ error: '인증 토큰이 없거나 올바르지 않습니다. 앱을 다시 실행해주세요.' });
  });
  // 기본 제한(100kb)으로는 데이터 백업 복원(zip을 base64로 감싼 JSON body,
  // routes/backup.ts)이 조금만 쌓여도 막힌다 — 이 앱 전체가 JSON body만 쓰는
  // 관례를 유지하려고 별도 multipart/raw 파서 대신 여기 제한값만 올렸다.
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/settings', settingsRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/holdings', holdingsRouter);
  app.use('/api/holdings-store', holdingsStoreRouter);
  app.use('/api/dividends', dividendsRouter);
  app.use('/api/market-info', marketInfoRouter);
  app.use('/api/kis', kisReportsRouter);
  app.use('/api/toss', tossReportsRouter);
  app.use('/api/nh', nhReportsRouter);
  app.use('/api/trades', tradesRouter);
  app.use('/api/trades-store', tradesStoreRouter);
  app.use('/api/stock-info', stockInfoRouter);
  app.use('/api/account-labels', accountLabelsRouter);
  app.use('/api/kb', kbRouter);
  app.use('/api/google', googleRouter);
  app.use('/api/about', aboutRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/portfolio-snapshots', portfolioSnapshotsRouter);
  app.use('/api/backup', createBackupRouter({ requestRestart: options.requestRestart }));
  app.use('/api/account-tax-types', accountTaxTypesRouter);
  app.use('/api/stock-links', stockLinksRouter);

  // Last-resort safety net: any route that throws without its own
  // try/catch would otherwise fall through to Express's default HTML error
  // page, which the frontend can't parse as JSON and reports as a bare
  // "요청 실패: 500". This guarantees a JSON body with the real message
  // instead, and logs the stack server-side for debugging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] Unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: err instanceof Error ? err.message : '알 수 없는 서버 오류가 발생했습니다.' });
  });

  return app;
}
