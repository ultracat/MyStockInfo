import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { SecureStorageStatus } from '../../types';
import { errorText, type Notify } from './notify';
import Hint from '../../components/Hint';

// Google Sheets 연동 — 사용자가 자기 Google Cloud 프로젝트에서 만든 OAuth 클라이언트(Client ID/Secret)를 먼저 넣고
// (백엔드 google/clientCredentials.ts, 2026-11-16부터 — 개발자 클라이언트를 빌드에 넣지 않는다), 그다음 계정을
// 연결한다(보유종목/매매내역/배당금 화면은 연결된 상태를 전제로 내보내기/가져오기 버튼만 낸다). connectGoogle()은 시스템
// 브라우저에서 로그인 플로우를 시작만 시키고 즉시 응답하므로, 완료 여부는
// 재귀 setTimeout으로 status를 폴링해 확인한다.
export function GoogleSheetsCard({ secureStorage, notify }: { secureStorage: SecureStorageStatus | null; notify: Notify }) {
  const [googleStatus, setGoogleStatus] = useState<Awaited<ReturnType<typeof api.getGoogleStatus>> | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const [clientNote, setClientNote] = useState<{ kind: 'good' | 'error'; text: string } | null>(null);
  const blocked = secureStorage?.available === false;
  const blockedTitle = blocked ? (secureStorage?.message ?? undefined) : undefined;

  async function refreshGoogleStatus() {
    const s = await api.getGoogleStatus();
    setGoogleStatus(s);
    return s;
  }

  useEffect(() => {
    refreshGoogleStatus().catch((e) => notify.fail(errorText(e)));
    // 처음 열 때 한 번.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSaveClient() {
    setClientNote(null);
    try {
      const r = await api.saveGoogleClient(clientId.trim(), clientSecret.trim());
      setClientId('');
      setClientSecret('');
      setEditing(false);
      await refreshGoogleStatus();
      setClientNote({
        kind: 'good',
        text: r.disconnected
          ? '클라이언트를 바꿔서 기존 Google 연결을 끊었습니다. 아래에서 다시 연결해 주세요.'
          : '저장했습니다. 이제 아래에서 Google 계정을 연결하세요.',
      });
    } catch (e) {
      setClientNote({ kind: 'error', text: errorText(e) });
    }
  }

  async function onDeleteClient() {
    setClientNote(null);
    try {
      await api.deleteGoogleClient();
      await refreshGoogleStatus();
      setClientNote({ kind: 'good', text: 'OAuth 클라이언트를 지우고 Google 연결도 끊었습니다.' });
    } catch (e) {
      setClientNote({ kind: 'error', text: errorText(e) });
    }
  }

  async function onConnect() {
    notify.clear();
    try {
      await api.connectGoogle();
    } catch (e) {
      notify.fail(errorText(e));
      return;
    }
    setConnecting(true);
    const poll = async () => {
      const s = await refreshGoogleStatus();
      if (s.connectStatus === 'waiting') {
        setTimeout(() => void poll(), 1500);
        return;
      }
      setConnecting(false);
      if (s.connectStatus === 'connected') notify.ok('Google 계정이 연결되었습니다.');
      else if (s.connectStatus === 'error' && s.connectError) notify.fail(s.connectError);
    };
    setTimeout(() => void poll(), 1500);
  }

  async function onDisconnect() {
    notify.clear();
    try {
      await api.disconnectGoogle();
      await refreshGoogleStatus();
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Google Sheets 연동</h3>
      <Hint>
        Google 계정을 연결하면 Drive 루트에 "MyStock" 스프레드시트를 만들고(이미 있으면 그대로
        사용) Holdings/Trades/Dividends 세 탭에 보유종목/매매내역/배당금을 내보내거나
        가져올 수 있습니다 — 각 화면(보유 종목/매매내역/배당 기록)의 "Google Sheets" 버튼으로
        실행합니다.
      </Hint>

      <Hint>
        연결하려면 먼저 <strong>본인 Google Cloud 프로젝트에서 만든 OAuth 클라이언트</strong>(애플리케이션 유형 "데스크톱 앱")의
        Client ID와 Client Secret을 넣어야 합니다. 만드는 순서는 사용자 매뉴얼의 부록 "Google API 키(OAuth 클라이언트) 설정하기"에 있습니다.
        값은 OS 키체인으로 암호화해 이 PC에만 저장하며, Secret은 다시 보여 주지 않습니다.
      </Hint>

      {googleStatus && (!googleStatus.hasClientCredentials || editing) ? (
        <div>
          <div className="form-row">
            <label>Client ID</label>
            <input
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789012-xxxx.apps.googleusercontent.com"
            />
          </div>
          <div className="form-row">
            <label>Client Secret</label>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-…"
            />
          </div>
          <button className="primary" onClick={onSaveClient} disabled={!clientId.trim() || !clientSecret.trim() || blocked} title={blockedTitle}>
            클라이언트 저장
          </button>{' '}
          {editing && (
            <button className="ghost" onClick={() => setEditing(false)}>
              취소
            </button>
          )}
        </div>
      ) : (
        googleStatus?.hasClientCredentials && (
          <p style={{ fontSize: 13 }}>
            OAuth 클라이언트: <code>{googleStatus.clientId}</code>{' '}
            <button className="ghost" onClick={() => setEditing(true)}>
              바꾸기
            </button>{' '}
            <button className="ghost" onClick={onDeleteClient}>
              지우기
            </button>
          </p>
        )
      )}
      {clientNote && (
        <p className={clientNote.kind === 'good' ? 'text-good' : 'text-critical'} style={{ fontSize: 13 }}>
          {clientNote.text}
        </p>
      )}

      {googleStatus?.hasClientCredentials &&
        !editing &&
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
            <button className="ghost" onClick={onDisconnect}>
              연결 해제
            </button>
          </div>
        ) : (
          <div>
            <button className="primary" onClick={onConnect} disabled={connecting || blocked} title={blockedTitle}>
              {connecting ? '브라우저에서 로그인을 완료해주세요...' : 'Google 계정 연결'}
            </button>
            {!connecting && googleStatus.connectStatus === 'error' && googleStatus.connectError && (
              <p className="text-critical" style={{ fontSize: 13 }}>
                {googleStatus.connectError}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
