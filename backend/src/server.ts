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

export function createApp() {
  const app = express();

  // Renderer runs on a localhost Vite dev port (or file:// once packaged);
  // this backend is only ever reachable from the local machine.
  app.use(cors());
  app.use(express.json());

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
