import { useState } from 'react';
import Overview from './pages/Overview';
import Dashboard from './pages/Dashboard';
import StockReturns from './pages/StockReturns';
import Dividends from './pages/Dividends';
import Trades from './pages/Trades';
import RealizedGains from './pages/RealizedGains';
import Watchlist from './pages/Watchlist';
import StockLinks from './pages/StockLinks';
import Settings from './pages/Settings';
import About from './pages/About';

type Page =
  | 'overview'
  | 'dashboard'
  | 'stockReturns'
  | 'dividends'
  | 'trades'
  | 'realizedGains'
  | 'watchlist'
  | 'stockLinks'
  | 'settings'
  | 'about';

// 사이드바가 접혔을 때 라벨 대신 보여줄 아이콘 — 외부 아이콘 라이브러리를 새로
// 추가하지 않으려고 최소한의 인라인 SVG로 직접 그린다(Feather 아이콘 스타일).
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PieIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l7.5 4.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function TrendingUpIcon() {
  return (
    <svg {...ICON_PROPS}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </svg>
  );
}

function PercentIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg {...ICON_PROPS}>
      <polygon points="12 2 15 8.5 22 9.5 17 14.5 18.5 21.5 12 18 5.5 21.5 7 14.5 2 9.5 9 8.5 12 2" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="7.5" x2="12" y2="7.51" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg {...ICON_PROPS} width={16} height={16}>
      <polyline points={direction === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}

const NAV_ITEMS: { id: Page; label: string; icon: () => React.ReactElement }[] = [
  { id: 'overview', label: '대시보드', icon: PieIcon },
  { id: 'dashboard', label: '보유 종목', icon: GridIcon },
  { id: 'stockReturns', label: '종목별 수익', icon: TrendingUpIcon },
  { id: 'dividends', label: '배당금', icon: PercentIcon },
  { id: 'trades', label: '매매내역', icon: RepeatIcon },
  { id: 'realizedGains', label: '실현손익', icon: FileTextIcon },
  { id: 'watchlist', label: '관심종목', icon: StarIcon },
  { id: 'stockLinks', label: '종목 링크', icon: LinkIcon },
  { id: 'settings', label: '설정', icon: SlidersIcon },
  { id: 'about', label: '정보', icon: InfoIcon },
];

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-shell">
      <nav className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-header">
          {!collapsed && <h1>MyStock</h1>}
          <button
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
          >
            <ChevronIcon direction={collapsed ? 'right' : 'left'} />
          </button>
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <Icon />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <main className="main">
        {page === 'overview' && <Overview />}
        {page === 'dashboard' && <Dashboard />}
        {page === 'stockReturns' && <StockReturns />}
        {page === 'dividends' && <Dividends />}
        {page === 'trades' && <Trades />}
        {page === 'realizedGains' && <RealizedGains />}
        {page === 'watchlist' && <Watchlist />}
        {page === 'stockLinks' && <StockLinks />}
        {page === 'settings' && <Settings />}
        {page === 'about' && <About />}
      </main>
    </div>
  );
}
