/* eslint-disable */
// LS증권 Open API 실서버 점검 — `npm run check:ls` (2026-11-17 추가, ⚠ 실키로 한 번도 돌려 보지 않았다 — 키를 받으면 이것부터)
//
// 설정에 저장한 LS 키로 **조회 TR만**(CSPAQ12200·t0424·COSOQ00201·CDPCQ04700) 불러, 명세·코드의 가정이 맞는지 본다.
// 계좌번호·금액·종목은 출력하지 않는다(건수·필드 이름·적요·응답코드만). `-- --record`면 응답 모양(값 없음)을 ls-live.json에.
// 확인할 가정(lsClient.ts·xingFamily.ts의 ⚠): rsp_cd 성공 판정(0으로 시작), C계열 연속조회가 헤더 tr_cont_key인지, 토큰 응답 필드명,
// 거래내역 적요(매수/매도/배당) 문구, 배당 세후 = 정산금액, 해외 줄 종목번호 형식(ISIN?).
const { runLiveCheck, RECORD } = require('./lib/live-check.cjs');

runLiveCheck(`LS증권 Open API 실서버 점검 (조회 TR만, 개인 데이터 미출력)${RECORD ? ' + 응답 모양 기록' : ''}`, async (ctx) => {
  const { log, check, tally, todayKst, daysAgo } = ctx;
  const ls = ctx.require('brokers/ls/lsClient.js');
  const { lsAdapter } = ctx.require('brokers/ls/lsAdapter.js');
  const { classifyLedgerDividends } = ctx.require('brokers/xingFamily.js');
  const recorder = ctx.startRecording('ls');
  try {
    if (!ls.isLsConfigured()) return log('FAIL', '자격증명', '설정 → API 키 등록에서 LS증권 키를 먼저 저장하세요');
    log('PASS', '자격증명', '저장돼 있음');
    const acct = await check.step('계좌 CSPAQ12200(OutBlock1.AcntNo)', () => ls.fetchLsAccount({ forceRefresh: true }));
    if (acct) {
      log(acct.accountNo ? 'PASS' : 'FAIL', '계좌번호 되돌려 받기', acct.accountNo ? `${acct.accountNo.length}자리` : '없음');
      check.fields('예수금 요약(OutBlock2)', acct.summary, ['Dps', 'D2Dps']);
    }
    const bal = await check.step('국내 잔고 t0424', () => ls.fetchLsDomesticBalance({ forceRefresh: true }));
    if (bal) {
      check.fields('잔고 요약(t0424OutBlock)', bal.summary, ['mamt', 'tappamt', 'tdtsunik']);
      check.rows('보유 종목(t0424OutBlock1)', bal.items, ['janqty', 'pamt', 'price', 'mamt', 'appamt', 'dtsunik'], ['expcode', 'hname']);
      if (bal.items.length) check.reconcile('평가금액 합', Number(bal.summary?.tappamt || 0), bal.items.reduce((s, r) => s + Number(String(r.appamt).replace(/,/g, '')), 0));
    }
    const ov = await check.step('해외 잔고 COSOQ00201', () => ls.fetchLsOverseasBalance({ forceRefresh: true }));
    if (ov) {
      log('INFO', '해외 통화', tally(ov.currencies, (c) => c.CrcyCode || '-'));
      check.rows('해외 보유(OutBlock4)', ov.items, ['AstkBalQty', 'FcstckUprc', 'OvrsScrtsCurpri', 'FcurrBuyAmt', 'FcurrEvalAmt'], ['ShtnIsuNo', 'CrcyCode']);
    }
    const p = await check.step('어댑터 getPortfolio', () => lsAdapter.getPortfolio(acct ? acct.accountNo : 'LS', { forceRefresh: true }));
    if (p) log('INFO', '보유 구성', tally(p.positions, (x) => `${x.market}/${x.currency}`) || '0건');
    const trades = await check.step('매매 CDPCQ04700 QryTp 3(최근 1년)', () => ls.fetchLsLedger(daysAgo(365), todayKst(), '3', { forceRefresh: true }));
    if (trades) {
      log(trades.length ? 'INFO' : 'SKIP', '매매 적요', trades.length ? tally(trades, (r) => r.SmryNm || '-') : '0건');
      log('INFO', '종목번호 형식', tally(trades, (r) => (/^KR7/.test(r.IsuNo) ? 'ISIN(KR)' : /^[A-Z]{2}\w{10}$/.test(r.IsuNo) ? 'ISIN(해외)' : /^A\d{6}$/.test(r.IsuNo) ? 'A+6자리' : /^\d{6}$/.test(r.IsuNo) ? '6자리' : '기타')) || '-');
    }
    const flows = await check.step('입출금 CDPCQ04700 QryTp 1(최근 1년)', () => ls.fetchLsLedger(daysAgo(365), todayKst(), '1', { forceRefresh: true }));
    if (flows) {
      log(flows.length ? 'INFO' : 'SKIP', '입출금 적요', flows.length ? tally(flows, (r) => r.SmryNm || '-') : '0건');
      const divs = flows.filter((r) => /배당|분배/.test(r.SmryNm || ''));
      const ok = divs.filter((r) => Math.abs(Number(r.AdjstAmt || 0) - (Number(r.MnyDvdAmt || r.TrdAmt || 0) - Number(r.TaxSumAmt || 0))) < 1);
      log(divs.length ? (ok.length === divs.length ? 'PASS' : 'WARN') : 'SKIP', '배당 세후(정산금액 = 배당금 − 세금)', divs.length ? `${ok.length}/${divs.length}건 맞음` : '배당 줄 0건');
      log('INFO', '배당 해석', `${classifyLedgerDividends(flows).length}건`);
    }
  } finally {
    if (recorder) recorder.save();
  }
});
