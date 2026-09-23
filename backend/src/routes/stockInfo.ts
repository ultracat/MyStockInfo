import { Router } from 'express';
import { cacheStockName, getCachedStockName } from '../db/stockNames';
import { displayNameOf, fetchTossStockInfo, isTossConfigured } from '../brokers/toss/tossClient';
import { handleBrokerApiError } from '../brokers/errors';

export const stockInfoRouter = Router();

// 토스 종목 기본 정보 API(`/api/v1/stocks`)가 symbols 파라미터에 실제로 요구하는
// 패턴(공식 API가 400과 함께 돌려주는 `data.pattern` 값 그대로) — 국내 6자리
// 숫자든 해외 티커(AAPL, BRK.B 등)든 전부 이 범위 안이다. 심볼코드 입력칸은
// 한글 IME로 다른 값(종목명 등)을 타이핑하다가도 500ms 디바운스마다 이 라우트를
// 호출하는데(Dividends.tsx), 조합 중인 자모 하나짜리 상태("ㅒ" 등)가 그대로
// 넘어오면 이 정규식 없이는 매번 토스 API까지 나갔다가 400으로 거부되고
// `[broker]` 에러 레벨로 로그만 채웠다(실사용자 리포트로 발견, 2026-09-23) —
// 여기서 먼저 걸러 API 호출 자체를 생략한다.
const TOSS_SYMBOL_PATTERN = /^[A-Za-z0-9.,-]+$/;

// 종목명 자동조회 — 이미 조회한 심볼은 로컬 캐시(SQLite)에서 바로 돌려주고,
// 처음 보는 심볼만 토스 종목 기본 정보 API를 호출한다. 국내/미국 심볼 둘 다
// 이 하나의 API로 커버되고 계좌와 무관한 시세 데이터라, 배당 기록이 kis
// 브로커 소속이어도 그대로 쓸 수 있다(브로커별로 다른 API를 안 써도 됨).
stockInfoRouter.get('/:symbol', async (req, res) => {
  const symbol = req.params.symbol.trim().toUpperCase();
  if (!symbol) {
    return res.status(400).json({ error: 'symbol이 필요합니다.' });
  }
  if (!TOSS_SYMBOL_PATTERN.test(symbol)) {
    return res.status(404).json({ error: `'${symbol}' 종목 정보를 찾을 수 없습니다. 종목코드를 확인하거나 직접 입력해주세요.` });
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
