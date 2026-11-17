/* eslint-disable */
// 한국투자증권 Open API 실서버 점검 — `npm run check:kis`
//
// 설정에 저장한 한투 키로 **조회 TR만** 불러, 응답 모양과 앱의 해석(kisAdapter·kisDividendSync)이 맞는지 확인한다.
// 주문 TR은 부르지 않는다. 계좌번호·금액·종목은 출력하지 않는다.
// ⚠ 한투 토큰은 **하루 1회** 발급 제한(EGW00133)이 있다 — 앱과 같은 kis-token.json을 재사용하고, 유효한 토큰이
//   없을 때만 한 번 받는다(그 토큰을 앱도 그대로 쓴다). 앱이 켜져 있어도 된다.
//
// `--record`(npm run kis:record): 점검하면서 **실제 응답의 모양**(블록별 필드 이름과 값의 형태 — 값 자체는 버림)을 모아
// backend/spec/snapshots/kis-live.json에 남긴다. KIS 검증 묶음(scripts/kis-verify.cjs)이 이 기록으로 타입(kisSpec.gen.ts)을 만들고,
// 앱은 평소 조회 때 이 기록과 응답 모양을 비교한다. 이번에 줄이 없던 블록(예: 해외 보유 0건)은 예전 기록을 그대로 둔다.
// 기록 모드는 점검 항목 외에 앱이 쓰는 나머지 TR(휴장일·종목명·종목 상세·ETF 구성·해외 권리)도 공개 종목으로 한 번씩 부른다.
const { runLiveCheck } = require('./lib/live-check.cjs');

const { RECORD } = require('./lib/live-check.cjs');

