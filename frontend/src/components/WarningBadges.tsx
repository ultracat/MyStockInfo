import type { ActiveWarning } from '../types';

/** 종목명 옆에 붙이는 매수 유의사항 배지(정리매매·투자경고·VI 등). 같은 라벨은 한 번만 보인다. */
export default function WarningBadges({ warnings }: { warnings?: ActiveWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  const labels = [...new Set(warnings.map((w) => w.label))];
  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          className="text-critical"
          title={warnings
            .filter((w) => w.label === label)
            .map((w) => `${label}${w.startDate ? ` ${w.startDate}~${w.endDate ?? ''}` : ''}`)
            .join('\n')}
          style={{ marginLeft: 6, fontSize: 11, border: '1px solid currentColor', borderRadius: 4, padding: '0 4px' }}
        >
          {label}
        </span>
      ))}
    </>
  );
}
