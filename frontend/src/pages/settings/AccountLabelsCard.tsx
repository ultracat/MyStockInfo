import { useState } from 'react';
import { api } from '../../api';
import { accountLabelKey, TAX_TYPE_LABELS, TAX_TYPE_OPTIONS } from '../../accountLabels';
import { BROKER_LABELS, CSV_ONLY_BROKER_IDS } from '../../brokers';
import type { AccountTaxType, BrokerId } from '../../types';
import { errorText, type Notify } from './notify';
import type { SettingsAccounts } from './useSettingsAccounts';

/** accountId가 사람이 읽는 계좌번호가 아니라서(토스 Open API의 accountSeq — "1"
 *  같은 값) 표시용 계좌번호를 직접 입력받는 브로커. */
const ACCOUNT_NUMBER_EDITABLE_BROKERS: BrokerId[] = ['toss'];

/** "계좌 별칭 · 세금 유형" 카드 — 목록·초안은 useSettingsAccounts(Settings.tsx가 만들어 넘김). */
export function AccountLabelsCard({ accounts, notify }: { accounts: SettingsAccounts; notify: Notify }) {
  const { knownAccounts, labelDrafts, setLabelDrafts, numberDrafts, setNumberDrafts, setTaxTypes, loading, refreshAccounts, taxTypeFor, isPaperAccount } =
    accounts;
  const [newAccountBroker, setNewAccountBroker] = useState<BrokerId>(CSV_ONLY_BROKER_IDS[0]);
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');

  async function onChangeTaxType(b: BrokerId, accountId: string, next: AccountTaxType) {
    notify.clear();
    try {
      if (next === 'GENERAL') await api.deleteAccountTaxType(b, accountId);
      else await api.upsertAccountTaxType(b, accountId, next);
      setTaxTypes(await api.listAccountTaxTypes());
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  async function onSaveLabel(b: BrokerId, accountId: string) {
    const key = accountLabelKey(b, accountId);
    const label = (labelDrafts[key] ?? '').trim();
    const accountNumber = (numberDrafts[key] ?? '').trim();
    if (!label && !accountNumber) {
      notify.fail(ACCOUNT_NUMBER_EDITABLE_BROKERS.includes(b) ? '별칭 또는 표시 계좌번호를 입력해주세요.' : '별칭을 입력해주세요.');
      return;
    }
    notify.clear();
    try {
      await api.upsertAccountLabel(b, accountId, { label, accountNumber });
      notify.ok('저장되었습니다.');
      await refreshAccounts();
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  async function onDeleteLabel(b: BrokerId, accountId: string) {
    notify.clear();
    try {
      await api.deleteAccountLabel(b, accountId);
      await refreshAccounts();
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  async function onAddAccount(e: React.FormEvent) {
    e.preventDefault();
    notify.clear();
    if (!newAccountId.trim() || !newAccountLabel.trim()) {
      notify.fail('계좌번호와 별칭을 입력해주세요.');
      return;
    }
    try {
      await api.upsertAccountLabel(newAccountBroker, newAccountId.trim(), { label: newAccountLabel.trim() });
      setNewAccountId('');
      setNewAccountLabel('');
      notify.ok('계좌가 등록되었습니다.');
      await refreshAccounts();
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>계좌 별칭 · 세금 유형</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        CSV 전용 브로커(KB증권/삼성증권/미래에셋증권)는 한 증권사 안에 계좌가 여러 개일 수 있습니다
        (예: 종합위탁계좌, 연금저축, IRP). 여기서 계좌번호에 별칭을 붙이면 보유종목/매매내역/배당금
        화면에서 계좌를 구분해 보여줍니다. <strong>세금 유형</strong>에 ISA/연금저축/IRP를
        지정하면(토스/KIS 계좌 포함) 실현손익 화면의 양도소득세 계산에서 그 계좌의 매도
        내역이 빠지고 별도로 분리해 보여줍니다 — 이 계좌들은 일반 해외주식 양도소득세
        (22%)와 완전히 다른 과세 체계가 적용되기 때문입니다. 토스증권은 Open API가 실제
        계좌번호 대신 내부 ID(예: 1)만 알려주므로, 계좌번호 칸에 실제 계좌번호를 입력하고
        저장하면 모든 화면에서 그 번호로 보여줍니다.
      </p>
      {loading ? (
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
                    <td>
                      {ACCOUNT_NUMBER_EDITABLE_BROKERS.includes(a.broker) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <input
                            type="text"
                            value={numberDrafts[key] ?? ''}
                            placeholder="예: 123-45-678901"
                            onChange={(e) => setNumberDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>내부 ID: {a.accountId}</span>
                        </div>
                      ) : (
                        <>
                          {a.accountId}
                          {isPaperAccount(a.broker, a.accountId) && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> (모의투자)</span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        value={labelDrafts[key] ?? ''}
                        placeholder="예: 종합위탁계좌"
                        onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    </td>
                    <td>
                      {isPaperAccount(a.broker, a.accountId) ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>해당 없음</span>
                      ) : (
                        <select
                          value={taxTypeFor(a.broker, a.accountId)}
                          onChange={(e) => void onChangeTaxType(a.broker, a.accountId, e.target.value as AccountTaxType)}
                        >
                          {TAX_TYPE_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {TAX_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      )}
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
          <input type="text" value={newAccountId} placeholder="예: 123-45-678901" onChange={(e) => setNewAccountId(e.target.value)} />
        </div>
        <div className="form-row">
          <label>별칭</label>
          <input type="text" value={newAccountLabel} placeholder="예: 종합위탁계좌" onChange={(e) => setNewAccountLabel(e.target.value)} />
        </div>
        <button type="submit" className="primary">
          등록
        </button>
      </form>
    </div>
  );
}
