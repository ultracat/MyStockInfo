import { useState } from 'react';
import { api } from '../../api';
import { BROKER_LABELS, CSV_ONLY_BROKER_IDS } from '../../brokers';
import { computeAmount, formatTradeAmount as formatAmount, netTradeAmount } from '../../calc/trades';
import { singleRowImportError } from '../../importResult';
import type { BrokerId } from '../../types';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * "매매내역 추가" 카드 — CSV 전용 브로커(KB/삼성/미래에셋)만 대상. 토스/KIS는 실시간 API로 실제 체결 내역이 그대로 들어오므로
 * (write-through 동기화) 그 위에 수동 입력을 섞으면 어느 쪽이 진짜 체결 내역인지 알 수 없어진다. 체결금액은 입력받지 않고
 * 수량×단가(+수수료·세금은 표시만)로 계산한다. 저장 뒤 화면 맞추기는 `onAdded`(useTradesData의 refreshAfterAdd).
 */
export function TradeAddCard({ onAdded }: { onAdded: (broker: BrokerId, accountId: string) => Promise<void> }) {
  const [addBroker, setAddBroker] = useState<BrokerId>(CSV_ONLY_BROKER_IDS[0]);
  const [addAccountId, setAddAccountId] = useState('');
  const [addSymbol, setAddSymbol] = useState('');
  const [addName, setAddName] = useState('');
  const [addSide, setAddSide] = useState<'BUY' | 'SELL'>('BUY');
  const [addQuantity, setAddQuantity] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addCurrency, setAddCurrency] = useState('KRW');
  const [addExecutedAt, setAddExecutedAt] = useState(today());
  const [addCommission, setAddCommission] = useState('');
  const [addTax, setAddTax] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<string | null>(null);
  // 기본은 접힘 — 대부분의 매매는 증권사 API로 들어와 입력 폼이 화면 한가운데를 차지할 이유가 없다(2026-11-18 UX 점검).
  const [open, setOpen] = useState(false);

  // CSV 가져오기와 같은 백엔드 엔드포인트(POST /trades-store/import)를 행 1개짜리
  // 배열로 호출한다 — id를 안 주면 서버가 새로 발급하므로 항상 새 매매내역으로
  // 추가된다(같은 엔드포인트가 CSV 여러 줄이든 수동 입력 한 줄이든 그대로 처리).
  async function onAddTrade(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddResult(null);

    const quantityNum = Number(addQuantity);
    const priceNum = Number(addPrice);
    if (
      !addAccountId.trim() ||
      !addSymbol.trim() ||
      !Number.isFinite(quantityNum) ||
      quantityNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum < 0 ||
      !addExecutedAt
    ) {
      setAddError('계좌, 종목코드, 수량(양수), 단가(0 이상), 체결일을 입력해주세요.');
      return;
    }

    try {
      const accountIdTrimmed = addAccountId.trim();
      const result = await api.importTradesStore([
        {
          broker: addBroker,
          accountId: accountIdTrimmed,
          symbol: addSymbol.trim(),
          name: addName.trim() ? addName.trim() : null,
          side: addSide,
          quantity: quantityNum,
          price: priceNum,
          amount: quantityNum * priceNum,
          currency: addCurrency,
          executedAt: addExecutedAt,
          commission: addCommission.trim() ? Number(addCommission) : null,
          tax: addTax.trim() ? Number(addTax) : null,
        },
      ]);
      const addFailure = singleRowImportError(result);
      if (addFailure) {
        setAddError(addFailure);
        return;
      }

      setAddSymbol('');
      setAddName('');
      setAddQuantity('');
      setAddPrice('');
      setAddCommission('');
      setAddTax('');
      setAddResult('추가되었습니다.');
      await onAdded(addBroker, accountIdTrimmed);
    } catch (e) {
      setAddError((e as Error).message);
    }
  }

  if (!open) {
    return (
      <div className="card add-collapsed">
        <button className="ghost" onClick={() => setOpen(true)}>
          + 매매내역 직접 추가
        </button>
        <span>KB증권·삼성증권·미래에셋증권처럼 API가 없는 증권사만 — 다른 증권사는 자동으로 채워집니다.</span>
      </div>
    );
  }

  return (
      <div className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>매매내역 추가</h3>
          <button className="ghost" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          API 연동이 없는 증권사(KB증권/삼성증권/미래에셋증권)만 직접 입력할 수 있습니다. 토스증권/
          한국투자증권은 실시간 조회로 매매내역이 자동으로 채워집니다.
        </p>
        {addError && (
          <p className="text-critical" style={{ whiteSpace: 'pre-wrap' }}>
            {addError}
          </p>
        )}
        <form onSubmit={onAddTrade}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="form-row">
              <label>증권사</label>
              <select value={addBroker} onChange={(e) => setAddBroker(e.target.value as BrokerId)}>
                {CSV_ONLY_BROKER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {BROKER_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>계좌</label>
              <input
                value={addAccountId}
                onChange={(e) => setAddAccountId(e.target.value)}
                placeholder="예: 123-45-678901"
              />
            </div>
            <div className="form-row">
              <label>종목코드</label>
              <input value={addSymbol} onChange={(e) => setAddSymbol(e.target.value)} placeholder="예: 005930" />
            </div>
            <div className="form-row">
              <label>종목명 (선택)</label>
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="비우면 자동조회"
              />
            </div>
            <div className="form-row">
              <label>구분</label>
              <select value={addSide} onChange={(e) => setAddSide(e.target.value as 'BUY' | 'SELL')}>
                <option value="BUY">매수</option>
                <option value="SELL">매도</option>
              </select>
            </div>
            <div className="form-row">
              <label>수량</label>
              <input type="number" min="0" step="any" value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} />
            </div>
            <div className="form-row">
              <label>단가</label>
              <input type="number" min="0" step="any" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} />
            </div>
            <div className="form-row">
              <label>통화</label>
              <select value={addCurrency} onChange={(e) => setAddCurrency(e.target.value)}>
                <option value="KRW">원화 (KRW)</option>
                <option value="USD">달러 (USD)</option>
              </select>
            </div>
            <div className="form-row">
              <label>체결금액 (자동계산)</label>
              <input
                type="text"
                value={formatAmount(
                  netTradeAmount(
                    computeAmount(addQuantity, addPrice),
                    addCommission.trim() ? Number(addCommission) : null,
                    addTax.trim() ? Number(addTax) : null
                  ),
                  addCurrency
                )}
                readOnly
                style={{ color: 'var(--text-muted)' }}
              />
            </div>
            <div className="form-row">
              <label>체결일</label>
              <input type="date" value={addExecutedAt} onChange={(e) => setAddExecutedAt(e.target.value)} />
            </div>
            <div className="form-row">
              <label>수수료 (선택)</label>
              <input type="number" min="0" step="any" value={addCommission} onChange={(e) => setAddCommission(e.target.value)} />
            </div>
            <div className="form-row">
              <label>세금 (선택)</label>
              <input type="number" min="0" step="any" value={addTax} onChange={(e) => setAddTax(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="primary">
            추가
          </button>
        </form>
        {addResult && (
          <p className="text-good" style={{ fontSize: 13 }}>
            {addResult}
          </p>
        )}
      </div>
  );
}
