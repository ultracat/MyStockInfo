/* eslint-disable */
// KB증권 Open API 실서버 점검 — `npm run check:kb` (2026-11-17 추가)
//
// 설정에 저장한 KB 키로 **조회 TR만**(보유 SSQM2952·거래내역 SWQA2301·종목명 SIQM4900) 불러, 응답 모양과 앱의 해석이 맞는지 본다.
// 계좌번호·금액·종목은 출력하지 않는다(건수·필드 이름만). 토큰은 앱과 같은 kb-token.json을 재사용한다.
// KB 공개 명세에서 계좌 TR이 빠져(2026-09-14) **실제 응답이 유일한 현재 근거**다 — `-- --record`로 kb-live.json에 모양을 남긴다.
// ⚠ 연동 계좌가 보유·거래 0건이면(2026-08 실측) 줄 필드는 SKIP — 거래가 생기면 다시 돌린다.
const { runLiveCheck, RECORD } = require('./lib/live-check.cjs');

runLiveCheck(`KB증권 Open API 실서버 점검 (조회 TR만, 개인 데이터 미출력)${RECORD ? ' + 응답 모양 기록' : ''}`, async (ctx) => {
  const { log, check, todayKst, daysAgo } = ctx;
  const kb = ctx.require('brokers/kb/kbClient.js');
  const recorder = ctx.startRecording('kb');

  if (!kb.isKbConfigured()) return log('FAIL', '자격증명', '설정 → API 키 등록에서 KB증권 키를 먼저 저장하세요');
  log('PASS', '자격증명', '저장돼 있음');

  try {
    // 1) 보유(계좌자산평가) — 요약(dataBody)과 종목 줄(Record1)
    const bal = await check.step('보유 SSQM2952', () => kb.kbPost('SSQM2952', { excg_mktpr_ccd: 'A' }));
    if (bal) {
      const body = bal.dataBody || {};
      log(bal.dataBody ? 'PASS' : 'FAIL', '보유 응답 dataBody', bal.dataBody ? '있음' : '없음');
      const rows = body.Record1 || [];
      check.rows('보유 종목 줄(Record1)', rows, ['hld_q', 'byng_amt', 'now_prc', 'byng_avr_prc', 'val_amt', 'val_pl', 'val_yld'], ['is_cd', 'is_nm', 'crncy_cd']);
      if (rows.length) {
        const codes = new Set(rows.map((r) => String(r.is_cd || '').trim().length));
        log('INFO', '종목코드 길이(6=단축, 12=표준)', [...codes].join(', ')); // 2026-08엔 0건이라 확인 못 한 항목
      }
    }
    const portfolio = await check.step('보유 해석(fetchKbPortfolio)', () => kb.fetchKbPortfolio());
    if (portfolio && portfolio.length) {
      const bad = portfolio.filter((p) => !p.symbol || !(p.quantity > 0) || !p.market);
      log(bad.length ? 'WARN' : 'PASS', '보유 해석', `${portfolio.length}건${bad.length ? `, ${bad.length}건 종목코드·수량·시장 이상` : ''}`);
    }

    // 2) 거래내역(계좌원장) — 최근 1년, 매수·매도만. 연속조회 키(nxt_key)가 오는지(명세엔 있는데 앱은 첫 페이지만 받는다).
    const raw = await check.step('거래내역 SWQA2301(최근 1년)', () =>
      kb.kbPost('SWQA2301', { inq_clsf: '0', inq_clsf5: '1', inq_clsf6: '1', strt_dt: daysAgo(365).replace(/-/g, ''), end_dt: todayKst().replace(/-/g, ''), srt_clsf: '2' })
    );
    if (raw) {
      const rows = (raw.dataBody && raw.dataBody.Record1) || [];
      check.rows('거래내역 줄(Record1)', rows, ['q', 'dl_uprc', 'dl_amt'], ['dl_dt', 'dl_sq', 'smry_nm', 'stnd_is_cd', 'crncy_clsf_nm']);
      const next = String((raw.dataBody && raw.dataBody.nxt_key) || '').trim();
      log(next ? 'WARN' : 'PASS', '거래내역 연속조회 키(nxt_key)', next ? '값이 옴 — 다음 페이지가 있다. 앱이 첫 페이지만 받아 빠지는 거래가 있다(연속조회 구현 필요)' : '비어 있음(한 페이지로 끝)');
    }

    // 3) 종목명(투자정보 — 계좌 무관, 공개 종목)
    const name = await check.step('종목명 SIQM4900(삼성전자 — 공개 정보)', () => kb.kbPost('SIQM4900', { stnd_is_cd: '005930' }));
    if (name) log(name.dataBody && name.dataBody.hngl_is_nm ? 'PASS' : 'WARN', '종목명(hngl_is_nm)', name.dataBody && name.dataBody.hngl_is_nm ? '있음' : '없음 — 앱 등록 시 이 TR 권한이 없을 수 있음');
  } finally {
    if (recorder) recorder.save();
  }
});
