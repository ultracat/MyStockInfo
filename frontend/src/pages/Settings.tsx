import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, AccountTaxType, AccountTaxTypeEntry, BrokerId, CredentialFieldSpec, CredentialStatus } from '../types';
import { API_BROKER_IDS, BROKER_LABELS, BROKER_ORDER, CSV_ONLY_BROKER_IDS } from '../brokers';
import { accountLabelKey, TAX_TYPE_LABELS, TAX_TYPE_OPTIONS } from '../accountLabels';
import { downloadBlob } from '../csv';

// 복원 업로드는 zip을 base64로 감싸 보통 JSON body로 보낸다(api.ts의
// restoreBackup 참고) — ArrayBuffer를 base64로 바꿀 때 `String.fromCharCode(...bytes)`를
// 통째로 한 번에 spread하면 파일이 조금만 커져도(수만 바이트) 인자 개수 한도에
// 걸려 "Maximum call stack size exceeded"가 날 수 있어, 32KB씩 나눠 처리한다.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [backingUp, setBackingUp] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  async function onDownloadBackup() {
    setError(null);
    setMessage(null);
    setBackingUp(true);
    try {
      const blob = await api.downloadBackup();
      downloadBlob(`mystock-backup-${new Date().toISOString().slice(0, 10)}.zip`, blob);
      setMessage('백업 파일을 다운로드했습니다.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBackingUp(false);
    }
  }

  function onRestoreFileClick() {
    restoreFileInputRef.current?.click();
  }

  // 파일만 고르고 바로 복원하지 않는다 — onConfirmRestore에서 2단계로 한 번 더
  // 확인을 받는다(이 작업은 현재 저장된 모든 데이터를 덮어쓰는 돌이킬 수 없는
  // 작업이라, 이 앱이 지금까지 써온 "네이티브 confirm 없이 인라인 state로
  // 확인 단계를 두는" 관례를 그대로 따른다 — Dividends.tsx의 인라인 수정
  // 저장/취소와 같은 패턴).
  function onRestoreFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setMessage(null);
    setRestoreFile(file);
  }

  async function onConfirmRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    setError(null);
    setMessage(null);
    try {
      const base64 = arrayBufferToBase64(await restoreFile.arrayBuffer());
      const result = await api.restoreBackup(base64);
      setMessage(
        `복원이 완료되었습니다(${result.restored.length}개 파일). 변경사항을 반영하려면 앱을 재시작해주세요.`
      );
      setRestoreFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  async function refresh() {
    const [s, fx, specs, info] = await Promise.all([
      api.getCredentialStatus(),
      api.getFxRate(),
      api.getCredentialFields(),
      api.getCredentialInfo(),
    ]);
    setStatus(s);
    setFxRate(fx.usdKrwRate ? String(fx.usdKrwRate) : '');
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

  const activeFields = fieldSpecs?.[broker] ?? [];

  // (broker, accountId) → 별칭 + 세금 유형(ISA/연금저축/IRP 등). 관리는 여기서만
  // 하고 Dashboard.tsx/Trades.tsx/Dividends.tsx(별칭)/RealizedGains.tsx(세금
  // 유형)는 표시/계산할 때 읽기만 한다. "알려진 계좌" 목록은 이미 라벨/세금
  // 유형이 붙은 계좌 + holdings-store/trades-store/배당 기록에 실제로 나온
  // accountId(CSV 전용 브로커) + 실시간 계좌 목록(API 브로커, 자격증명이 설정된
  // 경우만) 전부의 합집합이다 — 데이터가 없어도 라벨/세금 유형만 미리 등록해둘
  // 수 있고, 반대로 라벨이 없어도 실제 데이터/계좌가 있으면 목록에 뜬다.
  // **API 브로커(토스/KIS)도 포함한다** — 계좌번호 자체는 이미 읽을 수 있는 값이라
  // 별칭은 잘 안 쓰지만, 세금 유형(ISA 등)은 API 브로커 계좌에도 똑같이 필요하다
  // (실사용자의 한국투자증권 ISA 계좌가 실제 사례 — backend/CLAUDE.md의
  // "계좌별 세금 유형" 절 참고).
  const [knownAccounts, setKnownAccounts] = useState<{ broker: BrokerId; accountId: string }[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [taxTypes, setTaxTypes] = useState<AccountTaxTypeEntry[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [newAccountBroker, setNewAccountBroker] = useState<BrokerId>(CSV_ONLY_BROKER_IDS[0]);
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');

  async function refreshAccounts() {
    setAccountsLoading(true);
    const credStatus = await api.getCredentialStatus().catch(() => ({}) as CredentialStatus);
    const [labels, taxTypeEntries, allDividends, perBroker, perApiBroker] = await Promise.all([
      api.listAccountLabels(),
      api.listAccountTaxTypes(),
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
      Promise.all(
        API_BROKER_IDS.filter((b) => credStatus[b]).map((b) =>
          api
            .listAccounts(b)
            .then((accounts) => ({ broker: b, accountIds: new Set(accounts.map((a) => a.id)) }))
            .catch(() => ({ broker: b, accountIds: new Set<string>() }))
        )
      ),
    ]);

    const known = new Map<string, { broker: BrokerId; accountId: string }>();
    for (const { broker: b, accountIds } of [...perBroker, ...perApiBroker]) {
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
    for (const t of taxTypeEntries) {
      known.set(accountLabelKey(t.broker, t.accountId), { broker: t.broker, accountId: t.accountId });
    }

    const list = Array.from(known.values()).sort(
      (a, b) => BROKER_ORDER.indexOf(a.broker) - BROKER_ORDER.indexOf(b.broker) || a.accountId.localeCompare(b.accountId)
    );
    setKnownAccounts(list);
    setTaxTypes(taxTypeEntries);

    const drafts: Record<string, string> = {};
    for (const a of list) {
      const key = accountLabelKey(a.broker, a.accountId);
      drafts[key] = labels.find((l) => l.broker === a.broker && l.accountId === a.accountId)?.label ?? '';
    }
    setLabelDrafts(drafts);
    setAccountsLoading(false);
  }

  const taxTypeByAccount = useMemo(() => {
    const m = new Map<string, AccountTaxType>();
    for (const t of taxTypes) m.set(accountLabelKey(t.broker, t.accountId), t.taxType);
    return m;
  }, [taxTypes]);

  function taxTypeFor(b: BrokerId, accountId: string): AccountTaxType {
    return taxTypeByAccount.get(accountLabelKey(b, accountId)) ?? 'GENERAL';
  }

  async function onChangeTaxType(b: BrokerId, accountId: string, next: AccountTaxType) {
    setError(null);
    setMessage(null);
    try {
      if (next === 'GENERAL') {
        await api.deleteAccountTaxType(b, accountId);
      } else {
        await api.upsertAccountTaxType(b, accountId, next);
      }
      setTaxTypes(await api.listAccountTaxTypes());
    } catch (e) {
      setError((e as Error).message);
    }
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

  // Google Sheets 연동 — Client ID/Secret은 앱 빌드에 미리 박혀 있어(백엔드
  // google/clientConfig.ts) 일반 사용자는 입력할 필요도, 알 필요도 없다 — 여기서는
  // 계정 연결/해제만 관리한다(보유종목/매매내역/배당금 화면은 이미 연결된
  // 상태를 전제로 내보내기/가져오기 버튼만 낸다). connectGoogle()은 시스템
  // 브라우저에서 로그인 플로우를 시작만 시키고 즉시 응답하므로, 완료 여부는
  // 재귀 setTimeout으로 status를 폴링해 확인한다.
  const [googleStatus, setGoogleStatus] = useState<Awaited<ReturnType<typeof api.getGoogleStatus>> | null>(null);
  const [googleConnecting, setGoogleConnecting] = useState(false);

  async function refreshGoogleStatus() {
    const s = await api.getGoogleStatus();
    setGoogleStatus(s);
    return s;
  }

  useEffect(() => {
    refreshGoogleStatus().catch((e) => setError((e as Error).message));
  }, []);

  async function onConnectGoogle() {
    setError(null);
    setMessage(null);
    try {
      await api.connectGoogle();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setGoogleConnecting(true);
    const poll = async () => {
      const s = await refreshGoogleStatus();
      if (s.connectStatus === 'waiting') {
        setTimeout(poll, 1500);
        return;
      }
      setGoogleConnecting(false);
      if (s.connectStatus === 'connected') setMessage('Google 계정이 연결되었습니다.');
      else if (s.connectStatus === 'error' && s.connectError) setError(s.connectError);
    };
    setTimeout(poll, 1500);
  }

  async function onDisconnectGoogle() {
    setError(null);
    setMessage(null);
    try {
      await api.disconnectGoogle();
      await refreshGoogleStatus();
    } catch (e) {
      setError((e as Error).message);
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
        <div className="table-scroll">
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
        </div>
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
            "계좌 별칭"에 등록해둔 값과 같으면 자동으로 라벨이 연결됩니다). 저장 후 보유 종목/매매내역
            화면에서 그 계좌를 선택하면 최신 데이터를 자동으로 가져옵니다.
          </p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>USD/KRW 환율</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          해외 종목 비중(%) 계산에 사용됩니다. 기본적으로 토스증권 Open API(GET /api/v1/exchange-rate)에서
          실시간으로 조회하고, 실패하면(가끔씩 일시 오류가 날 수 있음) 한국수출입은행 환율 API로
          자동 대체됩니다. 아래에 값을 입력하면 실시간 조회 대신 이 값을 우선 사용합니다 — 특정
          환율로 고정하고 싶을 때만 입력하고, 평소엔 비워두세요. (한국투자증권 국내주식 잔고는 전부
          원화라 이 설정이 필요 없습니다.)
        </p>
        <div className="form-row">
          <label>1 USD = ? KRW (선택 — 비워두면 실시간 조회)</label>
          <input type="number" min="0" step="0.01" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
        </div>
        <button className="primary" onClick={onSaveFxRate}>
          저장
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Google Sheets 연동</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Google 계정을 연결하면 Drive 루트에 "MyStock" 스프레드시트를 만들고(이미 있으면 그대로
          사용) Holdings/Trades/Dividends 세 탭에 보유종목/매매내역/배당금을 내보내거나
          가져올 수 있습니다 — 각 화면(보유 종목/매매내역/배당 기록)의 "Google Sheets" 버튼으로
          실행합니다.
        </p>

        {googleStatus && !googleStatus.hasClientCredentials && (
          <p className="text-critical" style={{ fontSize: 13 }}>
            지금은 Google Sheets 연동을 사용할 수 없습니다.
          </p>
        )}

        {googleStatus?.hasClientCredentials &&
          (googleStatus.connected ? (
            <div>
              <p className="text-good" style={{ fontSize: 13 }}>
                연결됨{googleStatus.email ? ` — ${googleStatus.email}` : ''}
              </p>
              {googleStatus.spreadsheetUrl && (
                <p style={{ fontSize: 13 }}>
                  <a href={googleStatus.spreadsheetUrl} target="_blank" rel="noreferrer">
                    MyStock 스프레드시트 열기
                  </a>
                </p>
              )}
              <button className="ghost" onClick={onDisconnectGoogle}>
                연결 해제
              </button>
            </div>
          ) : (
            <div>
              <button className="primary" onClick={onConnectGoogle} disabled={googleConnecting}>
                {googleConnecting ? '브라우저에서 로그인을 완료해주세요...' : 'Google 계정 연결'}
              </button>
              {!googleConnecting && googleStatus.connectStatus === 'error' && googleStatus.connectError && (
                <p className="text-critical" style={{ fontSize: 13 }}>
                  {googleStatus.connectError}
                </p>
              )}
            </div>
          ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>계좌 별칭 · 세금 유형</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          CSV 전용 브로커(KB증권/삼성증권/미래에셋증권)는 한 증권사 안에 계좌가 여러 개일 수 있습니다
          (예: 종합위탁계좌, 연금저축, IRP). 여기서 계좌번호에 별칭을 붙이면 보유종목/매매내역/배당금
          화면에서 계좌를 구분해 보여줍니다. <strong>세금 유형</strong>에 ISA/연금저축/IRP를
          지정하면(토스/KIS 계좌 포함) 실현손익 화면의 양도소득세 계산에서 그 계좌의 매도
          내역이 빠지고 별도로 분리해 보여줍니다 — 이 계좌들은 일반 해외주식 양도소득세
          (22%)와 완전히 다른 과세 체계가 적용되기 때문입니다.
        </p>
        {accountsLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        ) : knownAccounts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>아직 등록된 계좌가 없습니다.</p>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>증권사</th>
                <th>계좌번호</th>
                <th>별칭</th>
                <th>세금 유형</th>
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
                      <select
                        value={taxTypeFor(a.broker, a.accountId)}
                        onChange={(e) => onChangeTaxType(a.broker, a.accountId, e.target.value as AccountTaxType)}
                      >
                        {TAX_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {TAX_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
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
          </div>
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

      <div className="card">
        <h3 style={{ marginTop: 0 }}>데이터 백업/복원</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          자격증명, 보유종목/매매내역/배당 기록 등 로컬에 저장된 데이터 전체를 zip
          파일로 내려받거나, 백업 파일로 되돌릴 수 있습니다. 다른 기기로 복원하면
          저장된 API 키는 암호화 방식(OS 키체인) 특성상 다시 입력해야 할 수 있습니다.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="ghost" onClick={onDownloadBackup} disabled={backingUp}>
            {backingUp ? '백업 생성 중...' : '백업 다운로드'}
          </button>
          <button className="ghost" onClick={onRestoreFileClick} disabled={restoring}>
            복원할 백업 파일 선택
          </button>
          <input
            ref={restoreFileInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={onRestoreFileChosen}
          />
        </div>
        {restoreFile && (
          <div style={{ padding: 12, border: '1px solid var(--critical)', borderRadius: 8 }}>
            <p className="text-critical" style={{ marginTop: 0, fontWeight: 600 }}>
              "{restoreFile.name}" 파일로 복원하면 현재 저장된 모든 데이터가 이 백업
              파일 내용으로 완전히 대체됩니다. 계속하려면 아래 버튼을 눌러주세요.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={onConfirmRestore} disabled={restoring}>
                {restoring ? '복원 중...' : '정말 복원하기'}
              </button>
              <button className="ghost" onClick={() => setRestoreFile(null)} disabled={restoring}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
