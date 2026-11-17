import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useResumeRefresh } from '../pageActivity';
import type { BrokerId, CredentialFieldSpec, CredentialStatus, SecureStorageStatus } from '../types';
import { AccountLabelsCard } from './settings/AccountLabelsCard';
import { AlertsCard } from './settings/AlertsCard';
import { ApiKeyCard } from './settings/ApiKeyCard';
import { BackupCard } from './settings/BackupCard';
import { BrokerStatusCard } from './settings/BrokerStatusCard';
import { EximbankKeyCard } from './settings/EximbankKeyCard';
import { FxRateCard } from './settings/FxRateCard';
import { GoogleSheetsCard } from './settings/GoogleSheetsCard';
import { errorText, type Notify } from './settings/notify';
import { useSettingsAccounts } from './settings/useSettingsAccounts';

// 설정 화면 — 카드마다 파일 하나(pages/settings/, 2026-11-17 분할). 여기는 카드들이 함께 쓰는 것만 둔다:
// 맨 위 공용 안내(notify), 증권사 키 상태(연동 상태·API 키 카드), 암호화 가능 여부(키 저장 카드들이 버튼을 막는 데 씀),
// 계좌 목록(useSettingsAccounts — 연동 상태의 NH 계좌 표시와 계좌 별칭 카드가 같이 씀).
export default function Settings() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notify: Notify = useMemo(
    () => ({
      clear: () => {
        setError(null);
        setMessage(null);
      },
      ok: (text) => {
        setError(null);
        setMessage(text);
      },
      fail: (text) => {
        setMessage(null);
        setError(text);
      },
    }),
    []
  );

  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [secureStorage, setSecureStorage] = useState<SecureStorageStatus | null>(null);
  const [fieldSpecs, setFieldSpecs] = useState<Record<BrokerId, CredentialFieldSpec[]> | null>(null);
  const [credentialInfo, setCredentialInfo] = useState<Partial<Record<BrokerId, Record<string, string>>>>({});
  const accounts = useSettingsAccounts();
  const { refreshAccounts } = accounts;

  async function refreshCredentials() {
    const [s, specs, info, secure] = await Promise.all([
      api.getCredentialStatus(),
      api.getCredentialFields(),
      api.getCredentialInfo(),
      api.getSecureStorageStatus(),
    ]);
    setStatus(s);
    setFieldSpecs(specs);
    setCredentialInfo(info);
    setSecureStorage(secure);
  }

  useEffect(() => {
    refreshCredentials().catch((e) => notify.fail(errorText(e)));
    refreshAccounts().catch((e) => notify.fail(errorText(e)));
    // 처음 열 때 한 번만 — 이후 갱신은 저장 핸들러와 useResumeRefresh가 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 다른 화면에서 CSV를 가져오는 등 데이터가 바뀌었으면 다시 볼 때 계좌 목록을 다시 모은다(pageActivity.tsx).
  // 시간만 지난 경우엔 안 한다 — 입력 중이던 별칭 칸을 덮어쓰지 않게.
  useResumeRefresh(() => refreshAccounts().catch(() => {}), Number.POSITIVE_INFINITY);

  // 키를 저장·해제하면 연동 상태와 API 계좌 목록(NH의 실전·모의투자 계좌 등)을 다시 받는다.
  async function afterCredentialChange() {
    await refreshCredentials();
    void refreshAccounts().catch(() => {});
  }

  async function onClearCredential(b: BrokerId) {
    await api.clearCredential(b);
    await afterCredentialChange();
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

      <BrokerStatusCard
        status={status}
        fieldSpecs={fieldSpecs}
        credentialInfo={credentialInfo}
        apiAccounts={accounts.apiAccounts}
        onClear={(b) => void onClearCredential(b)}
      />
      <ApiKeyCard fieldSpecs={fieldSpecs} secureStorage={secureStorage} notify={notify} onSaved={afterCredentialChange} />
      <EximbankKeyCard secureStorage={secureStorage} />
      <FxRateCard notify={notify} />
      <AlertsCard />
      <GoogleSheetsCard secureStorage={secureStorage} notify={notify} />
      <AccountLabelsCard accounts={accounts} notify={notify} />
      <BackupCard notify={notify} />
    </div>
  );
}
