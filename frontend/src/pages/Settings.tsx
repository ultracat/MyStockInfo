import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, BrokerId, CredentialFieldSpec, CredentialStatus } from '../types';
import { API_BROKER_IDS, BROKER_LABELS, BROKER_ORDER, CSV_ONLY_BROKER_IDS } from '../brokers';
import { accountLabelKey } from '../accountLabels';

export default function Settings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [fieldSpecs, setFieldSpecs] = useState<Record<BrokerId, CredentialFieldSpec[]> | null>(null);
  // KIS의 계좌번호/상품코드, KB의 계좌번호처럼 자격증명 중 비밀이 아닌(secret:
  // false) 입력값 — "증권사 연동 상태" 표에서 "이 브로커에 어느 계좌를 등록해뒀는지"
  // 바로 보여주기 위해 쓴다. appSecret 등 secret:true 필드는 서버가 애초에 응답에
  // 안 담아 보낸다(routes/settings.ts의 credential-info).
  const [credentialInfo, setCredentialInfo] = useState<Partial<Record<BrokerId, Record<string, string>>>>({});
  const [broker, setBroker] = useState<BrokerId>('toss');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fxRate, setFxRate] = useState('');
  const [eximbankKey, setEximbankKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [s, fx, specs, info] = await Promise.all([
      api.getCredentialStatus(),
      api.getFxRate(),
      api.getCredentialFields(),
      api.getCredentialInfo(),
    ]);
    setStatus(s);
    setFxRate(fx.usdKrwRate ? String(fx.usdKrwRate) : '');
    setEximbankKey(fx.eximbankAuthKey ?? '');
    setFieldSpecs(specs);
    setCredentialInfo(info);
  }

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

  // Reset the form whenever the selected broker changes, since each has a
  // different set of fields.
  useEffect(() => {
    setFieldValues({});
  }, [broker]);

  async function onSaveCredential(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const spec = fieldSpecs?.[broker] ?? [];
    const missing = spec.filter((f) => !fieldValues[f.key]?.trim());
    if (missing.length > 0) {
      setError(`다음 항목을 입력해주세요: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }

    try {
      await api.setCredential(broker, fieldValues);
      setFieldValues({});
      setMessage('저장되었습니다.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onClearCredential(b: BrokerId) {
    await api.clearCredential(b);
    await refresh();
  }

  async function onSaveFxRate() {
    setError(null);
    setMessage(null);
    const rate = fxRate ? Number(fxRate) : null;
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
      setError('환율은 양수여야 합니다.');
      return;
    }
    try {
      await api.setFxRate(rate);
      setMessage('환율이 저장되었습니다.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSaveEximbankKey() {
    setError(null);
    setMessage(null);
    try {
      await api.setEximbankKey(eximbankKey.trim() ? eximbankKey.trim() : null);
      setMessage('저장되었습니다.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const activeFields = fieldSpecs?.[broker] ?? [];

  // CSV 전용 브로커의 (broker, accountId) → 별칭. 관리는 여기서만 하고
  // Dashboard.tsx/Trades.tsx/Dividends.tsx는 표시할 때 읽기만 한다. "알려진 계좌"
  // 목록은 이미 라벨이 붙은 계좌 + holdings-store/trades-store/배당 기록에 실제로
  // 나온 accountId 전부의 합집합이다 — 데이터가 없어도 라벨만 미리 등록해둘 수
  // 있고, 반대로 라벨이 없어도 실제 데이터가 있으면 목록에 뜬다.
  const [knownAccounts, setKnownAccounts] = useState<{ broker: BrokerId; accountId: string }[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [newAccountBroker, setNewAccountBroker] = useState<BrokerId>(CSV_ONLY_BROKER_IDS[0]);
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');

  // KB증권 Open API는 appKey/appSecret 자체가 계좌 하나에 이미 묶여 있어(계좌
  // 목록 조회 API가 없음 — backend/CLAUDE.md 참고) 다른 브로커처럼 별도 실시간
  // 화면 경로를 두지 않고, 여기서 "지금 연결된 그 계좌"를 로컬 저장소로 동기화하는
  // 액션만 제공한다 — 어느 계좌인지는 위 "API 키 등록" 폼의 계좌번호 필드에 이미
  // 등록해뒀으므로 여기서 따로 입력받지 않는다. 동기화된 뒤에는 보유종목/매매내역
  // 화면에서 다른 CSV 전용 브로커와 똑같이 보인다.
  const [kbSyncing, setKbSyncing] = useState(false);
  const [kbSyncResult, setKbSyncResult] = useState<string | null>(null);

  async function refreshAccounts() {
    setAccountsLoading(true);
    const [labels, allDividends, perBroker] = await Promise.all([
      api.listAccountLabels(),
      api.listDividends(),
      Promise.all(
        CSV_ONLY_BROKER_IDS.map((b) =>
          Promise.all([api.listHoldingsStore({ broker: b }), api.listTradesStore({ broker: b })]).then(
            ([holdings, trades]) => ({
              broker: b,
              accountIds: new Set([...holdings.map((h) => h.accountId), ...trades.map((t) => t.accountId)]),
            })
          )
        )
      ),
    ]);

    const known = new Map<string, { broker: BrokerId; accountId: string }>();
    for (const { broker: b, accountIds } of perBroker) {
      for (const accountId of accountIds) known.set(accountLabelKey(b, accountId), { broker: b, accountId });
    }
    for (const d of allDividends) {
      if (d.accountId && CSV_ONLY_BROKER_IDS.includes(d.broker)) {
        known.set(accountLabelKey(d.broker, d.accountId), { broker: d.broker, accountId: d.accountId });
      }
    }
    for (const l of labels) {
      known.set(accountLabelKey(l.broker, l.accountId), { broker: l.broker, accountId: l.accountId });
    }

    const list = Array.from(known.values()).sort(
      (a, b) =>
        CSV_ONLY_BROKER_IDS.indexOf(a.broker) - CSV_ONLY_BROKER_IDS.indexOf(b.broker) ||
        a.accountId.localeCompare(b.accountId)
    );
    setKnownAccounts(list);

    const drafts: Record<string, string> = {};
    for (const a of list) {
      const key = accountLabelKey(a.broker, a.accountId);
      drafts[key] = labels.find((l) => l.broker === a.broker && l.accountId === a.accountId)?.label ?? '';
    }
    setLabelDrafts(drafts);
    setAccountsLoading(false);
  }

  useEffect(() => {
    refreshAccounts().catch((e) => setError((e as Error).message));
  }, []);

  async function onSaveLabel(b: BrokerId, accountId: string) {
    const key = accountLabelKey(b, accountId);
    const label = (labelDrafts[key] ?? '').trim();
    if (!label) {
      setError('별칭을 입력해주세요.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await api.upsertAccountLabel(b, accountId, label);
      setMessage('저장되었습니다.');
      await refreshAccounts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeleteLabel(b: BrokerId, accountId: string) {
    setError(null);
    setMessage(null);
    try {
      await api.deleteAccountLabel(b, accountId);
      await refreshAccounts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSyncKbHoldings() {
    setError(null);
    setKbSyncResult(null);
    setKbSyncing(true);
    try {
      const result = await api.syncKbHoldings();
      setKbSyncResult(`${result.accountId} 계좌 — 보유종목 ${result.synced}건 동기화됨`);
      await refreshAccounts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKbSyncing(false);
    }
  }

  async function onSyncKbTrades() {
    setError(null);
    setKbSyncResult(null);
    setKbSyncing(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const result = await api.syncKbTrades(yearStart, today);
      setKbSyncResult(`${result.accountId} 계좌 — 매매내역(올해) ${result.synced}건 동기화됨`);
      await refreshAccounts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKbSyncing(false);
    }
  }

  async function onAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!newAccountId.trim() || !newAccountLabel.trim()) {
      setError('계좌번호와 별칭을 입력해주세요.');
      return;
    }
    try {
      await api.upsertAccountLabel(newAccountBroker, newAccountId.trim(), newAccountLabel.trim());
      setNewAccountId('');
      setNewAccountLabel('');
      setMessage('계좌가 등록되었습니다.');
      await refreshAccounts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 className="page-title">설정</h2>
      {error && (
        <p className="text-critical" style={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </p>
      )}
      {message && <p className="text-good">{message}</p>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>증권사 연동 상태</h3>
        <table>
          <thead>
            <tr>
              <th>증권사</th>
              <th>상태</th>
              <th>계좌 정보</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {BROKER_ORDER.map((id) => {
              const isApiBroker = API_BROKER_IDS.includes(id);
              const hasCredentialFields = (fieldSpecs?.[id]?.length ?? 0) > 0;
              const nonSecretValues = credentialInfo[id];
              return (
                <tr key={id}>
                  <td>{BROKER_LABELS[id]}</td>
                  <td>
                    {!hasCredentialFields ? (
                      'CSV 전용'
                    ) : (
                      <>
                        {status?.[id] ? <span className="text-good">연결됨</span> : '미설정'}
                        {!isApiBroker && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> (CSV 전용 + 동기화 가능)</span>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    {nonSecretValues
                      ? (fieldSpecs?.[id] ?? [])
                          .filter((f) => f.kind === 'account' && nonSecretValues[f.key])
                          .map((f) => `${f.label}: ${nonSecretValues[f.key]}`)
                          .join(' · ')
                      : '-'}
                  </td>
                  <td>
                    {hasCredentialFields && status?.[id] && (
                      <button className="ghost" onClick={() => onClearCredential(id)}>
                        연결 해제
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
          KB증권/삼성증권/미래에셋증권은 API 연동 없이 CSV로 보유종목·매매내역을 직접 관리합니다 — 보유
          종목/매매내역 화면에서 CSV 가져오기를 이용하세요.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>API 키 등록</h3>
        <form onSubmit={onSaveCredential}>
          <div className="form-row">
            <label>증권사</label>
            <select value={broker} onChange={(e) => setBroker(e.target.value as BrokerId)}>
              {BROKER_ORDER.filter((id) => (fieldSpecs?.[id]?.length ?? 0) > 0).map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
          {activeFields.map((f) => (
            <div className="form-row" key={f.key}>
              <label>{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={fieldValues[f.key] ?? ''}
                placeholder={f.placeholder}
                autoComplete="off"
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <button type="submit" className="primary">
            저장
          </button>
        </form>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
          입력한 키는 OS 키체인 기반 암호화(Electron safeStorage)로 로컬에만 저장되며, 외부로 전송되지
          않습니다.
        </p>
        {broker === 'kis' && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            한국투자증권 Open API는 계좌 목록을 조회하는 API가 없어, 계좌번호(8자리)와 상품코드(2자리,
            보통 01)를 직접 입력해야 합니다. 실전투자 계좌만 지원되며 모의투자는 지원하지 않습니다.
          </p>
        )}
        {broker === 'kb' && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            KB증권 Open API 포털(developer.kbsec.com)에서 발급받은 appKey/appSecret을 입력하세요. KB Open
            API는 앱 등록 시 계좌 하나에 이미 연결되어 있어(계좌 목록 조회 API 자체가 없음) API가 어느
            계좌인지 알려주지 않으므로, 계좌번호는 그 연결된 계좌의 실제 번호를 직접 입력해주세요(위
            "계좌 별칭"에 등록해둔 값과 같으면 자동으로 라벨이 연결됩니다). 다른 증권사처럼 실시간 화면을
            별도로 제공하지 않고, 아래 "KB증권 실시간 동기화"에서 그 계좌의 데이터를 로컬 저장소로
            가져옵니다.
          </p>
        )}
      </div>

      {status?.kb && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>KB증권 실시간 동기화</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            위 "API 키 등록"에 입력해둔 계좌번호로 보유종목/매매내역(올해)을 가져와 로컬 저장소에 채워
            넣습니다. 동기화 후에는 보유종목/매매내역 화면에서 다른 CSV 전용 계좌와 똑같이 보입니다.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={onSyncKbHoldings} disabled={kbSyncing}>
              {kbSyncing ? '동기화 중...' : '보유종목 동기화'}
            </button>
            <button className="ghost" onClick={onSyncKbTrades} disabled={kbSyncing}>
              {kbSyncing ? '동기화 중...' : '매매내역 동기화 (올해)'}
            </button>
          </div>
          {kbSyncResult && (
            <p className="text-good" style={{ fontSize: 13 }}>
              {kbSyncResult}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>USD/KRW 환율</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          해외 종목 비중(%) 계산에 사용됩니다. 기본적으로 토스증권 Open API(GET /api/v1/exchange-rate)에서
          실시간으로 조회하고, 실패하면(가끔씩 일시 오류가 날 수 있음) 아래 한국수출입은행 환율 API로
          자동 대체됩니다. 그 아래에 값을 입력하면 실시간 조회 대신 이 값을 우선 사용합니다 — 특정
          환율로 고정하고 싶을 때만 입력하고, 평소엔 비워두세요. (한국투자증권 국내주식 잔고는 전부
          원화라 이 설정이 필요 없습니다.)
        </p>
        <div className="form-row">
          <label>한국수출입은행 Open API 인증키 (선택 — 토스 실패 시 대체 조회용)</label>
          <input
            type="text"
            value={eximbankKey}
            onChange={(e) => setEximbankKey(e.target.value)}
            placeholder="한국수출입은행 홈페이지에서 무료로 발급받은 인증키"
          />
        </div>
        <button className="ghost" onClick={onSaveEximbankKey} style={{ marginBottom: 16 }}>
          인증키 저장
        </button>
        <div className="form-row">
          <label>1 USD = ? KRW (선택 — 비워두면 실시간 조회)</label>
          <input type="number" min="0" step="0.01" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
        </div>
        <button className="primary" onClick={onSaveFxRate}>
          저장
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>계좌 별칭</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          CSV 전용 브로커(KB증권/삼성증권/미래에셋증권)는 한 증권사 안에 계좌가 여러 개일 수 있습니다
          (예: 종합위탁계좌, 연금저축, IRP). 여기서 계좌번호에 별칭을 붙이면 보유종목/매매내역/배당금
          화면에서 계좌를 구분해 보여줍니다.
        </p>
        {accountsLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        ) : knownAccounts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>아직 등록된 계좌가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>증권사</th>
                <th>계좌번호</th>
                <th>별칭</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {knownAccounts.map((a) => {
                const key = accountLabelKey(a.broker, a.accountId);
                return (
                  <tr key={key}>
                    <td>{BROKER_LABELS[a.broker]}</td>
                    <td>{a.accountId}</td>
                    <td>
                      <input
                        type="text"
                        value={labelDrafts[key] ?? ''}
                        placeholder="예: 종합위탁계좌"
                        onChange={(e) =>
                          setLabelDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </td>
                    <td>
                      <button className="ghost" onClick={() => onSaveLabel(a.broker, a.accountId)}>
                        저장
                      </button>
                      <button className="ghost" onClick={() => onDeleteLabel(a.broker, a.accountId)}>
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h4>새 계좌 등록</h4>
        <form onSubmit={onAddAccount}>
          <div className="form-row">
            <label>증권사</label>
            <select value={newAccountBroker} onChange={(e) => setNewAccountBroker(e.target.value as BrokerId)}>
              {CSV_ONLY_BROKER_IDS.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>계좌번호</label>
            <input
              type="text"
              value={newAccountId}
              placeholder="예: 123-45-678901"
              onChange={(e) => setNewAccountId(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>별칭</label>
            <input
              type="text"
              value={newAccountLabel}
              placeholder="예: 종합위탁계좌"
              onChange={(e) => setNewAccountLabel(e.target.value)}
            />
          </div>
          <button type="submit" className="primary">
            등록
          </button>
        </form>
      </div>
    </div>
  );
}
