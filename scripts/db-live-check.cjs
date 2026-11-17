/* eslint-disable */
// DB증권 Open API 실서버 점검 — `npm run check:db` (2026-11-17 추가, ⚠ 실키로 한 번도 돌려 보지 않았다 — 키를 받으면 이것부터)
//
// 설정에 저장한 DB 키로 **조회 TR만** 불러, 명세·코드의 가정이 맞는지 본다. 계좌번호·금액·종목은 출력하지 않는다.
// `-- --record`면 응답 모양(값 없음)을 db-live.json에. ⚠ 토큰 발급은 1분에 1건 — 앱과 같은 db-token.json을 재사용한다.
// 확인할 가정(dbClient.ts·dbDividendSync.ts의 ⚠): 토큰 응답 필드명(access_token/token), 국내 잔고 평균단가(매입금액 ÷ 수량),
// 해외 매매 방향 코드(2 매수·1 매도), 국내 배당 세후(정산금액), 해외 배당 두 줄(입금·세출금) 짝짓기.
const { runLiveCheck, RECORD } = require('./lib/live-check.cjs');

runLiveCheck(`DB증권 Open API 실서버 점검 (조회 TR만, 개인 데이터 미출력)${RECORD ? ' + 응답 모양 기록' : ''}`, async (ctx) => {
  const { log, check, tally, todayKst, daysAgo } = ctx;
  const db = ctx.require('brokers/db/dbClient.js');
  const { dbAdapter } = ctx.require('brokers/db/dbAdapter.js');
  const { classifyDbOverseasDividends } = ctx.require('brokers/db/dbDividendSync.js');
  const recorder = ctx.startRecording('db');
  try {
    if (!db.isDbConfigured()) return log('FAIL', '자격증명', '설정 → API 키 등록에서 DB증권 키를 먼저 저장하세요');
    log('PASS', '자격증명', '저장돼 있음');
    const bal = await check.step('국내 잔고 CSPAQ03420', () => db.fetchDbDomesticBalance({ forceRefresh: true }));
    if (bal) {
      check.fields('잔고 합계(Out)', bal.summary, ['TotBuyAmt', 'TotEvalAmt', 'TotEvalPnlAmt']);
      check.rows('보유 종목(Out1)', bal.items, ['BalQty0', 'PchsAmt', 'NowPrc', 'EvalAmt', 'EvalPnlAmt'], ['IsuNo', 'IsuNm']);
      const avg = bal.items.filter((r) => Number(r.BalQty0) > 0 && Math.abs(Number(r.ExecPrc) - Number(r.PchsAmt) / Number(r.BalQty0)) < 1);
      if (bal.items.length) log(avg.length === bal.items.length ? 'PASS' : 'WARN', '평균단가 = 매입금액 ÷ 수량(ExecPrc와 비교)', `${avg.length}/${bal.items.length}건`);
    }
    const dep = await check.step('국내 예수금 CDPCQ00100', () => db.fetchDbDeposit({ forceRefresh: true }));
    if (dep !== undefined) check.fields('예수금(Out1)', dep, ['DpsBalAmt']);
    const ov = await check.step('해외 잔고 CAZCQ00400', () => db.fetchDbOverseasBalance({ forceRefresh: true }));
    if (ov) {
      log('INFO', '해외 통화', tally(ov.currencies, (c) => c.CrcyCode || '-') || '0건');
      check.rows('해외 보유(Out2)', ov.items, ['AstkExecBaseQty', 'AstkAvrPchsPrc', 'AstkNowPrc', 'AstkBuyAmt', 'AstkEvalAmt'], ['SymCode', 'CrcyCode']);
    }
    const id = await db.getDbAccountId();
    const p = await check.step('어댑터 getPortfolio', () => dbAdapter.getPortfolio(id, { forceRefresh: true }));
    if (p) log('INFO', '보유 구성', tally(p.positions, (x) => `${x.market}/${x.currency}`) || '0건');
    const krTrades = await check.step('국내 매매 CDPCQ04700 QryTp 3(최근 1년)', () => db.fetchDbLedger(daysAgo(365), todayKst(), '3', { forceRefresh: true }));
    if (krTrades) log(krTrades.length ? 'INFO' : 'SKIP', '국내 매매 적요', krTrades.length ? tally(krTrades, (r) => r.SmryNm || '-') : '0건');
    const ovTrades = await check.step('해외 매매 CAZCQ00200(최근 1년)', () => db.fetchDbOverseasTrades(daysAgo(365), todayKst(), { forceRefresh: true }));
    if (ovTrades) log(ovTrades.length ? 'INFO' : 'SKIP', '해외 매매 방향', ovTrades.length ? tally(ovTrades, (r) => `${r.AstkBnsTpCode}/${r.BnsTpNm}`) : '0건');
    const krFlows = await check.step('국내 입출금 CDPCQ04700 QryTp 1(최근 1년)', () => db.fetchDbLedger(daysAgo(365), todayKst(), '1', { forceRefresh: true }));
    if (krFlows) {
      const divs = krFlows.filter((r) => /배당|분배/.test(r.SmryNm || ''));
      const ok = divs.filter((r) => Math.abs(Number(r.AdjstAmt || 0) - (Number(r.MnyDvdAmt || r.TrdAmt || 0) - Number(r.TaxSumAmt || 0))) < 1);
      log(divs.length ? (ok.length === divs.length ? 'PASS' : 'WARN') : 'SKIP', '국내 배당 세후(정산금액 = 배당금 − 세금)', divs.length ? `${ok.length}/${divs.length}건` : '배당 줄 0건');
    }
    const ovFlows = await check.step('해외 입출금 CAZCQ01600(최근 1년)', () => db.fetchDbOverseasLedger(daysAgo(365), todayKst(), { forceRefresh: true }));
    if (ovFlows) {
      log(ovFlows.length ? 'INFO' : 'SKIP', '해외 입출금 적요', ovFlows.length ? tally(ovFlows, (r) => r.SmryNm || '-') : '0건');
      log('INFO', '해외 배당 해석(입금 − 세출금)', `${classifyDbOverseasDividends(ovFlows).length}건`);
    }
  } finally {
    if (recorder) recorder.save();
  }
});
