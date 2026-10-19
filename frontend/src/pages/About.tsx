import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppInfo } from '../types';

export default function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAppInfo()
      .then(setInfo)
      .catch((e) => setError((e as Error).message));
  }, []);

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
