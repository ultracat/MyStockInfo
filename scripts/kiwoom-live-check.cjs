/* eslint-disable */
// 키움증권 REST API 실서버 점검 — `npm run check:kiwoom`
//
// ⚠ 키움 연동은 공식 명세만 보고 만들었고 **실제 키로 한 번도 확인하지 않았다**(2026-11-09). 키를 처음 등록하면 이 점검부터
//   돌려서 FAIL·WARN을 고친다. 조회 API만 부르고(주문 API 없음), 계좌번호·금액·종목은 출력하지 않는다(필드명·건수·적요만).
// - 토큰은 앱과 같은 kiwoom-token.json을 재사용한다(앱이 켜져 있어도 된다).
// - 포털에 이 PC의 IP가 등록돼 있어야 한다 — 8010(토큰 발급 IP ≠ 요청 IP)·IP 오류가 나면 포털의 IP 등록부터 확인.
const fs = require('node:fs');
const path = require('node:path');
const { runLiveCheck } = require('./lib/live-check.cjs');

runLiveCheck('키움증권 REST API 실서버 점검 (조회 API만, 개인 데이터 미출력) — 첫 실키 확인용', async (ctx) => {
  const { log, check, num, tally, todayKst, daysAgo } = ctx;
  const kw = ctx.require('brokers/kiwoom/kiwoomClient.js');
  const m = ctx.require('brokers/kiwoom/kiwoomMappers.js');
  const { kiwoomAdapter } = ctx.require('brokers/kiwoom/kiwoomAdapter.js');
  const { getDataDir } = ctx.require('paths.js');

  if (!kw.isKiwoomConfigured()) return log('FAIL', '자격증명', '설정 → API 키 등록에서 키움증권 앱키/시크릿키를 먼저 저장하세요');
  log('PASS', '자격증명', '저장돼 있음');
  const tokenFile = path.join(getDataDir(), 'kiwoom-token.json');
  const readToken = () => (fs.existsSync(tokenFile) ? JSON.parse(fs.readFileSync(tokenFile, 'utf8')) : null);
  const before = readToken();

  // 1) 토큰 + 계좌번호조회(ka00001)
  const acct = await check.step('계좌번호조회 ka00001(토큰 발급 포함)', () => kw.fetchKiwoomAccountNo({ forceRefresh: true }));
  const after = readToken();
  if (after) {
    log(before && before.accessToken === after.accessToken ? 'PASS' : 'INFO', '토큰', before && before.accessToken === after.accessToken ? '저장된 토큰 재사용' : '새로 발급해 저장함');
    const h = (after.expiresAt - Date.now()) / 3600_000;
    log(h > 0 ? 'PASS' : 'FAIL', '토큰 만료(expires_dt 해석)', `남은 시간 약 ${h.toFixed(1)}시간 — 0 근처거나 음수면 parseKiwoomExpiry 확인`);
  }
  if (!acct) return log('INFO', '다음 확인', '8010·IP 오류면 포털에 이 PC IP 등록, 8001/8002면 앱키·시크릿키 확인');
  log(/^\d{10}$/.test(acct) ? 'PASS' : 'WARN', '계좌번호 형식', /^\d{10}$/.test(acct) ? '10자리 숫자' : `명세(10자리)와 다름: 길이 ${acct.length}`);

  // 2) 국내 잔고 kt00018
  const bal = await check.step('국내 잔고 kt00018', () => kw.fetchKiwoomDomesticBalance({ forceRefresh: true }));
  if (bal) {
    check.fields('국내 잔고 요약', bal.summary, ['tot_pur_amt', 'tot_evlt_amt', 'tot_evlt_pl']);
    const held = bal.items.filter((r) => m.kwNum(r.rmnd_qty) > 0);
    check.rows('국내 보유 종목 필드', held, ['rmnd_qty', 'pur_amt', 'evlt_amt', 'evltv_prft', 'cur_prc'], ['stk_cd', 'stk_nm']);
    if (held.length) {
      const pos = m.mapKiwoomDomesticPositions(held);
      check.reconcile('국내 매입금액 합', m.kwNum(bal.summary.tot_pur_amt), pos.reduce((s, p) => s + p.purchaseAmount, 0));
      check.reconcile('국내 평가금액 합', m.kwNum(bal.summary.tot_evlt_amt), pos.reduce((s, p) => s + p.marketValue, 0));
      log('INFO', '종목코드 접두어', tally(held, (r) => String(r.stk_cd || '').slice(0, 1) || '-'));
      if (pos.length < held.length) log('INFO', '같은 종목 여러 줄', `${held.length}줄 → ${pos.length}종목으로 합침(현금·신용 잔고 등)`);
    }
  }

  // 3) 예수금 kt00001 · 미국 잔고 ust21070 · 달러 예수금 ust21110
  const dep = await check.step('예수금 kt00001', () => kw.fetchKiwoomDeposit({ forceRefresh: true }));
  if (dep) check.fields('예수금 필드', dep, ['entr']);
  const us = await check.step('미국 잔고 ust21070', () => kw.fetchKiwoomUsBalance({ forceRefresh: true }));
  if (us) {
    const held = us.items.filter((r) => m.kwNum(r.poss_qty) > 0);
    check.rows('미국 보유 종목 필드', held, ['poss_qty', 'frgn_stk_book_amt', 'evlt_amt', 'pl_amt', 'now_pric'], ['stk_cd', 'crnc_code']);
    if (held.length) check.reconcile('미국 평가금액 합(USD)', m.kwNum(us.summary.tot_evlt_amt), m.mapKiwoomUsPositions(held).reduce((s, p) => s + p.marketValue, 0));
  }
  const usDep = await check.step('달러 예수금 ust21110', () => kw.fetchKiwoomUsDeposit({ forceRefresh: true }));
  if (usDep) {
    const usd = kw.listOf(usDep, 'result_list').find((r) => String(r.crnc_code || '').trim() === 'USD');
    log(usd ? 'PASS' : 'WARN', '달러 예수금 USD 줄', usd ? 'fc_entra 읽음' : 'USD 줄 없음');
  }

  // 4) 어댑터 포트폴리오(화면이 받는 모양)
  const p = await check.step('어댑터 getPortfolio', () => kiwoomAdapter.getPortfolio(acct, { forceRefresh: true }));
  if (p) {
    const rateOk = p.positions.every((x) => Math.abs(x.profitLossRate) < 50);
    log(rateOk ? 'PASS' : 'WARN', '수익률 단위', rateOk ? '정상 범위' : '비율이 비정상적으로 큼');
  }

  // 5) 매매 — kt00015 매수(4)·매도(5), 최근 6개월. 국내/미국 줄의 종목코드·단가 형식을 확인한다.
  const from = daysAgo(180);
  const to = todayKst();
  for (const [tp, side] of [['4', 'BUY'], ['5', 'SELL']]) {
    const rows = await check.step(`매매 kt00015 tp=${tp}`, () => kw.fetchKiwoomTransactions(from, to, tp, '0', { forceRefresh: true }));
    if (!rows) continue;
    const nm = side === 'BUY' ? '매수' : '매도';
    if (!rows.length) {
      log('SKIP', `${nm} 내역(최근 6개월)`, '0건');
      continue;
    }
    log('INFO', `${nm} 적요·통화`, tally(rows, (r) => `${r.rmrk_nm}/${r.crnc_cd || '-'}`));
    check.rows(`${nm} 필드`, rows, ['trde_qty_jwa_cnt', 'trde_amt'], ['trde_dt', 'trde_no', 'stk_cd', 'crnc_cd']);
    const t = m.mapKiwoomTrades(rows, side);
    log(t.length ? 'PASS' : 'WARN', `${nm} 해석`, `${rows.length}건 중 ${t.length}건을 체결로 읽음(KRW·USD만)`);
    const usdRows = rows.filter((r) => String(r.crnc_cd || '').toUpperCase() === 'USD');
    if (usdRows.length) log('INFO', `${nm} 미국 줄 종목코드 형식`, tally(usdRows, (r) => (/^[A-Z.]{1,6}$/.test(String(r.stk_cd)) ? '티커' : /^[AJQ]\d{6}$/.test(String(r.stk_cd)) ? '국내형' : '기타')));
    const ids = new Set(t.map((x) => x.id));
    log(ids.size === t.length ? 'PASS' : 'FAIL', `${nm} id 중복`, ids.size === t.length ? '없음' : `${t.length - ids.size}건`);
  }

  // 6) 배당 — 입금(6) 중 배당·분배 적요. 세후/세전 가정 확인용으로 금액 관계만 본다.
  const dep6 = await check.step('입금 kt00015 tp=6(배당 후보, 최근 1년)', () => kw.fetchKiwoomTransactions(daysAgo(365), to, '6', '0', { forceRefresh: true }));
  if (dep6) {
    if (!dep6.length) log('SKIP', '입금 내역', '0건');
    else {
      log('INFO', '입금 적요·통화', tally(dep6, (r) => `${r.rmrk_nm}/${r.crnc_cd || '-'}/${r.stk_cd ? '종목' : '-'}`));
      const like = dep6.filter((r) => /배당|분배/.test(String(r.rmrk_nm || '')));
      const c = m.classifyKiwoomDividends(dep6);
      if (like.length) log(c.length === like.length ? 'PASS' : 'WARN', '배당 판별', `배당·분배 적요 ${like.length}건 중 ${c.length}건을 배당으로 읽음`);
      const krw = like.filter((r) => (r.crnc_cd || 'KRW') === 'KRW');
      const netOk = krw.filter((r) => Math.abs(m.kwNum(r.trde_amt) - m.kwNum(r.exct_amt) - m.kwNum(r.incm_resi_tax)) <= 1).length;
      if (krw.length) log(netOk === krw.length ? 'PASS' : 'WARN', '원화 배당 세후 가정', `거래금액 = 정산금액 + 소득/주민세인 줄 ${netOk}/${krw.length} — 아니면 classifyKiwoomDividends 금액 필드 수정`);
    }
  }

  // 7) 입출금(1)·입출고(2) — 입금 기준 원금
  const flows = await check.step('입출금 kt00015 tp=1(최근 1년)', () => kw.fetchKiwoomTransactions(daysAgo(365), to, '1', '0', { forceRefresh: true }));
  if (flows) {
    if (!flows.length) log('SKIP', '입출금 내역', '0건');
    else {
      log('INFO', '입출금 유형·적요', tally(flows, (r) => `${r.io_tp_nm}/${r.rmrk_nm}/${r.crnc_cd || '-'}`));
      const read = flows.filter((r) => m.kiwoomFlowDirection(r)).length;
      log(read ? 'PASS' : 'WARN', '원금 입출금 해석', `${flows.length}건 중 ${read}건을 입금/출금으로 읽음`);
    }
  }

  // 8) 공식 실현손익 — 국내 ka10073, 미국 ust21530(원화)
  const real = await check.step('국내 실현손익 ka10073(최근 1년)', () => kw.fetchKiwoomDomesticRealized(daysAgo(365), to));
  if (real) {
    check.rows('국내 실현손익 필드', real, ['cntr_qty', 'cntr_pric', 'buy_uv', 'tdy_sel_pl'], ['dt', 'stk_cd']);
    const rows = m.mapKiwoomDomesticRealized(real);
    const ok = rows.filter((r) => Math.abs(r.sellAmount - r.buyAmount - r.fee - r.tax - r.realized) <= Math.max(1, r.sellAmount * 0.001)).length;
    if (rows.length) log(ok === rows.length ? 'PASS' : 'WARN', '실현손익 = 매도 − 매입 − 수수료 − 세금', `${ok}/${rows.length}건 일치`);
  }
  const usReal = await check.step('미국 실현손익 ust21530(최근 1년, 원화)', () => kw.fetchKiwoomUsRealized(daysAgo(365), to));
  if (usReal) check.rows('미국 실현손익 필드', usReal, ['sell_qty', 'sell_amt', 'buy_amt', 'pl_amt'], ['sell_dt', 'stk_cd']);
});
