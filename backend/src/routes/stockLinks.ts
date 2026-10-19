import { Router } from 'express';
import { deleteStockLink, listStockLinks, upsertStockLink } from '../db/stockLinks';

export const stockLinksRouter = Router();

stockLinksRouter.get('/', (_req, res) => {
  res.json(listStockLinks());
});

// body `{url}` — http(s) 주소 또는 빈 문자열("링크 없음"). 다른 스킴(javascript:,
// file: 등)은 받지 않는다: 이 값은 그대로 <a href>로 렌더링되고 Electron이
// shell.openExternal로 여는 대상이라, 임의 스킴을 허용하면 안 된다.
stockLinksRouter.put('/:symbol', (req, res) => {
  const { url } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof url !== 'string') {
    return res.status(400).json({ error: 'url(문자열)이 필요합니다.' });
  }
  const trimmed = url.trim();
  if (trimmed) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return res.status(400).json({ error: `올바른 URL이 아닙니다: ${trimmed}` });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'http:// 또는 https:// 주소만 입력할 수 있습니다.' });
    }
  }
  res.json(upsertStockLink(req.params.symbol, trimmed));
});

stockLinksRouter.delete('/:symbol', (req, res) => {
  deleteStockLink(req.params.symbol);
  res.status(204).end();
});
