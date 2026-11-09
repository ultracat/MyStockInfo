/* eslint-disable */
// 실서버 점검 스크립트(scripts/*-live-check.cjs) 공용 — Electron 준비, 결과 기록·요약, 필드·합계 검사.
// 원칙: 계좌번호·금액·종목은 출력하지 않는다(필드 이름·건수·적요 같은 비개인 정보와 비율만).
const path = require('node:path');
const { execSync } = require('node:child_process');

const DIST = path.join(__dirname, '..', '..', 'backend', 'dist');

function createReporter() {
  const results = [];
  const log = (status, name, detail = '') => {
    results.push({ status, name, detail });
    const icon = { PASS: '✔', FAIL: '✖', WARN: '!', SKIP: '-', INFO: 'i' }[status];
    console.log(`${icon} [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = () => {
    console.log(`\n요약: PASS ${count('PASS')} · WARN ${count('WARN')} · FAIL ${count('FAIL')} · SKIP ${count('SKIP')}`);
    if (count('SKIP')) console.log('SKIP은 그 계좌에 해당 자료가 없다는 뜻입니다 — 거래·배당이 생기면 다시 돌려 확인하세요.');
    return count('FAIL') ? 1 : 0;
  };
  return { log, summary, results };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : Number(String(v ?? '').replace(/[,\s]/g, '')) || 0);
const numericLike = (v) => isNum(v) || /^[-+]?[\d,]*\.?\d+$/.test(String(v ?? '').trim());
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 9 * 3600_000 - n * 864e5).toISOString().slice(0, 10);

function tally(rows, keyFn) {
  const m = {};
  for (const r of rows) {
    const k = keyFn(r);
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m).map(([k, n]) => `${k}×${n}`).join(', ') || '-';
}

/** 숫자 필드는 숫자(또는 숫자 문자열), 글자 필드는 키만 있으면 된다. 빠지거나 틀린 필드 이름을 돌려준다. */
function missingFields(row, numeric = [], text = []) {
  const miss = [];
  for (const f of numeric) if (!(f in row) || !numericLike(row[f])) miss.push(f);
  for (const f of text) if (!(f in row)) miss.push(f);
  return miss;
}

function makeChecks(log) {
  return {
    rows(name, rows, numeric, text) {
      if (rows.length === 0) return log('SKIP', name, '0건 — 거래·보유가 생기면 다시 확인');
      const bad = rows.map((r) => missingFields(r, numeric, text)).filter((m) => m.length > 0);
      if (bad.length) log('FAIL', name, `${rows.length}건 중 ${bad.length}건 필드 이상: ${[...new Set(bad.flat())].join(', ')}`);
      else log('PASS', name, `${rows.length}건, 기대 필드 모두 있음`);
    },
    fields(name, obj, numeric, text) {
      if (!obj) return log('FAIL', name, '블록 없음');
      const miss = missingFields(obj, numeric, text);
      log(miss.length ? 'FAIL' : 'PASS', name, miss.length ? `빠지거나 숫자가 아닌 필드: ${miss.join(', ')}` : '기대 필드 모두 있음');
    },
    /** 합계 대조 — 금액은 찍지 않고 차이 비율만. */
    reconcile(name, total, sum, tolerance = 0.005) {
      if (!total && !sum) return log('SKIP', name, '둘 다 0');
      const diff = Math.abs(total - sum) / Math.max(Math.abs(total), 1);
      if (diff <= tolerance) log('PASS', name, `요약 합계와 종목 합 일치(차이 ${(diff * 100).toFixed(2)}%)`);
      else log('WARN', name, `요약 합계와 종목 합이 ${(diff * 100).toFixed(1)}% 다름 — 필드 뜻을 다시 확인`);
    },
    async step(name, fn) {
      try {
        return await fn();
      } catch (e) {
        log('FAIL', name, `${e && e.message}${e && e.body ? ` ${String(e.body).slice(0, 200)}` : ''}`);
        return undefined;
      }
    },
  };
}

/** MyStock 앱(개발 실행 또는 설치본)이 떠 있는지 — 토스처럼 토큰이 하나뿐인 증권사 점검 전에 확인한다. */
function isAppRunning() {
  try {
    const out = execSync('ps -axo pid=,command=', { encoding: 'utf8' });
    return out
      .split('\n')
      .filter((l) => !l.includes('live-check'))
      .some((l) => /electron\S*\s+\.\/src\/index\.cjs|MyStock\.app\/Contents\/MacOS\/MyStock\b/i.test(l));
  } catch {
    return false;
  }
}

/** Electron을 앱과 같은 이름으로 띄워(같은 userData·키체인 항목) `run(ctx)`을 돌리고 요약 뒤 종료한다. */
function runLiveCheck(title, run) {
  const { app } = require('electron');
  app.setName('@mystock/electron'); // electron/src/main.ts와 같은 이름
  const reporter = createReporter();
  app.whenReady().then(async () => {
    console.log(`${title}\n`);
    try {
      await run({ ...reporter, check: makeChecks(reporter.log), DIST, num, tally, todayKst, daysAgo, require: (p) => require(path.join(DIST, p)) });
    } catch (e) {
      reporter.log('FAIL', '점검 중단', e && e.message);
    }
    app.exit(reporter.summary());
  });
}

module.exports = { runLiveCheck, isAppRunning, DIST };
