import { Router } from 'express';
import {
  fetchKisEtfComponents,
  fetchKisEtfPrice,
  fetchKisFinancialRatio,
  fetchKisInvestOpinion,
  fetchKisNewsTitles,
  fetchKisPeriodTradeProfit,
  getKisAccountId,
  isKisConfigured,
} from '../brokers/kis/kisClient';
import { todayKst } from '../marketInsights';
import { handleBrokerApiError } from '../brokers/errors';

export const kisReportsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 한국투자증권이 직접 계산한 국내 매도 실현손익(기간별매매손익현황 `TTTC8715R`) — 실현손익 화면이 앱의 이동평균
// 추정치와 나란히 비교하는 데 쓴다. 매도 체결 한 줄씩, 금액은 원.
kisReportsRouter.get('/realized', async (req, res) => {
  if (!isKisConfigured()) return res.status(409).json({ error: '한국투자증권 API 키가 설정되지 않았습니다.' });
  const { from, to } = req.query;
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to(YYYY-MM-DD)가 필요합니다.' });
  }
  try {
    const rows = await fetchKisPeriodTradeProfit(from, to);
    const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    res.json({
      accountId: getKisAccountId(),
      rows: rows
        .filter((r) => n(r.sll_qty) > 0)
        .map((r) => ({
          date: `${r.trad_dt.slice(0, 4)}-${r.trad_dt.slice(4, 6)}-${r.trad_dt.slice(6, 8)}`,
          symbol: r.pdno.trim(),
          name: r.prdt_name.trim(),
          quantity: n(r.sll_qty),
          sellAmount: n(r.sll_amt),
          buyAmount: n(r.buy_amt),
          realized: n(r.rlzt_pfls),
          fee: n(r.fee),
          tax: n(r.tl_tax),
        })),
    });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

// ---------------------------------------------------------------- 종목 상세(관심종목 화면)
// 국내 종목 하나의 KIS 시세 참조 정보를 한 번에 — ETF면 NAV·괴리율·추적오차·구성 종목(상위 30, KIS가 그만큼만 준다),
// 주식이면 연간 재무비율·최근 6개월 증권사 투자의견. 뉴스·공시 제목은 둘 다. 부분 실패는 그 칸만 null(나머지는 보여줌).
// ETF 판정: ETF 현재가 TR의 구성 종목 수(`etf_cnfg_issu_cnt`)가 0보다 크면 ETF(주식이면 NAV 등이 전부 0으로 온다, 실측).

const DOMESTIC_RE = /^[0-9A-Z]{6}$/;
const num = (v: string | undefined) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const ymdDash = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

// `etf_dvdn_cycl` 코드표는 문서에 없다 — 실측 KODEX 200(분기 분배)이 '3'. 모르는 값은 그대로 둔다.
const DIVIDEND_CYCLE: Record<string, string> = { '0': '없음', '1': '월', '2': '반기', '3': '분기', '4': '연' };

kisReportsRouter.get('/stock-detail/:symbol', async (req, res) => {
  if (!isKisConfigured()) return res.status(409).json({ error: '한국투자증권 API 키가 설정되지 않았습니다.' });
  const symbol = req.params.symbol.toUpperCase();
  if (!DOMESTIC_RE.test(symbol)) return res.status(400).json({ error: '국내 6자리 종목코드만 지원합니다.' });
  try {
    const etfPrice = await fetchKisEtfPrice(symbol);
    const isEtf = (num(etfPrice?.etf_cnfg_issu_cnt) ?? 0) > 0;

    const newsP = settle(fetchKisNewsTitles(symbol)).then((rows) =>
      rows === null
        ? null
        : rows
            .filter((n) => Array.from({ length: 10 }, (_, i) => n[`iscd${i + 1}`]).includes(symbol))
            .slice(0, 15)
            .map((n) => ({
              date: ymdDash(n.data_dt),
              time: /^\d{6}$/.test(n.data_tm) ? `${n.data_tm.slice(0, 2)}:${n.data_tm.slice(2, 4)}` : '',
              title: (n.hts_pbnt_titl_cntt ?? '').trim(),
              source: (n.dorg ?? '').trim(),
            }))
    );

    if (isEtf && etfPrice) {
      const comp = await settle(fetchKisEtfComponents(symbol));
      const cycle = (etfPrice.etf_dvdn_cycl ?? '').trim();
      return res.json({
        kind: 'etf',
        etf: {
          price: num(etfPrice.stck_prpr),
          nav: num(etfPrice.nav),
          premiumRate: num(etfPrice.dprt),
          trackingErrorRate: num(etfPrice.trc_errt),
          netAssetsEok: num(etfPrice.etf_ntas_ttam),
          componentCount: num(etfPrice.etf_cnfg_issu_cnt),
          dividendCycle: DIVIDEND_CYCLE[cycle] ?? (cycle || null),
          manager: (etfPrice.mbcr_name ?? '').replace(/\(ETF\)$/, '').trim() || null,
          benchmark: (etfPrice.etf_rprs_bstp_kor_isnm ?? '').trim() || null,
          components:
            comp?.components.map((c) => ({
              symbol: c.stck_shrn_iscd,
              name: (c.hts_kor_isnm ?? '').trim(),
              weight: num(c.etf_cnfg_issu_rlim),
              changeRate: num(c.prdy_ctrt),
            })) ?? null,
        },
        news: await newsP,
      });
    }

    const today = todayKst();
    const sixMonthsAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 183 * 864e5).toISOString().slice(0, 10);
    const [fin, opinions] = await Promise.all([
      settle(fetchKisFinancialRatio(symbol)),
      settle(fetchKisInvestOpinion(symbol, sixMonthsAgo, today)),
    ]);
    res.json({
      kind: 'stock',
      financials:
        fin?.slice(0, 5).map((f) => ({
          period: /^\d{6}$/.test(f.stac_yymm) ? `${f.stac_yymm.slice(0, 4)}-${f.stac_yymm.slice(4)}` : f.stac_yymm,
          revenueGrowth: num(f.grs),
          operatingIncomeGrowth: num(f.bsop_prfi_inrt),
          netIncomeGrowth: num(f.ntin_inrt),
          roe: num(f.roe_val),
          eps: num(f.eps),
          bps: num(f.bps),
          debtRatio: num(f.lblt_rate),
        })) ?? null,
      opinions:
        opinions?.slice(0, 20).map((o) => ({
          date: ymdDash(o.stck_bsop_date),
          firm: (o.mbcr_name ?? '').trim(),
          opinion: (o.invt_opnn ?? '').trim(),
          previousOpinion: (o.rgbf_invt_opnn ?? '').trim() || null,
          targetPrice: num(o.hts_goal_prc),
        })) ?? null,
      news: await newsP,
    });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
