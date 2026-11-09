import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { KisRealizedRow } from '../types';
import { krw } from '../format';
import CollapseToggle from './CollapseToggle';

// 한국투자증권이 직접 계산한 국내 매도 실현손익(기간별매매손익현황 TTTC8715R)과 이 앱의 이동평균 추정치를
// 종목별로 나란히 보여준다. KIS 키가 없으면(409) 카드를 안 그린다. 증권사 값은 수수료·세금을 뺀 손익이고
// 매입원가도 증권사 장부 기준이라, 앱 매매내역이 다 모이지 않았거나 원가 기준이 다르면 차이가 난다.

export interface AppSaleLite {
  date: string;
  accountId: string;
  symbol: string;
  name: string | null;
  quantity: number;
  gainKrw: number;
}

interface Line {
  symbol: string;
  name: string;
  officialQty: number;
  official: number | null;
  appQty: number;
  app: number | null;
}

const signed = (v: number) => `${v >= 0 ? '+' : ''}${krw.format(Math.round(v))}원`;

export default function KisRealizedCompare({
  year,
  kisSales,
  market = 'domestic',
}: {
  year: number;
  kisSales: AppSaleLite[];
  /** domestic = 국내 매도(TTTC8715R), overseas = 미국 매도(TTTS3039R, 원화 기준). */
  market?: 'domestic' | 'overseas';
}) {
  const overseas = market === 'overseas';
  const [rows, setRows] = useState<KisRealizedRow[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const to = `${year}-12-31` < today ? `${year}-12-31` : today;
    api
      .getKisRealized(`${year}-01-01`, to)
      .then((r) => {
        if (cancelled) return;
        if (overseas && r.overseasRows === null) setError('해외 기간손익을 불러오지 못했습니다.');
        setRows(overseas ? (r.overseasRows ?? []) : r.rows);
        setAccountId(r.accountId);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = (e as Error).message;
        if (/API 키가 설정되지/.test(msg)) setHidden(true);
        else setError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [year, overseas]);

  const lines = useMemo<Line[]>(() => {
    if (!rows) return [];
    const map = new Map<string, Line>();
    const get = (symbol: string, name: string) => {
      let l = map.get(symbol);
      if (!l)
        map.set(
          symbol,
          (l = {
            symbol,
            name,
            officialQty: 0,
            official: null,
            appQty: 0,
            app: null,
          }),
        );
      return l;
    };
    for (const r of rows) {
      const l = get(r.symbol, r.name);
      l.officialQty += r.quantity;
      l.official = (l.official ?? 0) + r.realized;
    }
    for (const s of kisSales) {
      if (accountId && s.accountId !== accountId) continue;
      const l = get(s.symbol, s.name ?? s.symbol);
      l.appQty += s.quantity;
      l.app = (l.app ?? 0) + s.gainKrw;
    }
    return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [rows, kisSales, accountId]);

  if (hidden) return null;
  const officialTotal = lines.reduce((s, l) => s + (l.official ?? 0), 0);
  const appTotal = lines.reduce((s, l) => s + (l.app ?? 0), 0);

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0 }}>
          한국투자증권 공식 실현손익과 비교 ({year}년, {overseas ? '해외·원화 환산' : '국내'})
        </h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            증권사 값은 한국투자증권이 계좌 장부로 계산한 매도 손익(수수료·세금 차감)이고, 앱 값은 이 화면이
            매매내역으로 추정한 값입니다(계좌 세금 유형과 무관하게 이 계좌의 매도 전부). 매매내역이 다 모이지 않았거나
            원가 기준이 다르면 차이가 납니다 — 다르면 증권사 값을 기준으로 보세요.
          </p>
          {error ? (
            <p className="text-critical">{error}</p>
          ) : rows === null ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : lines.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{year}년 한국투자증권 계좌의 {overseas ? '해외' : '국내'} 매도 기록이 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>매도 수량(증권사 / 앱)</th>
                    <th>증권사 실현손익</th>
                    <th>앱 추정</th>
                    <th>차이(앱 − 증권사)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.symbol}>
                      <td style={{ textAlign: 'left' }}>
                        <span className="cell-name-truncate">
                          {l.name} <span style={{ color: 'var(--text-muted)' }}>{l.symbol}</span>
                        </span>
                      </td>
                      <td>
                        {krw.format(l.officialQty)} / {krw.format(l.appQty)}
                      </td>
                      <td>{l.official === null ? '-' : signed(l.official)}</td>
                      <td>{l.app === null ? '앱 기록 없음' : signed(l.app)}</td>
                      <td>{l.official === null || l.app === null ? '-' : signed(l.app - l.official)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>합계</td>
                    <td>{signed(officialTotal)}</td>
                    <td>{signed(appTotal)}</td>
                    <td>{signed(appTotal - officialTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
