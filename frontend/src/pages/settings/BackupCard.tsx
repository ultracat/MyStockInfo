import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { downloadBlob } from '../../csv';
import type { RestoreBackupResult } from '../../types';
import { errorText, type Notify } from './notify';
import Hint from '../../components/Hint';
import { localToday } from '../../format';

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

// backend/src/backupCrypto.ts의 MIN_BACKUP_PASSWORD_LENGTH와 맞춘다(서버도 다시 검사).
const MIN_BACKUP_PASSWORD_LENGTH = 8;

function restoreMessage(result: RestoreBackupResult): string {
  const secrets =
    result.secrets === 'restored'
      ? ' API 키와 Google 연결도 복원했습니다.'
      : result.secrets === 'keyring-unavailable'
        ? ' API 키와 Google 연결은 이 PC에 안전하게 저장할 수 없어(키링 없음) 복원하지 않았습니다.'
        : ' 이 백업에는 API 키가 없어 지금 등록된 키를 그대로 두었습니다.';
  const restart = result.restarting ? ' 잠시 후 앱이 다시 시작됩니다.' : ' 변경사항을 반영하려면 앱을 다시 시작해주세요.';
  return `복원이 완료되었습니다(${result.restored.length}개 파일).${secrets}${restart}`;
}

/** "데이터 백업/복원" 카드 — 수동 백업(비밀번호면 키까지 암호화)·파일 복원·자동 로컬 백업 목록과 되돌리기. */
export function BackupCard({ notify }: { notify: Notify }) {
  const [backingUp, setBackingUp] = useState(false);
  // 비워 두면 API 키·Google 연결을 뺀 백업을 만든다(backend/src/backup.ts).
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  // 자동 로컬 백업 목록과 "이 시점으로 되돌리기" 확인 중인 항목.
  const [autoBackups, setAutoBackups] = useState<Awaited<ReturnType<typeof api.listAutoBackups>>>([]);
  const [autoRestoreName, setAutoRestoreName] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  async function loadAutoBackups() {
    setAutoBackups(await api.listAutoBackups().catch(() => []));
  }

  useEffect(() => {
    void loadAutoBackups();
  }, []);

  async function onDownloadBackup() {
    notify.clear();
    if (backupPassword) {
      if (backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
        notify.fail(`백업 비밀번호는 ${MIN_BACKUP_PASSWORD_LENGTH}자 이상이어야 합니다.`);
        return;
      }
      if (backupPassword !== backupPasswordConfirm) {
        notify.fail('백업 비밀번호 확인이 일치하지 않습니다.');
        return;
      }
    }
    setBackingUp(true);
    try {
      const blob = await api.downloadBackup(backupPassword || undefined);
      downloadBlob(`mystock-backup-${localToday()}.zip`, blob);
      notify.ok(
        backupPassword
          ? '백업 파일을 다운로드했습니다. API 키와 Google 연결은 입력한 비밀번호로 암호화해 넣었습니다 — 비밀번호를 잊으면 키는 복원할 수 없습니다.'
          : '백업 파일을 다운로드했습니다. 비밀번호를 정하지 않아 API 키와 Google 연결은 넣지 않았습니다.'
      );
      setBackupPassword('');
      setBackupPasswordConfirm('');
    } catch (e) {
      notify.fail(errorText(e));
    } finally {
      setBackingUp(false);
    }
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
    notify.clear();
    setRestoreFile(file);
    setRestorePassword('');
  }

  async function onConfirmRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    notify.clear();
    try {
      const base64 = arrayBufferToBase64(await restoreFile.arrayBuffer());
      const result = await api.restoreBackup(base64, restorePassword || undefined);
      notify.ok(restoreMessage(result));
      setRestoreFile(null);
      setRestorePassword('');
    } catch (e) {
      notify.fail(errorText(e));
    } finally {
      setRestoring(false);
    }
  }

  async function onCreateAutoBackup() {
    notify.clear();
    try {
      await api.createAutoBackup();
      await loadAutoBackups();
      notify.ok('지금 상태를 자동 백업에 남겼습니다.');
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  async function onConfirmAutoRestore() {
    if (!autoRestoreName) return;
    notify.clear();
    setRestoring(true);
    try {
      const result = await api.restoreAutoBackup(autoRestoreName);
      notify.ok(restoreMessage(result));
      setAutoRestoreName(null);
      await loadAutoBackups();
    } catch (e) {
      notify.fail(errorText(e));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>데이터 백업/복원</h3>
      <Hint>
        보유종목/매매내역/배당 기록 등 로컬에 저장된 데이터를 zip 파일로 내려받거나,
        백업 파일로 되돌릴 수 있습니다. <b>백업 비밀번호</b>를 정하면 API 키와 Google
        연결도 그 비밀번호로 암호화해 넣어서, 다른 PC에서도 비밀번호만 입력하면 그대로
        복원됩니다. 비워 두면 키는 넣지 않습니다. 증권사 접속 토큰은 항상 빼고, 필요할 때
        앱이 다시 받습니다.
      </Hint>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          type="password"
          value={backupPassword}
          placeholder={`백업 비밀번호 (${MIN_BACKUP_PASSWORD_LENGTH}자 이상, 선택)`}
          autoComplete="new-password"
          onChange={(e) => setBackupPassword(e.target.value)}
        />
        {backupPassword && (
          <input
            type="password"
            value={backupPasswordConfirm}
            placeholder="비밀번호 확인"
            autoComplete="new-password"
            onChange={(e) => setBackupPasswordConfirm(e.target.value)}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="ghost" onClick={onDownloadBackup} disabled={backingUp}>
          {backingUp ? '백업 생성 중...' : '백업 다운로드'}
        </button>
        <button className="ghost" onClick={() => restoreFileInputRef.current?.click()} disabled={restoring}>
          복원할 백업 파일 선택
        </button>
        <input ref={restoreFileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={onRestoreFileChosen} />
      </div>
      {restoreFile && (
        <div style={{ padding: 12, border: '1px solid var(--critical)', borderRadius: 8 }}>
          <p className="text-critical" style={{ marginTop: 0, fontWeight: 600 }}>
            "{restoreFile.name}" 파일로 복원하면 현재 저장된 모든 데이터가 이 백업
            파일 내용으로 완전히 대체됩니다. 계속하려면 아래 버튼을 눌러주세요.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            백업할 때 비밀번호를 정했다면 입력해주세요 — API 키와 Google 연결도 함께
            복원됩니다. 비밀번호 없이 만든 백업이면 비워 두세요.
          </p>
          <input
            type="password"
            value={restorePassword}
            placeholder="백업 비밀번호"
            autoComplete="current-password"
            onChange={(e) => setRestorePassword(e.target.value)}
            style={{ marginBottom: 8 }}
          />
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

      <h4 style={{ marginBottom: 4 }}>자동 백업</h4>
      <Hint>
        앱이 하루 한 번, 그리고 복원하기 직전에 이 PC에 데이터를 자동으로 남깁니다(최근 7개). API 키·Google 연결·접속 토큰은
        넣지 않으므로 되돌려도 지금 등록된 키는 그대로입니다. 가져오기를 잘못했을 때 그 전 시점으로 되돌리는 용도입니다.
      </Hint>
      {autoBackups.length === 0 ? (
        <p style={{ fontSize: 13 }}>아직 자동 백업이 없습니다(앱을 켜고 1분쯤 뒤 첫 백업이 생깁니다).</p>
      ) : (
        <table>
          <tbody>
            {autoBackups.map((b) => (
              <tr key={b.name}>
                <td>{new Date(b.createdAt).toLocaleString('ko-KR')}</td>
                <td style={{ color: 'var(--text-muted)' }}>{b.beforeRestore ? '복원 직전' : '하루 한 번'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{Math.max(1, Math.round(b.size / 1024))} KB</td>
                <td>
                  <button className="ghost" onClick={() => setAutoRestoreName(b.name)} disabled={restoring}>
                    이 시점으로 되돌리기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="ghost" onClick={() => void onCreateAutoBackup()} disabled={restoring}>
        지금 자동 백업 남기기
      </button>
      {autoRestoreName && (
        <div style={{ padding: 12, border: '1px solid var(--critical)', borderRadius: 8, marginTop: 8 }}>
          <p className="text-critical" style={{ marginTop: 0, fontWeight: 600 }}>
            {new Date(autoBackups.find((b) => b.name === autoRestoreName)?.createdAt ?? Date.now()).toLocaleString('ko-KR')} 시점으로
            되돌리면 지금 데이터가 그 시점 내용으로 바뀝니다. 지금 상태는 되돌리기 직전에 자동 백업으로 한 벌 남깁니다.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={() => void onConfirmAutoRestore()} disabled={restoring}>
              {restoring ? '되돌리는 중...' : '정말 되돌리기'}
            </button>
            <button className="ghost" onClick={() => setAutoRestoreName(null)} disabled={restoring}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
