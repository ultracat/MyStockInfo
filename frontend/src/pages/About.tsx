import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppInfo } from '../types';

export default function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof api.getUpdateStatus>> | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api
      .getAppInfo()
      .then(setInfo)
      .catch((e) => setError((e as Error).message));
    api
      .getUpdateStatus()
      .then(setUpdate)
      .catch(() => {});
  }, []);

  async function onCheckNow() {
    setChecking(true);
    try {
      setUpdate(await api.getUpdateStatus(true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function onToggleUpdateCheck(enabled: boolean) {
    try {
      setUpdate(await api.setUpdateCheck(enabled));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onOpenLogs() {
    try {
      await api.openLogsFolder();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 className="page-title">정보</h2>
      {error && <p className="text-critical">{error}</p>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{info?.name ?? 'MyStock'}</h3>
        <table>
          <tbody>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>버전</td>
              <td>{info?.version ?? '-'}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>작성자</td>
              <td>{info?.author ?? '-'}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>Electron</td>
              <td>{info?.electronVersion ?? '-'}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>Chromium</td>
              <td>{info?.chromeVersion ?? '-'}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>Node.js</td>
              <td>{info?.nodeVersion ?? '-'}</td>
            </tr>
          </tbody>
        </table>
        {info?.copyright && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 0 }}>{info.copyright}</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>업데이트와 로그</h3>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={update?.enabled ?? true}
            onChange={(e) => void onToggleUpdateCheck(e.target.checked)}
          />
          새 버전이 나오면 알려 주기(GitHub 릴리스를 6시간마다 확인 — GitHub에는 이 PC의 IP만 전달됩니다)
        </label>
        {update?.enabled && (
          <p style={{ fontSize: 13 }}>
            {update.latest === null
              ? '최신 버전을 확인하지 못했습니다(오프라인이거나 잠시 뒤 다시 시도).'
              : update.newer
                ? (
                    <>
                      새 버전 <strong>v{update.latest}</strong>이 나왔습니다 —{' '}
                      <a href={update.url ?? undefined} target="_blank" rel="noreferrer">
                        릴리스 페이지에서 받기
                      </a>
                    </>
                  )
                : `최신 버전을 쓰고 있습니다(v${update.current}).`}{' '}
            <button className="ghost" onClick={() => void onCheckNow()} disabled={checking}>
              {checking ? '확인 중…' : '지금 확인'}
            </button>
          </p>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          문제가 생기면 로그 파일을 확인하거나 문의할 때 첨부해 주세요. 계좌번호·금액·이메일·토큰처럼 보이는 값은 가려서 기록합니다.
        </p>
        <button className="ghost" onClick={() => void onOpenLogs()}>
          로그 폴더 열기
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>오픈소스 패키지</h3>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>패키지</th>
              <th>버전</th>
              <th>라이선스</th>
            </tr>
          </thead>
          <tbody>
            {(info?.packages ?? []).map((p) => (
              <tr key={p.name}>
                <td>
                  {p.homepage ? (
                    <a href={p.homepage} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </td>
                <td>{p.version}</td>
                <td>{p.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
