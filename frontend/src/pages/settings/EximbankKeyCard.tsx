import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { SecureStorageStatus } from '../../types';

/** "한국수출입은행 환율 인증키" 카드 — 키 값은 받아 오지 않고(서버가 안 줌) 저장 여부만 안다. 결과 문구는 카드 안에
 *  (카드가 아래쪽이라 화면 맨 위 공용 안내는 안 보인다). */
export function EximbankKeyCard({ secureStorage }: { secureStorage: SecureStorageStatus | null }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: 'good' | 'warn' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api
      .getEximbankKeyStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => {});
  }, []);

  async function onSave() {
    setNote(null);
    const key = keyInput.trim();
    if (!key) {
      setNote({ kind: 'error', text: '인증키를 입력해 주세요.' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.saveEximbankKey(key);
      setConfigured(true);
      setKeyInput('');
      setNote(r.warning ? { kind: 'warn', text: r.warning } : { kind: 'good', text: '인증키를 확인하고 저장했습니다.' });
    } catch (e) {
      setNote({ kind: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    setNote(null);
    try {
      await api.deleteEximbankKey();
      setConfigured(false);
      setNote({ kind: 'good', text: '인증키를 지웠습니다.' });
    } catch (e) {
      setNote({ kind: 'error', text: (e as Error).message });
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        한국수출입은행 환율 인증키{' '}
        {configured === false && <span className="text-critical" style={{ fontSize: 13 }}>· 입력 필요</span>}
        {configured && <span className="text-good" style={{ fontSize: 13 }}>· 저장됨</span>}
      </h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        달러 배당금을 <strong>지급한 달의 평균 환율</strong>로 원화 환산하고, 토스증권 환율 조회가 실패했을 때 대신 쓰는 환율은
        한국수출입은행 Open API에서 받습니다. 이 인증키는 <strong>각자 발급</strong>받아 넣어야 합니다(무료, 계좌 권한 없음 — 환율
        조회 전용). 한국수출입은행 홈페이지 → Open API → 인증키 발급에서 받을 수 있고, 자세한 순서는 사용자 매뉴얼의 부록에
        있습니다. 키가 없으면 달러 배당금도 오늘 환율(또는 아래에 입력한 수동 환율)로 환산됩니다.
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        저장할 때 한국수출입은행에 한 번 조회해 키가 맞는지 확인합니다. 키는 OS 키체인으로 암호화해 이 PC에만 저장하며, 저장한
        뒤에는 화면에 다시 보여 주지 않습니다.
      </p>
      <div className="form-row">
        <label>{configured ? '새 인증키로 바꾸기' : '인증키'}</label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={configured ? '저장된 키가 있습니다 — 바꿀 때만 입력' : '발급받은 인증키를 붙여 넣으세요'}
        />
      </div>
      <button
        className="primary"
        onClick={onSave}
        disabled={saving || secureStorage?.available === false}
        title={secureStorage?.available === false ? (secureStorage.message ?? undefined) : undefined}
      >
        {saving ? '확인 중…' : '확인 후 저장'}
      </button>{' '}
      {configured && (
        <button className="ghost" onClick={onDelete}>
          지우기
        </button>
      )}
      {note && (
        <p
          className={note.kind === 'good' ? 'text-good' : note.kind === 'error' ? 'text-critical' : undefined}
          style={{ fontSize: 13, color: note.kind === 'warn' ? 'var(--text-muted)' : undefined }}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
