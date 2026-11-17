import { useEffect, useMemo, useState } from 'react';
import { BROKER_LABELS } from '../../brokers';
import { findAccountLabel, formatAccountOption } from '../../accountLabels';
import { krw } from '../../format';
import {
  isaStatuses,
  pensionStatus,
  withAccountPlan,
  ISA_OVER_LIMIT_TAX_RATE,
  type TaxAccountRef,
} from '../../calc/taxAccounts';
import type { RealizedSale } from '../../calc/realizedGains';
import type { AccountLabel, BrokerId, DividendRecord, PlannerState, StoredHolding, TaxAccountPlan, TaxLimits } from '../../types';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const pct = (used: number, limit: number) => (limit > 0 ? `${Math.min(999, Math.round((used / limit) * 100))}%` : '-');
const LIMIT_LABELS: Record<keyof TaxLimits, string> = {
  isaGeneral: 'ISA 비과세 한도(일반형)',
  isaSeomin: 'ISA 비과세 한도(서민형)',
  isaAnnualContribution: 'ISA 연간 납입 한도',
  pensionSavings: '연금저축 세액공제 한도(연)',
  pensionTotal: '연금저축 + IRP 세액공제 한도(연)',
};

/**
 * ISA·연금 한도 관리 — 설정에서 세금 유형을 ISA·연금저축·IRP로 정한 계좌만 나온다.
 * ISA는 가입일부터의 매매 손익 + 배당이 비과세 한도에 얼마나 찼는지, 연금저축·IRP는 올해 납입액이 세액공제 한도에 얼마나 찼는지.
 * 납입액·ISA 유형·가입일은 여기서 적는다(증권사 API가 입금 내역을 주지 않는 계좌가 많다). 한도 수치는 세법이 바뀌면 직접 고친다.
 */