runLiveCheck(`한국투자증권 Open API 실서버 점검 (조회 TR만, 개인 데이터 미출력)${RECORD ? ' + 응답 모양 기록' : ''}`, async (ctx) => {
  const { log, check, num, tally, todayKst, daysAgo } = ctx;
  const kis = ctx.require('brokers/kis/kisClient.js');
  const recorder = ctx.startRecording('kis');
  const { kisAdapter } = ctx.require('brokers/kis/kisAdapter.js');
  const { classifyKisRights } = ctx.require('brokers/kis/kisDividendSync.js');
  const { getDataDir } = ctx.require('paths.js');

  if (!kis.isKisConfigured()) return log('FAIL', '자격증명', '설정 → API 키 등록에서 한국투자증권 키를 먼저 저장하세요');
  log('PASS', '자격증명', '저장돼 있음');
  // 토큰 파일은 키체인 봉투라(SecretJsonStore) 직접 JSON.parse하지 않는다.
  const { SecretJsonStore } = ctx.require('secretJsonStore.js');
  const readToken = () => new SecretJsonStore('kis-token.json', getDataDir()).read();
  const before = await readToken();
  if (!before || before.expiresAt <= Date.now()) log('INFO', '토큰', '유효한 저장 토큰이 없어 한 번 발급합니다(하루 1회 제한 중 1회 사용)');

  const accounts = await kisAdapter.listAccounts();
  const accountId = accounts[0] && accounts[0].id;
  log(accountId ? 'PASS' : 'FAIL', '계좌(자격증명의 CANO-상품코드)', accounts.length ? `${accounts.length}개` : '없음');
  if (!accountId) return;

  // 1) 국내 잔고(TTTC8434R)
  const bal = await check.step('국내 잔고 TTTC8434R', () => kis.fetchKisBalance({ forceRefresh: true }));
  const after = await readToken();
  if (after) {
    log(before && after.accessToken === before.accessToken ? 'PASS' : 'INFO', '토큰 재사용', before && after.accessToken === before.accessToken ? '저장된 토큰 그대로' : '새로 발급해 저장함');
    log(after.expiresAt > Date.now() ? 'PASS' : 'FAIL', '토큰 만료', `남은 시간 약 ${((after.expiresAt - Date.now()) / 3600_000).toFixed(1)}시간`);
  }
  if (bal) {
    check.fields('국내 잔고 요약(output2)', bal.summary, ['pchs_amt_smtl_amt', 'evlu_amt_smtl_amt', 'evlu_pfls_smtl_amt', 'dnca_tot_amt']);
    const held = bal.items.filter((r) => num(r.hldg_qty) > 0);
    check.rows('국내 보유 종목(output1)', held, ['hldg_qty', 'pchs_avg_pric', 'pchs_amt', 'prpr', 'evlu_amt', 'evlu_pfls_amt', 'evlu_pfls_rt'], ['pdno', 'prdt_name']);
    if (held.length) {
      check.reconcile('국내 평가금액 합', num(bal.summary.evlu_amt_smtl_amt), held.reduce((s, r) => s + num(r.evlu_amt), 0));
      check.reconcile('국내 매입금액 합', num(bal.summary.pchs_amt_smtl_amt), held.reduce((s, r) => s + num(r.pchs_amt), 0));
    }
  }

  // 2) 해외 잔고(CTRP6504R) — 연동 계좌에 해외 자료가 없으면 SKIP
  const ov = await check.step('해외 잔고 CTRP6504R', () => kis.fetchKisOverseasBalance({ forceRefresh: true }));
  if (ov) {
    // 해외 거래가 한 번도 없는 계좌는 USD 줄 자체가 안 온다(실측) — 보유도 없으면 SKIP, 보유가 있는데 없으면 WARN.
    if (ov.cashUsd !== null) log('PASS', '달러 예수금(output2 USD 줄)', '읽음');
    else log(ov.positions.length ? 'WARN' : 'SKIP', '달러 예수금(output2 USD 줄)', 'USD 줄 없음' + (ov.positions.length ? '' : ' — 해외 거래가 없는 계좌'));
    if (!ov.positions.length) log('SKIP', '해외 보유 종목', '0건 — 미국 주식을 보유하면 다시 확인');
    else {
      const bad = ov.positions.filter((p) => !p.symbol || p.quantity <= 0 || !(p.marketValue > 0));
      log(bad.length ? 'FAIL' : 'PASS', '해외 보유 종목 해석', `${ov.positions.length}건${bad.length ? `, ${bad.length}건 값 이상` : ''}`);
    }
  }

  // 3) 포트폴리오 전체(어댑터) — 화면이 받는 모양
  const p = await check.step('어댑터 getPortfolio', () => kisAdapter.getPortfolio(accountId, { forceRefresh: true }));
  if (p) {
    const rateOk = p.positions.every((x) => Math.abs(x.profitLossRate) < 50);
    log(rateOk ? 'PASS' : 'WARN', '수익률 단위', rateOk ? '퍼센트→소수 변환 정상 범위' : '비율이 비정상적으로 큼');
    log(typeof p.cashBalanceKrw === 'number' ? 'PASS' : 'FAIL', '원화 예수금', typeof p.cashBalanceKrw === 'number' ? '숫자' : '없음');
  }

  // 4) 매매내역(3개월 이전 CTSC9215R + 이내 TTTC0081R, 해외 TTTS3035R) — 최근 6개월
  const trades = await check.step('매매내역 어댑터(최근 6개월)', () =>
    kisAdapter.getTradeHistory(accountId, { from: daysAgo(180), to: todayKst() }, { forceRefresh: true })
  );
  if (trades) {
    if (!trades.length) log('SKIP', '매매내역', '최근 6개월 0건');
    else {
      log('INFO', '매매내역 구성', tally(trades, (t) => `${t.side}/${t.currency}`));
      const bad = trades.filter((t) => !t.symbol || !(t.quantity > 0) || !(t.price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.executedAt));
      log(bad.length ? 'FAIL' : 'PASS', '매매내역 해석', `${trades.length}건${bad.length ? `, ${bad.length}건 값 이상` : ' 모두 정상'}`);
      const ids = new Set(trades.map((t) => t.id));
      log(ids.size === trades.length ? 'PASS' : 'FAIL', '매매내역 id 중복', ids.size === trades.length ? '없음' : `${trades.length - ids.size}건`);
    }
  }

  // 5) 배당 원천 — 기간별계좌권리현황(CTRGA011R) 전체 기간
  const rights = await check.step('권리현황 CTRGA011R(배당 원천)', () => kis.fetchKisPeriodRights());
  if (rights) {
    if (!rights.length) log('SKIP', '권리현황', '0건');
    else {
      log('INFO', '권리 유형 코드', tally(rights, (r) => r.rght_type_cd || '-'));
      check.rows('권리현황 필드', rights.filter((r) => num(r.last_alct_amt) > 0), ['last_alct_amt', 'tax_amt'], ['pdno', 'cash_dfrm_dt', 'rght_type_cd']);
      const { candidates, upcoming } = classifyKisRights(rights, todayKst());
      const taxOk = candidates.every((c) => c.amount >= 0 && c.tax >= 0);
      log(taxOk ? 'PASS' : 'FAIL', '배당 해석(세후=세전−세금)', `지급 완료 ${candidates.length}건, 지급 예정 ${upcoming}건${taxOk ? '' : ' — 음수 금액 있음'}`);
      log('INFO', '배당 종류', tally(candidates, (c) => c.kind));
      // 다가오는 배당 확정 건의 "수량 × 주당" — 잔고수량(cblc_qty)이 있어야 주당 = 최종배정금액 ÷ 수량을 낸다.
      const paid = rights.filter((r) => num(r.last_alct_amt) > 0);
      const withQty = paid.filter((r) => num(r.cblc_qty) > 0);
      log(withQty.length === paid.length ? 'PASS' : 'WARN', '권리 잔고수량(cblc_qty)', `배정금액 있는 ${paid.length}건 중 ${withQty.length}건에 있음`);
      const perOk = withQty.filter((r) => { const per = num(r.last_alct_amt) / num(r.cblc_qty); return per > 0 && per < 1e7; });
      log(perOk.length === withQty.length ? 'PASS' : 'WARN', '주당 = 배정금액 ÷ 잔고수량', `${perOk.length}/${withQty.length}건 정상 범위`);
      const whole = withQty.filter((r) => Number.isInteger(Math.round((num(r.last_alct_amt) / num(r.cblc_qty)) * 1000) / 1000));
      log('INFO', '주당이 원 단위로 떨어지는 건', `${whole.length}/${withQty.length}건(국내 배당은 대개 주당 정수 원)`);
    }
  }

  // 6) 공식 실현손익(TTTC8715R) · 해외 기간손익(TTTS3039R) — 최근 1년
  const profit = await check.step('국내 실현손익 TTTC8715R(최근 1년)', () => kis.fetchKisPeriodTradeProfit(daysAgo(365), todayKst()));
  if (profit) check.rows('국내 실현손익 필드', profit, ['sll_qty', 'sll_amt', 'buy_amt', 'rlzt_pfls'], ['trad_dt', 'pdno']);
  const ovProfit = await check.step('해외 기간손익 TTTS3039R(최근 1년)', () => kis.fetchKisOverseasPeriodProfit(daysAgo(365), todayKst()));
  if (ovProfit) check.rows('해외 기간손익 필드', ovProfit.filter((r) => num(r.slcl_qty) > 0), ['slcl_qty', 'frcr_sll_amt_smtl1', 'ovrs_rlzt_pfls_amt'], ['trad_day', 'ovrs_pdno']);

  // 7) 시장 정보 TR(계좌 무관) — 다가오는 배당 일정·종목 정보
  const sched = await check.step('예탁원 배당일정 HHKDB669102C0(앞으로 30일)', () =>
    kis.fetchKisDividendSchedule(todayKst(), new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))
  );
  if (sched) {
    check.rows('배당일정 필드', sched, ['per_sto_divi_amt'], ['record_date', 'sht_cd']);
    // 지급일은 YYYY/MM/DD로 온다(2026-11-10 실측) — 형식이 바뀌면 예상 지급일이 다시 비게 된다.
    const { parseKsdDate } = ctx.require('upcomingDividends.js');
    const pays = sched.map((r) => r.divi_pay_dt).filter((d) => d && d.trim());
    const bad = pays.filter((d) => !parseKsdDate(d));
    log(bad.length ? 'FAIL' : pays.length ? 'PASS' : 'SKIP', '배당일정 지급일 형식', bad.length ? `읽지 못한 형식 ${bad.length}건(예: ${bad[0]})` : `${pays.length}건 모두 읽음`);
  }
  const price = await check.step('국내 현재가 FHKST01010100(삼성전자 시세 — 공개 정보)', () => kis.fetchKisDomesticPrice('005930', { forceRefresh: true }));
  if (price !== undefined) log(price && price > 0 ? 'PASS' : 'FAIL', '국내 현재가', price && price > 0 ? '양수' : '값 없음');
  const etf = await check.step('ETF 현재가 FHPST02400000(KODEX 200 — 공개 정보)', () => kis.fetchKisEtfPrice('069500'));
  if (etf !== undefined) check.fields('ETF 현재가 필드', etf, ['nav', 'etf_cnfg_issu_cnt']);

  if (!RECORD) return;

  // 8) 기록 모드 — 점검에 없는 나머지 TR을 공개 종목으로(삼성전자·KODEX 200·애플). 휴장일은 하루 1회 저장분을 건너뛰도록 직접 부른다.
  await check.step('휴장일 CTCA0903R', () => kis.kisGet('/uapi/domestic-stock/v1/quotations/chk-holiday', 'CTCA0903R', { BASS_DT: todayKst().replace(/-/g, ''), CTX_AREA_FK: '', CTX_AREA_NK: '' }));
  await check.step('종목명 CTPF1002R', () => kis.fetchKisStockName('005930'));
  await check.step('재무비율 FHKST66430300', () => kis.fetchKisFinancialRatio('005930'));
  await check.step('투자의견 FHKST663300C0', () => kis.fetchKisInvestOpinion('005930', daysAgo(180), todayKst()));
  await check.step('뉴스 제목 FHKST01011800', () => kis.fetchKisNewsTitles('005930'));
  await check.step('ETF 구성종목 FHKST121600C0', () => kis.fetchKisEtfComponents('069500'));
  const ahead = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  await check.step('해외 권리종합 HHDFS78330900', () => kis.fetchKisOverseasIceRights('AAPL', daysAgo(120), ahead));
  await check.step('해외 기간별권리 CTRGT011R', () => kis.fetchKisOverseasDividendRights('AAPL', daysAgo(400), todayKst()));

  // 9) 모양 저장(값 없음) — scripts/lib/live-check.cjs shapeRecorder. KIS는 타입도 이 기록으로 만든다(npm run kis:types).
  recorder.save();
  log('INFO', 'KIS', 'npm run kis:types → npm run kis:verify');
});
