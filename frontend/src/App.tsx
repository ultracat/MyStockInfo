import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, useZoom } from './useZoom';
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

function ZoomInIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/**
 * 배율이 100%가 아닐 때만 뜨는 줌 표시기.
 *
 * 100%일 때 숨기는 것이 핵심이다 — 평소엔 화면을 차지하지 않고, 핀치로 배율이
 * 틀어졌을 때는 "지금 몇 %인지"와 "되돌리는 방법"이 항상 눈에 보인다. 단축키
 * (⌘0)만 두면 그걸 모르는 사람은 틀어진 배율에서 빠져나올 방법이 없다.
 *
 * 줌 배율 밖(.app-shell 직속)에 둔다 — 안에 두면 확대할수록 표시기도 같이
 * 커지고, 스크롤에 따라 화면 밖으로 밀려난다.
 */
function ZoomIndicator({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  if (zoom === 1) return null;

  return (
    <div className="zoom-indicator" role="group" aria-label="화면 배율">
      <button
        className="zoom-indicator-btn"
        onClick={onZoomOut}
        disabled={zoom <= MIN_ZOOM}
        title="축소 (⌘-)"
        aria-label="축소"
      >
        <ZoomOutIcon />
      </button>
      <span className="zoom-indicator-value" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button
        className="zoom-indicator-btn"
        onClick={onZoomIn}
        disabled={zoom >= MAX_ZOOM}
        title="확대 (⌘+)"
        aria-label="확대"
      >
        <ZoomInIcon />
      </button>
      <button className="zoom-indicator-reset" onClick={onReset} title="원래 크기로 (⌘0)">
        100%
      </button>
    </div>
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
  const { zoom, zoomIn, zoomOut, resetZoom } = useZoom();

  // CSS `transform`은 **레이아웃 공간을 차지하지 않는다** — `scale(2)`를 걸어도
  // 부모가 보기엔 여전히 원래 크기라서 스크롤이 생기지 않고, 넘친 부분에 영원히
  // 닿을 수 없다. 그래서 `.zoom-sizer`가 "확대된 크기"를 대신 차지한다.
  //
  // 가로는 CSS calc만으로 되지만(뷰포트 폭에서 바로 나온다) 세로는 안 된다 —
  // 이 앱의 `.main`은 뷰포트 높이에 맞춰진 작업영역이 아니라 **내용만큼 늘어나는
  // 문서**라서, 확대 후 높이를 알려면 지금 내용이 몇 px인지 실제로 재야 한다.
  const mainRef = useRef<HTMLElement | null>(null);
  const [mainHeight, setMainHeight] = useState(0);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // offsetHeight는 `transform`에 영향받지 않는 **레이아웃 높이**라 배율로 나눌
    // 필요가 없다(getBoundingClientRect()는 반대로 배율이 곱해진 값을 준다).
    const measure = () => setMainHeight(el.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  // 페이지를 옮기면 스크롤이 전 페이지의 위치에 남아 있다 — 스크롤 주체가
  // `.main`에서 `.zoom-viewport`로 옮겨갔으므로 여기서 맨 위로 되돌린다.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [page]);

  return (
    <div className="app-shell" style={{ '--z': zoom } as React.CSSProperties}>
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
      {/* 래퍼 3겹: viewport(스크롤) → sizer(확대된 크기를 레이아웃에 알림) →
          main(뷰포트 크기로 배치된 뒤 scale). 상세는 frontend/CLAUDE.md의 "화면 줌" 절. */}
      <div className="zoom-viewport" ref={viewportRef}>
        <div
          className="zoom-sizer"
          style={{ height: mainHeight > 0 ? mainHeight * zoom : undefined }}
        >
          <main className="main" ref={mainRef}>
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
      </div>
      <ZoomIndicator zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
    </div>
  );
}
