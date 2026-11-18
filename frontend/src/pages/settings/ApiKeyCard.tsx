import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import type { BrokerId, CredentialFieldSpec, CredentialStatus, SecureStorageStatus } from '../../types';
import { errorText, type Notify } from './notify';
import Hint from '../../components/Hint';

/** "API 키 등록" 카드 — 증권사별 입력칸은 백엔드 credentialFields.ts가 정한다(fieldSpecs). 저장하면 onSaved로 연동 상태와
 *  계좌 목록을 다시 받게 한다. */
export function ApiKeyCard({
  fieldSpecs,
  secureStorage,
  notify,
  onSaved,
  status,
}: {
  fieldSpecs: Record<BrokerId, CredentialFieldSpec[]> | null;
  secureStorage: SecureStorageStatus | null;
  notify: Notify;
  onSaved: () => Promise<void>;
  /** 연결 상태 — 처음 열 때 아직 연결 안 된 증권사를 고르는 데만 쓴다. */
  status?: CredentialStatus | null;
}) {
  const [broker, setBroker] = useState<BrokerId>('toss');
  // 처음엔 아직 연결 안 된 증권사를 고른다 — 늘 토스(이미 연결됨)가 떠 있어 "새 키를 넣으려면 바꿔야" 했다(2026-11-18 UX 점검).
  // 사용자가 한 번 고르면(또는 이미 한 번 정했으면) 건드리지 않는다.
  const pickedRef = useRef(false);
  useEffect(() => {
    if (pickedRef.current || !fieldSpecs || !status) return;
    pickedRef.current = true;
    const first = BROKER_ORDER.find((id) => (fieldSpecs[id]?.length ?? 0) > 0 && !status[id]);
    if (first) setBroker(first);
  }, [fieldSpecs, status]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const activeFields = fieldSpecs?.[broker] ?? [];

  // Reset the form whenever the selected broker changes, since each has a
  // different set of fields.
  useEffect(() => {
    setFieldValues({});
  }, [broker]);

  async function onSaveCredential(e: React.FormEvent) {
    e.preventDefault();
    notify.clear();
    const missing = activeFields.filter((f) => !fieldValues[f.key]?.trim());
    if (missing.length > 0) {
      notify.fail(`다음 항목을 입력해주세요: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    try {
      await api.setCredential(broker, fieldValues);
      setFieldValues({});
      notify.ok('저장되었습니다.');
      await onSaved();
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>API 키 등록</h3>
      {/* 키링 없는 Linux 등에서는 서버가 저장을 거부한다(backend secureStorage.ts) —
          입력부터 하고 나서 실패하지 않게 미리 이유와 해결 방법을 보여준다. */}
      {secureStorage && !secureStorage.available && <p className="notice text-critical">{secureStorage.message}</p>}
      {secureStorage && (secureStorage.insecureBrokers.length > 0 || secureStorage.insecureGoogle) && (
        <p className="notice text-critical">
          다음 연동 정보가 평문이거나 안전하지 않은 방식으로 저장돼 있습니다:{' '}
          {[
            ...secureStorage.insecureBrokers.map((id) => BROKER_LABELS[id]),
            ...(secureStorage.insecureGoogle ? ['Google 계정'] : []),
          ].join(', ')}
          .{' '}
          {secureStorage.available
            ? '다음에 사용할 때 자동으로 암호화됩니다.'
            : '위 "증권사 연동 상태"에서 해제(Google은 연결 해제)한 뒤, 키링을 설정하고 다시 입력해주세요.'}
        </p>
      )}
      <form onSubmit={onSaveCredential}>
        <div className="form-row">
          <label>증권사</label>
          <select
            value={broker}
            onChange={(e) => {
              pickedRef.current = true;
              setBroker(e.target.value as BrokerId);
            }}
          >
            {BROKER_ORDER.filter((id) => (fieldSpecs?.[id]?.length ?? 0) > 0).map((id) => (
              <option key={id} value={id}>
                {BROKER_LABELS[id]}
                {status?.[id] ? ' (연결됨 — 다시 입력하면 바뀜)' : ''}
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
        <button type="submit" className="primary" disabled={secureStorage?.available === false}>
          저장
        </button>
      </form>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
        입력한 키는 OS 키체인 기반 암호화(Electron safeStorage)로 로컬에만 저장되며, 외부로 전송되지
        않습니다.
      </p>
      {broker === 'kis' && (
        <Hint>
          한국투자증권 Open API는 계좌 목록을 조회하는 API가 없어, 계좌번호(8자리)와 상품코드(2자리,
          보통 01)를 직접 입력해야 합니다. 실전투자 계좌만 지원되며 모의투자는 지원하지 않습니다.
        </Hint>
      )}
      {broker === 'nh' && (
        <Hint>
          NH투자증권 나무 Open API(www.nhplug.com)에서 발급받은 앱키/앱시크릿을 입력하세요. 계좌 목록 API가 있어
          계좌번호는 입력하지 않습니다 — 앱키에 연결된 실전 계좌(일반·주문대리인)와 모의투자 계좌가 모두 위 "증권사
          연동 상태"에 보입니다. 모의투자 계좌는 보유 종목·매매내역 화면에서 골라 볼 수 있고, 가상 자산이라 대시보드
          합계·종목별 수익·배당·실현손익과 순자산 기록에는 넣지 않습니다. 접근 토큰을 새로 받을 때마다 NH투자증권이
          보안 알림을 보내므로, 토큰은 24시간 동안 저장해 재사용합니다.
        </Hint>
      )}
      {broker === 'kiwoom' && (
        <Hint>
          키움증권 REST API 포털(openapi.kiwoom.com)에서 발급받은 앱키/시크릿키를 입력하세요. 키움은 앱키가 계좌 하나에
          묶여 있어, 그 계좌를 API로 찾아 보여줍니다(계좌번호 입력 불필요). <strong>포털에 MyStock을 실행하는 PC의 IP를
          등록해야 하고</strong>, IP가 바뀌면 다시 등록해야 조회됩니다. 실전투자 키만 지원합니다(모의투자 키는 미지원).
          ⚠ 이 연동은 아직 실제 키움 계좌로 확인하지 못했습니다 — 값이 키움 앱과 다르면 알려 주세요.
        </Hint>
      )}
      {broker === 'ls' && (
        <Hint>
          LS증권 OPEN API(openapi.ls-sec.co.kr)에서 발급받은 앱키/시크릿키를 입력하세요. 홈페이지에서 xingAPI 사용등록을 먼저 한 뒤
          OPEN API를 신청합니다. LS증권은 앱키가 신청한 계좌 하나에 묶여 있어, 그 계좌를 API로 찾아 보여줍니다(계좌번호 입력 불필요).
          배당은 원화만 자동으로 가져오고, 미국 주식 배당은 직접 입력합니다. ⚠ 이 연동은 아직 실제 LS증권 계좌로 확인하지 못했습니다 —
          값이 LS증권 앱과 다르면 알려 주세요.
        </Hint>
      )}
      {broker === 'db' && (
        <Hint>
          DB증권 Open API(openapi.dbsec.co.kr)에서 발급받은 앱키/시크릿을 입력하세요. DB증권은 계좌마다 앱키를 따로 받고(최대 3계좌), API가
          계좌번호를 알려주지 않아 <strong>그 키를 받은 계좌번호를 직접 적어 주세요</strong>(화면 표시용, DB증권으로 보내지 않음). 앱키는 1년마다
          다시 받아야 합니다. ⚠ 이 연동은 아직 실제 DB증권 계좌로 확인하지 못했습니다 — 값이 DB증권 앱과 다르면 알려 주세요.
        </Hint>
      )}
      {broker === 'kb' && (
        <Hint>
          KB증권 Open API 포털(developer.kbsec.com)에서 발급받은 appKey/appSecret을 입력하세요. KB Open
          API는 앱 등록 시 계좌 하나에 이미 연결되어 있어(계좌 목록 조회 API 자체가 없음) API가 어느
          계좌인지 알려주지 않으므로, 계좌번호는 그 연결된 계좌의 실제 번호를 직접 입력해주세요(위
          "계좌 별칭"에 등록해둔 값과 같으면 자동으로 라벨이 연결됩니다). 저장 후 보유 종목/매매내역
          화면에서 그 계좌를 선택하면 최신 데이터를 자동으로 가져옵니다.
        </Hint>
      )}
    </div>
  );
}
