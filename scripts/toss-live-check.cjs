/* eslint-disable */
// 토스증권 Open API 실서버 점검 — `npm run check:toss`
//
// 설정에 저장한 토스 키로 **조회 API만** 불러, 응답 모양과 앱의 해석(tossAdapter·tossDividendSync·tossCashFlows)이
// 맞는지 확인한다. 주문 API는 부르지 않는다. 계좌번호·금액·종목은 출력하지 않는다.
// ⚠ 토스는 **클라이언트당 유효 토큰이 하나**다 — 이 점검이 토큰을 새로 받으면 켜져 있는 앱의 토큰이 무효가 된다.
//   그래서 MyStock 앱이 떠 있으면 시작하지 않는다(앱을 닫고 돌리거나, 감수하려면 `-- --force`).
const { runLiveCheck, isAppRunning } = require('./lib/live-check.cjs');

if (isAppRunning() && !process.argv.includes('--force')) {
  console.error(
    'MyStock 앱이 실행 중입니다. 토스증권은 토큰이 하나뿐이라 점검이 새 토큰을 받으면 앱의 토큰이 끊깁니다.\n' +
      '앱을 닫고 다시 실행하세요(그래도 진행하려면: npm run check:toss -- --force).'
  );
  process.exit(2);
}

runLiveCheck('토스증권 Open API 실서버 점검 (조회 API만, 개인 데이터 미출력)', async (ctx) => {
  const { log, check, tally, todayKst, daysAgo } = ctx;
  const toss = ctx.require('brokers/toss/tossClient.js');
  const { tossAdapter } = ctx.require('brokers/toss/tossAdapter.js');
  const { summarizeTossCashFlows } = ctx.require('brokers/toss/tossCashFlows.js');

  if (!toss.isTossConfigured()) return log('FAIL', '자격증명', '설정 → API 키 등록에서 토스증권 Client ID/Secret을 먼저 저장하세요');
  log('PASS', '자격증명', '저장돼 있음');
  log('INFO', '토큰', '토스 토큰은 메모리에만 두므로 점검마다 한 번 새로 받습니다');

  const accounts = await check.step('계좌 목록 /api/v1/accounts', () => tossAdapter.listAccounts({ forceRefresh: true }));
  if (!accounts) return;
  log(accounts.length ? 'PASS' : 'FAIL', '계좌 목록', accounts.length ? tally(accounts, (a) => a.accountType || '-') : '없음');

  for (const [i, acct] of accounts.entries()) {
    const label = `계좌#${i + 1}(${acct.accountType || '-'})`;
    console.log(`\n── ${label}`);
    const seq = Number(acct.id);

    // 1) 보유(/api/v1/holdings) — 문자열 금액을 숫자로 바꾸는 파서가 다 통과하는지
    const h = await check.step(`${label} 보유 /api/v1/holdings`, () => toss.fetchTossHoldings(seq, { forceRefresh: true }));
    if (h) {
      log('PASS', `${label} 보유 응답 해석`, `종목 ${h.items.length}건, 모든 금액 필드 숫자 변환 성공`);
      if (h.items.length) {
        log('INFO', `${label} 보유 시장·통화`, tally(h.items, (x) => `${x.marketCountry}/${x.currency}`));
        const krwItems = h.items.filter((x) => x.currency === 'KRW');
        if (krwItems.length === h.items.length) {
          check.reconcile(`${label} 매입금액 합`, h.totalPurchaseAmount.krw, krwItems.reduce((s, x) => s + x.marketValue.purchaseAmount, 0));
        }
        const rateOk = h.items.every((x) => Math.abs(x.profitLoss.rateAfterCost) < 50);
        log(rateOk ? 'PASS' : 'WARN', `${label} 수익률 단위`, rateOk ? '소수 비율' : '비율이 비정상적으로 큼');
      }
    }

    // 2) 예수금(매수 가능 금액) 원·달러
    for (const cur of ['KRW', 'USD']) {
      const v = await check.step(`${label} 매수가능금액 ${cur}`, () => toss.fetchTossBuyingPower(seq, cur, { forceRefresh: true }));
      if (v !== undefined) log(Number.isFinite(v) ? 'PASS' : 'FAIL', `${label} 예수금 ${cur}`, Number.isFinite(v) ? '숫자' : '숫자 아님');
    }

    // 3) 어댑터 포트폴리오(화면이 받는 모양)
    const p = await check.step(`${label} 어댑터 getPortfolio`, () => tossAdapter.getPortfolio(acct.id, { forceRefresh: true }));
    if (p) log(p.positions.length === (h ? h.items.length : p.positions.length) ? 'PASS' : 'FAIL', `${label} 포트폴리오 매핑`, `종목 ${p.positions.length}건`);

    // 4) 매매내역(/api/v1/orders CLOSED) — 최근 6개월
    const trades = await check.step(`${label} 매매내역 /api/v1/orders(최근 6개월)`, () =>
      tossAdapter.getTradeHistory(acct.id, { from: daysAgo(180), to: todayKst() }, { forceRefresh: true })
    );
    if (trades) {
      if (!trades.length) log('SKIP', `${label} 매매내역`, '최근 6개월 체결 0건');
      else {
        log('INFO', `${label} 매매내역 구성`, tally(trades, (t) => `${t.side}/${t.currency}`));
        const bad = trades.filter((t) => !t.symbol || !(t.quantity > 0) || !(t.price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.executedAt));
        log(bad.length ? 'FAIL' : 'PASS', `${label} 매매내역 해석`, `${trades.length}건${bad.length ? `, ${bad.length}건 값 이상` : ' 모두 정상'}`);
        const ids = new Set(trades.map((t) => t.id));
        log(ids.size === trades.length ? 'PASS' : 'FAIL', `${label} 매매내역 id 중복`, ids.size === trades.length ? '없음' : `${trades.length - ids.size}건`);
      }
    }

    // 5) 거래내역(/api/v1/transactions) — 배당 동기화·입금 기준 원금의 원천. 전체 기간.
    const txns = await check.step(`${label} 거래내역 /api/v1/transactions`, () =>
      toss.fetchTossTransactions(seq, { types: ['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE', 'EXCHANGE_IN', 'EXCHANGE_OUT', 'SECURITIES_TRANSFER_IN', 'SECURITIES_TRANSFER_OUT'] })
    );
    if (txns) {
      if (!txns.length) log('SKIP', `${label} 거래내역`, '0건');
      else {
        log('INFO', `${label} 거래 종류`, tally(txns, (t) => t.transactionType));
        const unknownTypes = txns.filter((t) => !t.settlementDate || !/^\d{4}-\d{2}-\d{2}$/.test(t.settlementDate));
        log(unknownTypes.length ? 'FAIL' : 'PASS', `${label} 결제일 형식`, unknownTypes.length ? `${unknownTypes.length}건 형식 이상` : 'YYYY-MM-DD');
        const s = summarizeTossCashFlows(txns);
        log('PASS', `${label} 입금 기준 원금 요약`, `연도 ${s.byYear.length}개, 원화 환산 ${s.netPrincipalKrw === null ? '불가(환율 없는 달러 입출금)' : '가능'}`);
      }
    }
  }

  // 6) 계좌 무관 시장 정보
  const fx = await check.step('환율 /api/v1/exchange-rate USD/KRW', () => tossAdapter.getExchangeRate('USD', 'KRW', { forceRefresh: true }));
  if (fx) log(fx.rate > 500 && fx.rate < 5000 ? 'PASS' : 'WARN', '환율 범위', fx.rate > 500 && fx.rate < 5000 ? '정상 범위' : '범위 밖');
  for (const c of ['KR', 'US']) {
    const cal = await check.step(`장 운영 /api/v1/market-calendar/${c}`, () => toss.fetchTossMarketCalendar(c));
    if (cal) log(Object.keys(cal).length ? 'PASS' : 'FAIL', `장 운영 ${c}`, Object.keys(cal).length ? '응답 있음' : '빈 응답');
  }
  const sectors = await check.step('섹터 목록 /api/v1/sectors', () => toss.fetchTossSectors());
  if (sectors) log(sectors.length > 0 ? 'PASS' : 'FAIL', '섹터 목록', `${sectors.length}개`);
  const info = await check.step('종목 정보(삼성전자·AAPL — 공개 정보)', () => toss.fetchTossStockInfo(['005930', 'AAPL']));
  if (info) log(info.length === 2 ? 'PASS' : 'WARN', '종목 정보', `${info.length}/2건`);
});
