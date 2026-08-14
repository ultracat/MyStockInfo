import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Dividends from './pages/Dividends';
import Trades from './pages/Trades';
import Settings from './pages/Settings';

type Page = 'dashboard' | 'dividends' | 'trades' | 'settings';

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: 'dashboard', label: '보유 종목' },
  { id: 'dividends', label: '배당금' },
  { id: 'trades', label: '매매내역' },
  { id: 'settings', label: '설정' },
];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <h1>MyStock</h1>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="main">
        {page === 'dashboard' && <Dashboard />}
        {page === 'dividends' && <Dividends />}
        {page === 'trades' && <Trades />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
