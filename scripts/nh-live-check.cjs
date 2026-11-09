/* eslint-disable */
// NH투자증권(나무) Open API 실서버 점검 — `npm run check:nh`
//
// 설정 화면에 저장한 NH 앱키로 **조회 API만** 불러, 응답 모양과 앱의 해석(nhMappers.ts)이 맞는지 확인한다.
// 주문 API는 부르지 않는다. 결과에는 계좌번호·금액·종목을 찍지 않는다(계좌는 "계좌#1(일반)"처럼, 적요 문구만 그대로).
// 거래가 생길 때마다 다시 돌리면 된다 — 0건이면 해당 항목은 SKIP으로 남는다.
//
// - Electron으로 실행해야 한다: 자격증명이 OS 키체인(safeStorage)으로 암호화돼 있어서(앱과 같은 이름으로 연다).
// - 토큰은 앱과 같은 nh-token.json을 쓴다 — 유효한 토큰이 있으면 재사용하고, 없을 때만 새로 받는다
//   (NH는 발급마다 보안 알림을 보낸다). 앱이 켜져 있어도 된다.
// - backend/dist를 쓰므로 `npm run build:backend` 뒤에 돈다(check:nh 스크립트가 같이 한다).
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

app.setName('@mystock/electron'); // electron/src/main.ts와 같은 이름 — 같은 userData·키체인 항목
const DIST = path.join(__dirname, '..', 'backend', 'dist');

