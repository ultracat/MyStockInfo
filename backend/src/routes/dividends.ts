import { Router } from 'express';
import { addDividend, deleteDividend, listDividends, updateDividendNames } from '../db/dividends';
import { cacheStockName } from '../db/stockNames';
import { displayNameOf, fetchTossStockInfo, isTossConfigured } from '../brokers/toss/tossClient';
import { handleBrokerApiError } from '../brokers/errors';

export const dividendsRouter = Router();

dividendsRouter.get('/', (_req, res) => {
  res.json(listDividends());
});

// 기존 배당 기록의 종목명을 전부 API로 얻어온 이름으로 갱신한다(수동 입력 당시
// 오타/제각각 표기였던 것들 정리 목적). 토스 종목 기본 정보 조회는 최대 200개
// 심볼을 콤마로 묶어 한 번에 조회할 수 있어서(공식 문서), 기록이 몇 백 건이어도
// 실제 API 호출은 (고유 심볼 수 / 200)번뿐이다.
dividendsRouter.post('/refresh-names', async (_req, res) => {
  if (!isTossConfigured()) {
    return res.status(409).json({ error: '종목명 갱신은 토스증권 연동이 필요합니다.' });
  }

  const records = listDividends();
  const uniqueSymbols = Array.from(new Set(records.map((r) => r.symbol)));
  if (uniqueSymbols.length === 0) {
    return res.json({ updated: 0, resolved: 0, failed: [] });
  }

  try {
    const namesBySymbol: Record<string, string> = {};
    const resolvedSymbols = new Set<string>();

    for (let i = 0; i < uniqueSymbols.length; i += 200) {
      const chunk = uniqueSymbols.slice(i, i + 200);
      const infos = await fetchTossStockInfo(chunk);
      for (const info of infos) {
        const name = displayNameOf(info);
        namesBySymbol[info.symbol] = name;
        resolvedSymbols.add(info.symbol);
        cacheStockName({
          symbol: info.symbol,
          name,
          market: info.market ?? null,
          currency: info.currency ?? null,
          cachedAt: new Date().toISOString(),
        });
      }
    }

    const updated = updateDividendNames(namesBySymbol);
    const failed = uniqueSymbols.filter((s) => !resolvedSymbols.has(s));
    res.json({ updated, resolved: resolvedSymbols.size, failed });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

dividendsRouter.post('/', (req, res) => {
  const { broker, symbol, name, currency, amount, paidDate, memo } = req.body ?? {};

  if (
    typeof broker !== 'string' ||
    typeof symbol !== 'string' ||
    !symbol ||
    typeof name !== 'string' ||
    !name ||
    (currency !== 'KRW' && currency !== 'USD') ||
    typeof amount !== 'number' ||
    amount <= 0 ||
    typeof paidDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)
  ) {
    return res.status(400).json({
      error: 'broker, symbol, name, currency(KRW|USD), amount(양수), paidDate(YYYY-MM-DD)가 필요합니다.',
    });
  }

  const record = addDividend({
    broker: broker as any,
    symbol,
    name,
    currency,
    amount,
    paidDate,
    memo: typeof memo === 'string' ? memo : null,
  });
  res.status(201).json(record);
});

dividendsRouter.delete('/:id', (req, res) => {
  const removed = deleteDividend(req.params.id);
  if (!removed) return res.status(404).json({ error: '해당 배당 기록을 찾을 수 없습니다.' });
  res.status(204).end();
});
