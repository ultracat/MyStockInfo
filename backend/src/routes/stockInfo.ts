import { Router } from 'express';
import { cacheStockName, getCachedStockName } from '../db/stockNames';
import { displayNameOf, fetchTossStockInfo, isTossConfigured } from '../brokers/toss/tossClient';
import { handleBrokerApiError } from '../brokers/errors';

export const stockInfoRouter = Router();

// 종목명 자동조회 — 이미 조회한 심볼은 로컬 캐시(SQLite)에서 바로 돌려주고,
// 처음 보는 심볼만 토스 종목 기본 정보 API를 호출한다. 국내/미국 심볼 둘 다
// 이 하나의 API로 커버되고 계좌와 무관한 시세 데이터라, 배당 기록이 kis
// 브로커 소속이어도 그대로 쓸 수 있다(브로커별로 다른 API를 안 써도 됨).
stockInfoRouter.get('/:symbol', async (req, res) => {
  const symbol = req.params.symbol.trim().toUpperCase();
  if (!symbol) {
    return res.status(400).json({ error: 'symbol이 필요합니다.' });
  }

  const cached = getCachedStockName(symbol);
  if (cached) {
    return res.json({ symbol: cached.symbol, name: cached.name, market: cached.market, currency: cached.currency });
  }

  if (!isTossConfigured()) {
    return res.status(409).json({
      error: '종목명 자동조회는 토스증권 연동이 필요합니다. 설정 화면에서 토스증권 API 키를 등록하거나, 종목명을 직접 입력해주세요.',
    });
  }

  try {
    const results = await fetchTossStockInfo([symbol]);
    const info = results.find((r) => r.symbol.toUpperCase() === symbol) ?? results[0];
    if (!info) {
      return res.status(404).json({ error: `'${symbol}' 종목 정보를 찾을 수 없습니다. 종목코드를 확인하거나 직접 입력해주세요.` });
    }

    const entry = {
      symbol: info.symbol,
      name: displayNameOf(info),
      market: info.market ?? null,
      currency: info.currency ?? null,
      cachedAt: new Date().toISOString(),
    };
    cacheStockName(entry);
    res.json({ symbol: entry.symbol, name: entry.name, market: entry.market, currency: entry.currency });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
