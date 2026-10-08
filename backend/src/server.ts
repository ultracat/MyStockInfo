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
import { backupRouter } from './routes/backup';
import { accountTaxTypesRouter } from './routes/accountTaxTypes';

export function createApp() {
  const app = express();

  // Renderer runs on a localhost Vite dev port (or file:// once packaged);
  // this backend is only ever reachable from the local machine.
  app.use(cors());
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
  app.use('/api/trades', tradesRouter);
  app.use('/api/trades-store', tradesStoreRouter);
  app.use('/api/stock-info', stockInfoRouter);
  app.use('/api/account-labels', accountLabelsRouter);
  app.use('/api/kb', kbRouter);
  app.use('/api/google', googleRouter);
  app.use('/api/about', aboutRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/portfolio-snapshots', portfolioSnapshotsRouter);
  app.use('/api/backup', backupRouter);
  app.use('/api/account-tax-types', accountTaxTypesRouter);

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
