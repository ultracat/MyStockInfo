import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';
import { upsertTrades } from '../db/tradesStore';
import { resolveStockNames } from '../stockNameResolver';

export const tradesRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

tradesRouter.get('/:broker/:accountId', async (req, res) => {
  const broker = req.params.broker as BrokerId;
  const { accountId } = req.params;
  const { from, to } = req.query;
  const forceRefresh = req.query.refresh === 'true';

  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from, to 쿼리 파라미터(YYYY-MM-DD)가 필요합니다.' });
  }

  try {
    const adapter = getAdapter(broker);
    if (!adapter.isConfigured()) {
      return res.status(409).json({ error: `${adapter.displayName} API 키가 설정되지 않았습니다.` });
    }
    if (!adapter.getTradeHistory) {
      return res.status(404).json({ error: `${adapter.displayName}는 매매내역 조회를 지원하지 않습니다.` });
    }
    let trades = await adapter.getTradeHistory(accountId, { from, to }, { forceRefresh });

    // 토스 체결 내역엔 종목명이 없다(Order 스키마 자체에 필드가 없음 —
    // tossAdapter.ts의 mapOrder 참고) — stockNameResolver.ts가 토스→KIS→KB
    // 순으로 대체 조회해서 채운다(KIS/KB는 애초에 자기 체결 내역 API가 종목명을
    // 같이 내려줘서 이 목록에 안 들어옴 — kisAdapter.ts/kbClient.ts 참고, 조회할
    // 것도 없으면 이 블록 자체가 스킵됨).
    const missingNameSymbols = Array.from(new Set(trades.filter((t) => !t.name).map((t) => t.symbol)));
    if (missingNameSymbols.length > 0) {
      const { namesBySymbol } = await resolveStockNames(missingNameSymbols);
      trades = trades.map((t) => (t.name ? t : { ...t, name: namesBySymbol[t.symbol.toUpperCase()] ?? null }));
    }

    // write-through — holdings.ts와 같은 이유(CSV 내보내기, API 연동이 없는
    // 브로커 대비). id 기준 upsert라 같은 구간을 반복 조회해도 중복이 안 쌓인다.
    // 모의투자 계좌는 저장하지 않는다 — 로컬 매매 저장소는 실현손익·세금 계산의 원천이다.
    try {
      if (!(await adapter.isPaperAccount?.(accountId))) upsertTrades(broker, accountId, trades);
    } catch (storeErr) {
      console.error('[trades-store] 로컬 저장 실패:', storeErr);
    }
    res.json(trades);
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
