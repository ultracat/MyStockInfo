import { usePlanner } from '../../usePlanner';
import type { AlertSettings } from '../../types';

const ITEMS: Array<{ key: keyof AlertSettings; label: string; hint: string }> = [
  { key: 'dividendReceived', label: '배당 입금', hint: '배당 동기화로 새 배당 기록이 생기면(최근 7일 지급분). 앱이 켜져 있으면 한국 시간 9~21시에 4시간마다 백그라운드로 동기화합니다.' },
  { key: 'targetPrice', label: '관심종목 목표가', hint: '관심종목 상세에서 정한 목표가 이상·이하가 되면(조건마다 하루 한 번, 5분마다 확인).' },
  { key: 'warnings', label: '보유 종목 매수 유의사항', hint: '보유 종목에 토스증권 매수 유의사항(투자경고 등)이 새로 붙으면(2시간마다 확인, 토스증권 키 필요).' },
];

/**
 * 알림 — OS 알림 센터로 띄운다(백엔드 alerts.ts, Electron 메인 프로세스). 앱이 켜져 있을 때만 동작한다(창을 닫아도 앱이 떠 있으면 동작).
 * 알림 내용(종목·금액)은 이 PC에만 뜨고 외부로 보내지 않는다.
 */
export function AlertsCard() {
  const { planner, update, error } = usePlanner();
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>알림</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        컴퓨터의 알림 센터로 알려 줍니다. 앱이 켜져 있을 때만 동작합니다. 처음엔 운영체제가 MyStock의 알림을 허용할지 물을 수 있습니다.
      </p>
      {error && <p className="text-critical">{error}</p>}
      {planner &&
        ITEMS.map((it) => (
          <label key={it.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={planner.alerts[it.key]}
              onChange={(e) => void update({ alerts: { ...planner.alerts, [it.key]: e.target.checked } }).catch(() => {})}
            />
            <span>
              {it.label}
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{it.hint}</span>
            </span>
          </label>
        ))}
    </div>
  );
}
