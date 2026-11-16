import { API_BROKER_IDS, BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import type { BrokerAccount, BrokerId, CredentialFieldSpec, CredentialStatus } from '../../types';

/** "증권사 연동 상태" 카드 — 어느 증권사에 키가 있는지, 등록한 계좌 정보(비밀 아닌 값), 연결 해제. */
export function BrokerStatusCard({
  status,
  fieldSpecs,
  credentialInfo,
  apiAccounts,
  onClear,
}: {
  status: CredentialStatus | null;
  fieldSpecs: Record<BrokerId, CredentialFieldSpec[]> | null;
  /** KIS의 계좌번호/상품코드, KB의 계좌번호처럼 자격증명 중 비밀이 아닌(secret:false) 값 — appSecret 등은 서버가
   *  애초에 응답에 안 담는다(routes/settings.ts의 credential-info). */
  credentialInfo: Partial<Record<BrokerId, Record<string, string>>>;
  apiAccounts: Partial<Record<BrokerId, BrokerAccount[]>>;
  onClear: (b: BrokerId) => void;
}) {
  return (
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
                    {nonSecretValues ? (
                      (fieldSpecs?.[id] ?? [])
                        .filter((f) => f.kind === 'account' && nonSecretValues[f.key])
                        .map((f) => `${f.label}: ${nonSecretValues[f.key]}`)
                        .join(' · ')
                    ) : id === 'nh' && status?.[id] && (apiAccounts.nh?.length ?? 0) > 0 ? (
                      // NH는 계좌번호를 입력받지 않고 계좌 목록 API로 찾는다 — 찾은 실전·모의투자 계좌를 그대로 보여준다.
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {apiAccounts.nh!.map((a) => (
                          <span key={a.id}>
                            {a.accountNumber ?? a.id} ({a.accountType ?? '일반'})
                          </span>
                        ))}
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    {hasCredentialFields && status?.[id] && (
                      <button className="ghost" onClick={() => onClear(id)}>
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
  );
}
