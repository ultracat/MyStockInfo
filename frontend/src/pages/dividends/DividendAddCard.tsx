import { useEffect, useState } from 'react';
import { api } from '../../api';
import { BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import type { BrokerId, DividendCurrency } from '../../types';

// 토스 종목 기본 정보 API가 symbols 파라미터에 실제로 허용하는 문자 범위
// (backend/src/routes/stockInfo.ts의 TOSS_SYMBOL_PATTERN과 동일 — 백엔드가 이미
// 이 패턴 밖이면 토스를 안 부르고 바로 거부하지만, 한글 IME로 종목명 등을 이
// 칸에 잘못 타이핑하는 동안 자모 하나짜리 중간 상태마다 500ms 디바운스로 왕복
// 요청을 보내는 건 여전히 낭비라 프론트에서도 먼저 걸러 요청 자체를 생략한다).
const SYMBOL_CODE_PATTERN = /^[A-Za-z0-9.,-]+$/;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * "배당 기록 추가" 카드 — 종목코드 입력 후 500ms 디바운스로 종목명 자동조회("직접 입력"으로 바꾸면 덮어쓰지 않음).
 * API 동기화 증권사는 선택지에서 빠지고, 한국투자증권은 달러 배당만(통화 USD 고정). `error`는 화면 첫 로딩 오류도 여기 보여서 위에서 받는다.
 */
export function DividendAddCard({
  syncOwnedBrokers,
  isRowSyncOwned,
  error,
  setError,
  onAdded,
}: {
  syncOwnedBrokers: Set<BrokerId>;
  isRowSyncOwned: (b: BrokerId, currency: string) => boolean;
  error: string | null;
  setError: (e: string | null) => void;
  onAdded: () => Promise<void>;
}) {
  const [broker, setBroker] = useState<BrokerId>('toss');
  const [accountId, setAccountId] = useState('');
  const [currency, setCurrency] = useState<DividendCurrency>('KRW');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [taxInput, setTaxInput] = useState('');

  // 종목명 자동조회 — 백엔드가 심볼별로 로컬 캐시(SQLite, stockNames.sqlite)를
  // 두므로 같은 심볼을 다시 입력해도 매번 토스 API를 부르지 않는다. 사용자가
  // "직접 입력"을 누르면 그 뒤로는 자동조회가 name을 덮어쓰지 않는다.
  const [nameStatus, setNameStatus] = useState<'idle' | 'loading' | 'resolved' | 'error'>('idle');
  const [nameError, setNameError] = useState<string | null>(null);
  const [manualNameEntry, setManualNameEntry] = useState(false);

  // 직접 입력 폼에서 한국투자증권(동기화 중)을 고르면 통화를 달러로 고정한다.
  useEffect(() => {
    if (broker === 'kis' && syncOwnedBrokers.has('kis') && currency !== 'USD') setCurrency('USD');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broker, syncOwnedBrokers]);

  // 직접 입력 폼의 증권사 기본값이 API 동기화 증권사면 직접 입력 가능한 첫 증권사로 옮긴다.
  useEffect(() => {
    if (syncOwnedBrokers.has(broker) && broker !== 'kis') {
      const first = BROKER_ORDER.find((id) => !syncOwnedBrokers.has(id));
      if (first) setBroker(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOwnedBrokers]);

  // 종목코드 입력이 멈추면(500ms 디바운스) 종목명을 자동조회한다. 사용자가
  // "직접 입력"으로 전환했으면(manualNameEntry) 여기서 name을 건드리지 않는다.
  useEffect(() => {
    const trimmed = symbol.trim();
    if (manualNameEntry) return;
    if (!trimmed) {
      setName('');
      setNameStatus('idle');
      setNameError(null);
      return;
    }
    // 한글 IME로 이 칸에 다른 값을 입력하는 도중(조합 중인 자모 하나짜리 상태
    // 등)엔 토스가 아예 허용하지 않는 문자라 조회할 필요가 없다 — 매 디바운스마다
    // 왕복 요청을 보내는 대신 여기서 바로 "찾을 수 없음"으로 처리한다.
    if (!SYMBOL_CODE_PATTERN.test(trimmed)) {
      setName('');
      setNameStatus('error');
      setNameError(`'${trimmed}' 종목 정보를 찾을 수 없습니다. 종목코드를 확인하거나 직접 입력해주세요.`);
      return;
    }

    let cancelled = false;
    setNameStatus('loading');
    setNameError(null);
    const timer = setTimeout(() => {
      api
        .getStockInfo(trimmed)
        .then((info) => {
          if (cancelled) return;
          setName(info.name);
          setNameStatus('resolved');
        })
        .catch((e) => {
          if (cancelled) return;
          setName('');
          setNameStatus('error');
          setNameError((e as Error).message);
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol, manualNameEntry]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountNum = Number(amount);
    if (!symbol || !name || !amountNum || amountNum <= 0 || !paidDate) {
      setError('종목코드, 종목명, 배당금(양수), 지급일을 입력해주세요.');
      return;
    }
    if (isRowSyncOwned(broker, currency)) {
      setError(`${BROKER_LABELS[broker]}의 원화 배당은 API 동기화로만 관리됩니다(한국투자증권은 달러 배당만 직접 입력).`);
      return;
    }
    const taxNum = taxInput.trim() ? Number(taxInput) : null;
    if (taxNum !== null && (!Number.isFinite(taxNum) || taxNum < 0)) {
      setError('세금은 0 이상의 숫자로 입력해주세요(모르면 비워 두세요).');
      return;
    }
    try {
      await api.addDividend({
        broker,
        accountId: accountId.trim() || null,
        symbol,
        name,
        currency,
        amount: amountNum,
        paidDate,
        memo: memo || null,
        tax: taxNum,
      });
      setSymbol('');
      setTaxInput('');
      setName('');
      setAmount('');
      setMemo('');
      setManualNameEntry(false);
      setNameStatus('idle');
      setNameError(null);
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>배당 기록 추가</h3>
        {error && (
          <p className="text-critical" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </p>
        )}
        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="form-row">
              <label>증권사</label>
              <select value={broker} onChange={(e) => setBroker(e.target.value as BrokerId)}>
                {BROKER_ORDER.filter((id) => !syncOwnedBrokers.has(id) || id === 'kis').map((id) => (
                  <option key={id} value={id}>
                    {BROKER_LABELS[id]}
                    {syncOwnedBrokers.has(id) ? ' (달러 배당만)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>계좌 (선택)</label>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="한 증권사에 계좌가 여러 개일 때만"
              />
            </div>
            <div className="form-row">
              <label>종목코드</label>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="예: AAPL, 005930" />
            </div>
            <div className="form-row">
              <label>종목명</label>
              {manualNameEntry ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 애플"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="ghost" onClick={() => setManualNameEntry(false)}>
                    자동조회
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
                  {nameStatus === 'idle' && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>종목코드 입력 시 자동 조회</span>
                  )}
                  {nameStatus === 'loading' && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>조회 중...</span>
                  )}
                  {nameStatus === 'resolved' && <span>{name}</span>}
                  {nameStatus === 'error' && (
                    <span className="text-critical" style={{ fontSize: 12 }}>
                      {nameError ?? '조회 실패'}
                    </span>
                  )}
                  <button type="button" className="ghost" onClick={() => setManualNameEntry(true)}>
                    직접 입력
                  </button>
                </div>
              )}
            </div>
            <div className="form-row">
              <label>통화</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as DividendCurrency)}>
                <option value="KRW" disabled={broker === 'kis' && syncOwnedBrokers.has('kis')}>
                  원화 (KRW)
                </option>
                <option value="USD">달러 (USD)</option>
              </select>
            </div>
            <div className="form-row">
              <label>배당금 · 세후 ({currency === 'USD' ? '$' : '원'})</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="form-row">
              <label>세금 (선택)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={taxInput}
                onChange={(e) => setTaxInput(e.target.value)}
                placeholder="원천징수 세금"
              />
            </div>
            <div className="form-row">
              <label>지급일</label>
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
            <div className="form-row">
              <label>메모 (선택)</label>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="primary">
            추가
          </button>
        </form>
      </div>
  );
}