const results = [];
const log = (status, name, detail = '') => {
  results.push({ status, name, detail });
  const icon = { PASS: '✔', FAIL: '✖', WARN: '!', SKIP: '-', INFO: 'i' }[status];
  console.log(`${icon} [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : Number(String(v ?? '').replace(/[,\s]/g, '')) || 0);
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const tally = (rows, keyFn) => {
  const m = {};
  for (const r of rows) {
    const k = keyFn(r);
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m)
    .map(([k, n]) => `${k}×${n}`)
    .join(', ');
};

/** 명세 필드가 다 있고 숫자 필드는 숫자인지. 빠진 필드 이름만 돌려준다. */
function missingFields(row, numeric, text = []) {
  const miss = [];
  for (const f of numeric) if (!(f in row) || !(isNum(row[f]) || /^-?[\d,.]+$/.test(String(row[f]).trim()))) miss.push(f);
  for (const f of text) if (!(f in row)) miss.push(f);
  return miss;
}

function checkRows(name, rows, numeric, text) {
  if (rows.length === 0) return log('SKIP', name, '0건 — 거래·보유가 생기면 다시 확인');
  const bad = rows.map((r) => missingFields(r, numeric, text)).filter((m) => m.length > 0);
  if (bad.length) log('FAIL', name, `${rows.length}건 중 ${bad.length}건 필드 이상: ${[...new Set(bad.flat())].join(', ')}`);
  else log('PASS', name, `${rows.length}건, 명세 필드 모두 있음`);
}

/** 합계 대조 — 금액은 찍지 않고 차이 비율만. */
function reconcile(name, total, sum) {
  if (!total && !sum) return log('SKIP', name, '둘 다 0');
  const diff = Math.abs(total - sum) / Math.max(Math.abs(total), 1);
  if (diff <= 0.005) log('PASS', name, `요약 합계와 종목 합이 일치(차이 ${(diff * 100).toFixed(2)}%)`);
  else log('WARN', name, `요약 합계와 종목 합이 ${(diff * 100).toFixed(1)}% 다름 — 필드 뜻을 다시 확인`);
}

async function run() {
  const c = require(path.join(DIST, 'brokers/nh/nhClient.js'));
  const m = require(path.join(DIST, 'brokers/nh/nhMappers.js'));
  const { nhAdapter } = require(path.join(DIST, 'brokers/nh/nhAdapter.js'));
  const { getDataDir } = require(path.join(DIST, 'paths.js'));

  console.log('NH투자증권 Open API 실서버 점검 (조회 API만, 개인 데이터 미출력)\n');

  // 1) 자격증명·토큰
  if (!c.isNhConfigured()) {
    log('FAIL', '자격증명', '설정 → API 키 등록에서 NH투자증권 앱키/앱시크릿을 먼저 저장하세요');
    return;
  }
  log('PASS', '자격증명', '저장돼 있음');
  const tokenFile = path.join(getDataDir(), 'nh-token.json');
  const before = fs.existsSync(tokenFile) ? JSON.parse(fs.readFileSync(tokenFile, 'utf8')) : null;

  // 2) 계좌 목록
  let accounts;
  try {
    accounts = await nhAdapter.listAccounts({ forceRefresh: true, includePaper: true });
  } catch (e) {
    log('FAIL', '계좌 목록 /n2/acctinfo', `${e.message} ${String(e.body || '').slice(0, 200)}`);
    return;
  }
  const after = fs.existsSync(tokenFile) ? JSON.parse(fs.readFileSync(tokenFile, 'utf8')) : null;
  if (!after) log('FAIL', '토큰 저장', 'nh-token.json이 없다');
  else if (before && before.accessToken === after.accessToken) log('PASS', '토큰', '저장된 토큰 재사용(보안 알림 없음)');
  else log('INFO', '토큰', '새로 발급해 저장함 — NH 보안 알림이 한 번 갔을 것');
  if (after) {
    const hours = (after.expiresAt - Date.now()) / 3600_000;
    log(hours > 0 ? 'PASS' : 'FAIL', '토큰 만료', `남은 시간 약 ${hours.toFixed(1)}시간`);
  }
  const live = accounts.filter((a) => !a.paper);
  log(accounts.length ? 'PASS' : 'FAIL', '계좌 목록 /n2/acctinfo', tally(accounts, (a) => a.accountType));
  if (live.length === 0) log('WARN', '실전 계좌', '없음 — 대시보드 합계·배당 동기화 대상이 없다');

  const from = '2000-01-01';
  const to = today();

  for (const [i, acct] of accounts.entries()) {
    const label = `계좌#${i + 1}(${acct.accountType})`;
    const paper = !!acct.paper;
    console.log(`\n── ${label} ${paper ? '— 모의투자 도메인(moapi)' : '— 운영 도메인(api)'}`);
    const routed = await c.isNhPaperAccount(acct.id);
    log(routed === paper ? 'PASS' : 'FAIL', `${label} 도메인 선택`, routed ? 'moapi' : 'api');

    // 3) 국내 잔고
    try {
      const { summary, items } = await c.fetchNhDomesticBalance(acct.id, { forceRefresh: true });
      const miss = missingFields(summary, ['dca', 'tot_byn_amt', 'tot_eal_amt', 'tot_eal_pls']);
      log(miss.length ? 'FAIL' : 'PASS', `${label} 국내 잔고 요약`, miss.length ? `빠진 필드: ${miss.join(', ')}` : '예수금·총매수·총평가·총손익 필드 있음');
      const held = items.filter((r) => num(r.itg_bnc_qty) > 0);
      checkRows(`${label} 국내 보유 종목 필드`, held, ['itg_bnc_qty', 'phs_pr', 'now_pr', 'eal_amt', 'eal_pls_amt', 'pft_rt'], ['iem_cd', 'iem_nm']);
      if (held.length) {
        const pos = held.map(m.mapNhDomesticPosition);
        reconcile(`${label} 국내 평가금액 합`, num(summary.tot_eal_amt), pos.reduce((s, p) => s + p.marketValue, 0));
        reconcile(`${label} 국내 매입금액 합`, num(summary.tot_byn_amt), pos.reduce((s, p) => s + p.purchaseAmount, 0));
        const badSym = pos.filter((p) => !/^[0-9A-Z]{6}$/.test(p.symbol));
        log(badSym.length ? 'WARN' : 'PASS', `${label} 국내 종목코드 형식`, badSym.length ? `${badSym.length}건이 6자리가 아님 — 접두어 처리 확인` : '6자리');
        const rateOk = pos.every((p) => Math.abs(p.profitLossRate) < 50);
        log(rateOk ? 'PASS' : 'WARN', `${label} 수익률 단위`, rateOk ? '퍼센트→소수 변환 정상 범위' : '비율이 비정상적으로 큼 — pft_rt 단위 확인');
      }
    } catch (e) {
      log('FAIL', `${label} 국내 잔고`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }

    // 4) 해외 잔고(미국)
    try {
      const { summary, items } = await c.fetchNhOverseasBalance(acct.id, { forceRefresh: true });
      if (!summary) log('WARN', `${label} 해외 잔고 요약`, '요약 블록 없음 — 달러 예수금을 못 읽음');
      else {
        const miss = missingFields(summary, ['fc_dca', 'fc_eal_amt']);
        log(miss.length ? 'FAIL' : 'PASS', `${label} 해외 잔고 요약`, miss.length ? `빠진 필드: ${miss.join(', ')}` : '외화예수금·외화평가 필드 있음');
      }
      const held = items.filter((r) => num(r.cns_bse_bnc_qty) > 0);
      checkRows(`${label} 해외 보유 종목 필드`, held, ['cns_bse_bnc_qty', 'fc_abk_amt', 'fc_eal_amt', 'fc_eal_pls_amt', 'fc_sec_end_pr', 'eal_pft_rt'], ['iem_cd', 'cur_cd']);
      if (held.length && summary) {
        reconcile(`${label} 해외 평가금액 합`, num(summary.fc_eal_amt), held.map(m.mapNhOverseasPosition).reduce((s, p) => s + p.marketValue, 0));
        const nonUsd = held.filter((r) => String(r.cur_cd || '').trim() && String(r.cur_cd).trim() !== 'USD');
        log(nonUsd.length ? 'WARN' : 'PASS', `${label} 해외 통화`, nonUsd.length ? `USD 아닌 종목 ${nonUsd.length}건이 섞여 옴` : 'USD만');
      }
    } catch (e) {
      log('FAIL', `${label} 해외 잔고`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }

    // 5) 국내 매매 — 적요로 매수/매도를 가르는 가정 확인
    try {
      const rows = await c.fetchNhTotalTransactions(acct.id, from, to, '03', { forceRefresh: true });
      if (!rows.length) log('SKIP', `${label} 국내 매매(종합거래내역)`, '0건');
      else {
        log('INFO', `${label} 국내 매매 적요`, tally(rows, (r) => `${r.sps_cd_krl_anm}/${r.cur_cd || '-'}`));
        checkRows(`${label} 국내 매매 필드`, rows, ['trd_qty', 'trd_uit_pr', 'trd_amt'], ['trd_dt', 'iem_cd', 'sps_cd_krl_anm']);
        const trades = m.mapNhDomesticTrades(rows);
        const unread = rows.filter((r) => num(r.trd_qty) > 0 && r.iem_cd && !m.nhTradeSide(r.sps_cd_krl_anm) && (r.cur_cd || 'KRW') === 'KRW');
        log(
          unread.length ? 'WARN' : 'PASS',
          `${label} 국내 매매 해석`,
          `${trades.length}건을 체결로 읽음` + (unread.length ? ` / 매수·매도를 못 가른 적요: ${tally(unread, (r) => r.sps_cd_krl_anm)}` : '')
        );
        const ids = new Set(trades.map((t) => t.id));
        log(ids.size === trades.length ? 'PASS' : 'FAIL', `${label} 국내 매매 id 중복`, ids.size === trades.length ? '없음' : `${trades.length - ids.size}건 중복`);
      }
    } catch (e) {
      log('FAIL', `${label} 국내 매매`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }

    // 6) 해외 매매
    for (const [kind, side] of [['05', 'BUY'], ['06', 'SELL']]) {
      try {
        const rows = await c.fetchNhOverseasTransactions(acct.id, from, to, kind, { forceRefresh: true });
        const nm = side === 'BUY' ? '매수' : '매도';
        if (!rows.length) {
          log('SKIP', `${label} 해외 ${nm}(일별거래내역)`, '0건');
          continue;
        }
        log('INFO', `${label} 해외 ${nm} 적요·통화`, tally(rows, (r) => `${r.sps_cd_nm}/${r.cur_cd_nm || '-'}`));
        checkRows(`${label} 해외 ${nm} 필드`, rows, ['trd_qty', 'trd_uit_pr', 'fc_trd_amt'], ['trd_dt', 'trd_sno', 'iem_cd']);
        const trades = m.mapNhOverseasTrades(rows, side);
        log(trades.length ? 'PASS' : 'WARN', `${label} 해외 ${nm} 해석`, `${rows.length}건 중 ${trades.length}건을 USD 체결로 읽음`);
      } catch (e) {
        log('FAIL', `${label} 해외 매매(${kind})`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
      }
    }

    if (paper) continue; // 아래는 실전 계좌만 쓰는 기능(배당 동기화·입금 기준 원금·공식 실현손익)

    // 7) 배당 — 적요 판별 + 세후 가정을 권리현황(세전 배정금액)과 대조
    try {
      const rows = await c.fetchNhTotalTransactions(acct.id, from, to, '01', { forceRefresh: true });
      const divLike = rows.filter((r) => /배당|분배/.test(String(r.sps_cd_krl_anm || '')));
      if (!rows.length) log('SKIP', `${label} 국내 입출금(배당 후보)`, '0건');
      else log('INFO', `${label} 국내 입출금 적요`, tally(rows, (r) => `${r.sps_cd_krl_anm}/${r.iem_cd ? '종목' : '-'}`));
      const cands = m.classifyNhDomesticDividends(rows);
      if (divLike.length) log(cands.length === divLike.length ? 'PASS' : 'WARN', `${label} 국내 배당 판별`, `배당·분배 적요 ${divLike.length}건 중 ${cands.length}건을 배당으로 읽음`);
      if (cands.length) {
        const rights = await c.nhPostAll('/krstock/inquiry/v1/rightsHeld', { sta_dt: from.replace(/-/g, ''), act_no: acct.id, rit_tp_cd: '' });
        const held = rights.flatMap((p) => c.rowsOf(p, 'Output_1')).filter((r) => num(r.rit_aloc_amt) > 0);
        let gross = 0;
        let net = 0;
        for (const cand of cands) {
          const r = held.find((h) => m.nhDomesticSymbol(h.iem_cd) === cand.symbol && m.nhYmd(h.aloc_amt_pym_dt) === cand.paidDate);
          if (!r) continue;
          const g = num(r.rit_aloc_amt);
          if (Math.abs(cand.amount + cand.tax - g) <= 1) gross++;
          else if (Math.abs(cand.amount - g) <= 1) net++;
        }
        if (!gross && !net) log('WARN', `${label} 배당 세전/세후`, '권리현황과 짝지은 건이 없어 판단 못 함');
        else if (net > gross) log('FAIL', `${label} 배당 세전/세후`, `거래금액이 권리 배정금액(세전)과 같음(${net}건) — trd_amt가 세전이다, nhMappers.ts에서 세금을 빼야 함`);
        else log('PASS', `${label} 배당 세전/세후`, `거래금액+세금 = 권리 배정금액(${gross}건) — trd_amt 세후 가정이 맞음`);
      }
      const ovRows = await c.fetchNhOverseasTransactions(acct.id, from, to, '01', { forceRefresh: true });
      if (!ovRows.length) log('SKIP', `${label} 해외 입금(배당 후보)`, '0건');
      else {
        log('INFO', `${label} 해외 입금 적요·통화`, tally(ovRows, (r) => `${r.sps_cd_nm}/${r.cur_cd_nm || '-'}`));
        const ovLike = ovRows.filter((r) => /배당|분배/.test(String(r.sps_cd_nm || r.act_trd_tp_nm || '')));
        const ovCands = m.classifyNhOverseasDividends(ovRows);
        if (ovLike.length) log(ovCands.length ? 'PASS' : 'WARN', `${label} 해외 배당 판별`, `배당 적요 ${ovLike.length}건 중 ${ovCands.length}건을 USD 배당으로 읽음`);
      }
    } catch (e) {
      log('FAIL', `${label} 배당 후보`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }

    // 8) 입출금내역(입금 기준 투자원금용)
    try {
      const rows = await c.fetchNhDepositWithdrawals(acct.id, from, to);
      if (!rows.length) log('SKIP', `${label} 입출금내역`, '0건');
      else {
        log('INFO', `${label} 입출금 유형·적요`, tally(rows, (r) => `${r.act_trd_tp_nm}/${r.sps_cd_krl_anm}`));
        checkRows(`${label} 입출금 필드`, rows, ['trd_amt'], ['trd_dt', 'act_trd_tp_nm', 'sps_cd_krl_anm']);
      }
    } catch (e) {
      log('FAIL', `${label} 입출금내역`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }

    // 8-1) 입금 기준 원금(보유 종목 화면 카드) — 화면이 받는 요약을 그대로 만든다
    try {
      const { getNhCashFlows } = require(path.join(DIST, 'brokers/nh/nhCashFlows.js'));
      const flows = await getNhCashFlows({ forceRefresh: true });
      const mine = flows.find((f) => f.accountSeq === acct.id);
      if (!mine) log('FAIL', `${label} 입금 기준 원금 요약`, '이 계좌 요약이 없음');
      else if (!mine.firstDate) log('SKIP', `${label} 입금 기준 원금 요약`, '원금으로 셀 입출금 0건');
      else log('PASS', `${label} 입금 기준 원금 요약`, `연도 ${mine.byYear.length}개, 타사 입고 ${mine.transferIn}건`);
    } catch (e) {
      log('FAIL', `${label} 입금 기준 원금 요약`, e.message);
    }

    // 9) 공식 실현손익
    const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    try {
      const rows = await c.fetchNhDomesticTradingPnl(acct.id, yearAgo, to);
      if (!rows.length) log('SKIP', `${label} 국내 실현손익(tradingPnl, 최근 1년)`, '0건');
      else checkRows(`${label} 국내 실현손익 필드`, rows, ['sll_qty', 'sll_amt', 'pls_amt'], ['iem_cd', 'iem_nm']);
    } catch (e) {
      log('FAIL', `${label} 국내 실현손익`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }
    try {
      const rows = await c.fetchNhOverseasPeriodPnl(acct.id, yearAgo, to);
      if (!rows.length) log('SKIP', `${label} 해외 기간손익(periodPnl, 최근 1년)`, '0건');
      else checkRows(`${label} 해외 기간손익 필드`, rows, ['sll_qty', 'fc_sll_amt', 'fc_rzt_pls'], ['orr_dt']);
    } catch (e) {
      log('FAIL', `${label} 해외 기간손익`, `${e.message} ${String(e.body || '').slice(0, 200)}`);
    }
  }
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (e) {
    log('FAIL', '점검 중단', e && e.message);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n요약: PASS ${count('PASS')} · WARN ${count('WARN')} · FAIL ${count('FAIL')} · SKIP ${count('SKIP')}`);
  if (count('SKIP')) console.log('SKIP은 그 계좌에 해당 자료가 없다는 뜻입니다 — 거래·배당이 생기면 다시 돌려 확인하세요.');
  app.exit(count('FAIL') ? 1 : 0);
});