export function TaxAccountLimitsCard({
  accounts,
  planner,
  onUpdate,
  sales,
  dividends,
  holdings,
  dividendAccountOf,
  rateFor,
  accountLabels,
  year,
  currentMonth,
}: {
  accounts: TaxAccountRef[];
  planner: PlannerState | null;
  onUpdate: (patch: Partial<PlannerState>) => Promise<unknown>;
  sales: RealizedSale[];
  dividends: DividendRecord[];
  holdings: StoredHolding[];
  dividendAccountOf: (d: DividendRecord) => string | null;
  rateFor: (month: string) => number | null;
  accountLabels: AccountLabel[];
  year: string;
  currentMonth: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (planner) setLimitDraft(Object.fromEntries(Object.entries(planner.taxLimits).map(([k, v]) => [k, String(v)])));
  }, [planner]);

  const plans = useMemo(() => planner?.taxAccounts ?? [], [planner]);
  const isa = useMemo(
    () => (planner ? isaStatuses(accounts, plans, planner.taxLimits, sales, dividends, holdings, dividendAccountOf, rateFor, year, currentMonth) : []),
    [accounts, plans, planner, sales, dividends, holdings, dividendAccountOf, rateFor, year, currentMonth]
  );
  const pension = useMemo(() => (planner ? pensionStatus(accounts, plans, planner.taxLimits, year) : null), [accounts, plans, planner, year]);

  if (!planner || accounts.every((a) => a.taxType === 'GENERAL')) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>ISA·연금 한도</h3>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          설정 → 계좌 별칭 · 세금 유형에서 계좌를 ISA·연금저축·IRP로 정하면 여기서 비과세·세액공제 한도를 관리할 수 있습니다.
        </p>
      </div>
    );
  }

  const label = (broker: string, accountId: string) =>
    `${BROKER_LABELS[broker as BrokerId] ?? broker} · ${formatAccountOption({ id: accountId }, findAccountLabel(accountLabels, broker as BrokerId, accountId))}`;
  const planFor = (broker: string, accountId: string): TaxAccountPlan =>
    plans.find((p) => p.broker === broker && p.accountId === accountId) ?? { broker: broker as BrokerId, accountId, contributions: {} };
  const save = async (next: TaxAccountPlan) => {
    try {
      await onUpdate({ taxAccounts: withAccountPlan(plans, next) });
      setMessage(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const saveContribution = (broker: string, accountId: string, raw: string) => {
    const v = raw.trim() === '' ? 0 : Number(raw.replace(/,/g, ''));
    if (!(Number.isFinite(v) && v >= 0)) return setMessage('납입액은 0 이상의 숫자로 입력하세요.');
    const p = planFor(broker, accountId);
    void save({ ...p, contributions: { ...p.contributions, [year]: Math.round(v) } });
  };
  const saveLimits = async () => {
    const next: Partial<TaxLimits> = {};
    for (const k of Object.keys(LIMIT_LABELS) as Array<keyof TaxLimits>) {
      const v = Number((limitDraft[k] ?? '').replace(/,/g, ''));
      if (!(Number.isFinite(v) && v >= 0)) return setMessage(`${LIMIT_LABELS[k]}을(를) 0 이상의 숫자로 입력하세요.`);
      next[k] = Math.round(v);
    }
    try {
      await onUpdate({ taxLimits: next as TaxLimits });
      setMessage('한도를 저장했습니다.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>ISA·연금 한도</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        <b>ISA</b>는 가입일부터의 매매 손익과 배당을 합친 순이익이 비과세 한도 안이면 세금이 없고, 넘는 몫만 만기·해지 때 {ISA_OVER_LIMIT_TAX_RATE * 100}%
        분리과세됩니다(가입일을 비우면 기록 전체). <b>연금저축·IRP</b>는 올해 납입액에 세액공제를 받습니다(총급여 5,500만원 이하 16.5%, 초과 13.2%).
        납입액은 증권사 API로 알 수 없어 직접 적습니다. 참고용 추정이며 세무 자문이 아닙니다.
      </p>
      {message && <p className="text-critical">{message}</p>}

      {isa.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>ISA 계좌</th>
                <th style={{ textAlign: 'left' }}>유형 · 가입일</th>
                <th>매매 손익</th>
                <th>배당</th>
                <th>순이익 / 한도</th>
                <th>초과분 세금(추정)</th>
                <th>지금 해지하면</th>
                <th>{year}년 납입 / 한도</th>
              </tr>
            </thead>
            <tbody>
              {isa.map((s) => {
                const plan = planFor(s.broker, s.accountId);
                return (
                  <tr key={`${s.broker}:${s.accountId}`}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="upcoming-cell-truncate" title={label(s.broker, s.accountId)}>
                        {label(s.broker, s.accountId)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <select
                        value={s.isaType}
                        onChange={(e) => void save({ ...plan, isaType: e.target.value as 'GENERAL' | 'SEOMIN' })}
                        aria-label={`${label(s.broker, s.accountId)} ISA 유형`}
                      >
                        <option value="GENERAL">일반형</option>
                        <option value="SEOMIN">서민형</option>
                      </select>{' '}
                      <OpenedOnInput
                        value={s.openedOn ?? ''}
                        onSave={(v) => void save({ ...plan, openedOn: v || undefined })}
                        label={`${label(s.broker, s.accountId)} 가입일`}
                      />
                    </td>
                    <td>{won(s.realizedKrw)}</td>
                    <td>{won(s.dividendsKrw)}</td>
                    <td>
                      {won(s.netIncomeKrw)} / {won(s.limitKrw)}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: s.overKrw > 0 ? 700 : undefined }}>
                        {pct(Math.max(0, s.netIncomeKrw), s.limitKrw)}
                        {s.overKrw > 0 ? ' · 한도 초과' : ''}
                      </div>
                    </td>
                    <td>{s.overKrw > 0 ? won(s.estimatedTaxKrw) : '없음'}</td>
                    <td>
                      {s.unrealizedKrw === null ? (
                        '-'
                      ) : (
                        <>
                          {won(s.netIncomeKrw + s.unrealizedKrw)}
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>평가손익 {won(s.unrealizedKrw)} 포함</div>
                        </>
                      )}
                    </td>
                    <td>
                      <ContributionInput value={s.contributionThisYear} onSave={(v) => saveContribution(s.broker, s.accountId, v)} label={`${label(s.broker, s.accountId)} ${year}년 납입액(원)`} />
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        / {won(s.annualContributionLimit)} ({pct(s.contributionThisYear, s.annualContributionLimit)})
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pension && pension.accounts.length > 0 && (
        <>
          <h4>{year}년 연금저축·IRP 세액공제</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>계좌</th>
                  <th style={{ textAlign: 'left' }}>종류</th>
                  <th>{year}년 납입액</th>
                </tr>
              </thead>
              <tbody>
                {pension.accounts.map((a) => (
                  <tr key={`${a.broker}:${a.accountId}`}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="upcoming-cell-truncate" title={label(a.broker, a.accountId)}>
                        {label(a.broker, a.accountId)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }}>{a.taxType === 'IRP' ? 'IRP' : '연금저축'}</td>
                    <td>
                      <ContributionInput value={a.contribution} onSave={(v) => saveContribution(a.broker, a.accountId, v)} label={`${label(a.broker, a.accountId)} ${year}년 납입액(원)`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="summary-row">
            <div className="stat-tile">
              <div className="label">공제 대상 납입액</div>
              <div className="value">
                {won(pension.deductibleKrw)} / {won(planner.taxLimits.pensionTotal)}
              </div>
            </div>
            <div className="stat-tile">
              <div className="label">더 넣을 수 있는 금액</div>
              <div className="value">{won(pension.totalRoom)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>그중 연금저축 {won(pension.savingsRoom)}까지</div>
            </div>
            <div className="stat-tile">
              <div className="label">예상 세액공제</div>
              <div className="value">{won(pension.creditLowIncome)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>총급여 5,500만원 초과면 {won(pension.creditHighIncome)}</div>
            </div>
          </div>
        </>
      )}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>한도 수치 바꾸기</summary>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          기본값은 2025년까지 확정된 수치입니다(ISA 비과세 일반 200만·서민형 400만원, 납입 연 2,000만원, 연금저축 600만·합산 900만원).
          ISA 한도를 올리는 개편(비과세 500만·1,000만원, 납입 4,000만원)이 시행됐다면 여기서 바꾸세요 — 앱은 법 개정 여부를 알 수 없습니다.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {(Object.keys(LIMIT_LABELS) as Array<keyof TaxLimits>).map((k) => (
            <label key={k} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {LIMIT_LABELS[k]}
              <input inputMode="numeric" value={limitDraft[k] ?? ''} onChange={(e) => setLimitDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={() => void saveLimits()}>
          한도 저장
        </button>
      </details>
    </div>
  );
}

/** 납입액 칸 — 입력을 마치면(포커스가 빠지면) 저장한다. */
/** ISA 가입일 — 저장된 값을 따라가는 입력(저장에 실패하거나 다른 곳에서 바뀌면 화면도 그 값으로 돌아간다). */
function OpenedOnInput({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      aria-label={label}
      style={{ width: 140 }}
    />
  );
}

function ContributionInput({ value, onSave, label }: { value: number; onSave: (raw: string) => void; label: string }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  useEffect(() => setDraft(value ? String(value) : ''), [value]);
  return (
    <input
      inputMode="numeric"
      value={draft}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ? String(value) : '') && onSave(draft)}
      style={{ width: 120, textAlign: 'right' }}
      aria-label={label}
    />
  );
}
