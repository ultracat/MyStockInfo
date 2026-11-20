import { useMemo, useState } from 'react';
import { api } from '../../api';
import { findAccountLabel } from '../../accountLabels';
import AccountCell from '../../components/AccountCell';
import { BROKER_LABELS, CSV_ONLY_BROKER_IDS } from '../../brokers';
import { computeAmount, formatTradeAmount as formatAmount, netTradeAmount, sortTrades, tradeKey, type DisplayTrade, type TradeSortKey } from '../../calc/trades';
import SortButton, { ariaSort } from '../../components/SortButton';
import Hint from '../../components/Hint';
import { qtyFmt } from '../../format';
import { useStockLinkResolver } from '../../components/StockNameLink';
import StockCell from '../../components/StockCell';
import { singleRowImportError } from '../../importResult';
import type { AccountLabel } from '../../types';

type PageSize = 10 | 20 | 30 | 'ALL';
const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, 'ALL'];
const PAGE_GROUP_SIZE = 10;

/**
 * 매매내역 목록 — 위쪽에서 고른 기간·증권사·계좌를 그대로 따라간다(별도 필터 없음). 증권사/계좌 열은 "전체" 모드에서만.
 * 인라인 수정/삭제는 CSV 전용 브로커 행만(토스/KIS 행은 다음 실시간 조회에 되돌아가서). `periodKey`(보기·연도·월)가 바뀌면 첫 페이지로.
 */
export function TradeListCard({
  sortedTrades,
  isAllMode,
  accountLabels,
  periodKey,
  periodLabel,
  kbLinkedAccountId,
  fxRate,
  onEdited,
  onDeleted,
}: {
  sortedTrades: DisplayTrade[];
  isAllMode: boolean;
  accountLabels: AccountLabel[];
  periodKey: string;
  /** 빈 목록 안내의 기간("2026년" / "2026년 3월"). */
  periodLabel: string;
  /** KB 연동 계좌(설정됐을 때만) — CSV 전용 브로커여도 동기화가 주인이라 수정 불가. */
  kbLinkedAccountId: string | null;
  /** 체결금액 정렬용 — 달러 거래를 원화로 환산해 비교한다. */
  fxRate: number | null;
  onEdited: (t: DisplayTrade) => Promise<void>;
  onDeleted: (t: DisplayTrade) => Promise<void>;
}) {
  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);
  // 보기·연도·월을 바꾸면 첫 페이지로(예전엔 그 select들의 onChange가 같이 했다 — 이제 위 화면 몫이라 렌더 중에 맞춘다).
  const [pagePeriod, setPagePeriod] = useState(periodKey);
  if (pagePeriod !== periodKey) {
    setPagePeriod(periodKey);
    setPage(1);
  }

  // 매매내역 목록의 인라인 수정/삭제 — CSV 전용 브로커 행에만 허용한다. 토스/KIS
  // 행은 write-through로 실시간 조회가 성공할 때마다 같은 id로 덮어써지므로,
  // 여기서 고쳐도 다음 라이브 조회에 그대로 되돌아가 의미가 없다.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    symbol: string;
    name: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    price: string;
    currency: string;
    executedAt: string;
    commission: string;
    tax: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEditTrade(t: DisplayTrade) {
    setEditingKey(tradeKey(t));
    setEditDraft({
      symbol: t.symbol,
      name: t.name ?? '',
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      currency: t.currency,
      executedAt: t.executedAt,
      commission: t.commission === null ? '' : String(t.commission),
      tax: t.tax === null ? '' : String(t.tax),
    });
    setEditError(null);
  }

  function cancelEditTrade() {
    setEditingKey(null);
    setEditDraft(null);
    setEditError(null);
  }

  // 같은 (broker, accountId, id)로 다시 import를 호출하면 upsertFromImport가
  // 기존 행을 찾아 덮어쓴다(신규 라우트 불필요 — 수동 추가와 같은 엔드포인트).
  async function saveEditTrade(t: DisplayTrade) {
    if (!editDraft) return;
    const quantityNum = Number(editDraft.quantity);
    const priceNum = Number(editDraft.price);
    if (
      !editDraft.symbol.trim() ||
      !Number.isFinite(quantityNum) ||
      quantityNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum < 0 ||
      !editDraft.executedAt
    ) {
      setEditError('종목코드, 수량(양수), 단가(0 이상), 체결일을 입력해주세요.');
      return;
    }
    // 종목코드를 바꿨는데 종목명 칸은 그대로(수정 시작 때 채워진 옛 이름)면
    // 옛 이름을 직접 입력값으로 보내지 않고 비워서 백엔드가 새 코드로 다시
    // 조회하게 한다 — 안 그러면 옛 이름이 override로 저장되고, "종목명 일괄
    // 갱신"은 이름이 빈 행만 채우므로 영영 안 고쳐진다(실사례: 코드 오기입 수정).
    const symbolChanged = editDraft.symbol.trim().toUpperCase() !== t.symbol.toUpperCase();
    const nameUntouched = editDraft.name.trim() === (t.name ?? '').trim();
    const nameToSave = symbolChanged && nameUntouched ? '' : editDraft.name.trim();
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await api.importTradesStore([
        {
          broker: t.broker,
          accountId: t.accountId,
          id: t.id,
          symbol: editDraft.symbol.trim(),
          name: nameToSave ? nameToSave : null,
          side: editDraft.side,
          quantity: quantityNum,
          price: priceNum,
          amount: quantityNum * priceNum,
          currency: editDraft.currency,
          executedAt: editDraft.executedAt,
          commission: editDraft.commission.trim() ? Number(editDraft.commission) : null,
          tax: editDraft.tax.trim() ? Number(editDraft.tax) : null,
        },
      ]);
      const editFailure = singleRowImportError(result);
      if (editFailure) {
        setEditError(editFailure);
        return;
      }

      setEditingKey(null);
      setEditDraft(null);
      await onEdited(t);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function onDeleteTrade(t: DisplayTrade) {
    await api.deleteTradeStore(t.broker, t.accountId, t.id);
    await onDeleted(t);
  }

  // Dividends.tsx의 배당 기록 목록과 같은 페이지네이션 패턴 — `page`를 effect로
  // 되돌리지 않고 매 렌더마다 pageCount 안으로 clamp해서 쓴다. 페이지 번호 버튼도
  // 동일하게 10개(PAGE_GROUP_SIZE) 그룹 단위로만 그린다.
  // 표 정렬 — 기본은 일자 최근 순서(예전과 같음). 체결금액은 달러를 원화로 환산해 비교한다.
  const [sortKey, setSortKey] = useState<TradeSortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const rows = useMemo(() => sortTrades(sortedTrades, sortKey, sortAsc, fxRate), [sortedTrades, sortKey, sortAsc, fxRate]);
  const sortButton = (key: TradeSortKey, label: string, opts?: { text?: boolean }) => (
    <SortButton
      sortKey={key}
      label={label}
      current={sortKey}
      asc={sortAsc}
      onChange={(k, asc) => {
        setSortKey(k);
        setSortAsc(asc);
        setPage(1);
      }}
      {...opts}
    />
  );

  const pageCount = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(sortedTrades.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTrades = useMemo(() => {
    if (pageSize === 'ALL') return rows;
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, pageSize, currentPage]);
  const pageGroupStart = Math.floor((currentPage - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1;
  const pageGroupEnd = Math.min(pageGroupStart + PAGE_GROUP_SIZE - 1, pageCount);

  return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          {pageCount > 1 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <button className="ghost" disabled={pageGroupStart === 1} onClick={() => setPage(pageGroupStart - PAGE_GROUP_SIZE)}>
                ◀ 이전 10개
              </button>
              {Array.from({ length: pageGroupEnd - pageGroupStart + 1 }, (_, i) => pageGroupStart + i).map((p) => (
                <button
                  key={p}
                  className="ghost"
                  style={
                    p === currentPage
                      ? { background: 'var(--series-1)', color: '#fff', borderColor: 'var(--series-1)' }
                      : undefined
                  }
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button className="ghost" disabled={pageGroupEnd === pageCount} onClick={() => setPage(pageGroupEnd + 1)}>
                다음 10개 ▶
              </button>
            </div>
          ) : (
            <div />
          )}
          <div className="form-row" style={{ margin: 0 }}>
            <label>표시 개수</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value === 'ALL' ? 'ALL' : (Number(e.target.value) as PageSize));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === 'ALL' ? '전체' : `${s}개`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Hint>
          수정·삭제는 직접 입력하는 계좌(CSV 전용 증권사) 행에만 있습니다 — 증권사 API·KB 연동 행은 다음 조회 때 증권사 기록으로 되돌아가서 고칠 수 없습니다.
          체결금액은 수량 × 단가에 수수료·세금을 더한 값입니다.
        </Hint>
        <div className="table-scroll">
        {/* 2026-11-20 표 정리: 증권사는 계좌 칸 아래 줄, 수량 × 단가는 한 칸, 수수료·세금은 체결금액 아래 작은 글씨 — 11열이 1280px 창에서 넘쳤다.
            수정 행도 같은 칸 배치에 입력칸을 위아래로 쌓는다. */}
        <table>
          <thead>
            <tr>
              <th aria-sort={ariaSort(sortKey, sortAsc, 'date')}>{sortButton('date', '일자')}</th>
              {isAllMode && <th>계좌</th>}
              <th className="text" aria-sort={ariaSort(sortKey, sortAsc, 'name')}>{sortButton('name', '종목', { text: true })}</th>
              <th>구분</th>
              <th>수량 × 단가</th>
              <th aria-sort={ariaSort(sortKey, sortAsc, 'amount')}>{sortButton('amount', '체결금액')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.length === 0 ? (
              <tr>
                <td colSpan={isAllMode ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {periodLabel} 거래 내역이 없습니다.
                </td>
              </tr>
            ) : (
              pagedTrades.map((t) => {
                // KB 연동 계좌는 CSV 전용 브로커여도 동기화가 주인이다(backend
                // brokers/rowOwnership.ts) — 고쳐도 백엔드가 건너뛴다.
                const editable =
                  CSV_ONLY_BROKER_IDS.includes(t.broker) &&
                  !(t.broker === 'kb' && kbLinkedAccountId !== null && t.accountId === kbLinkedAccountId);
                const key = tradeKey(t);
                const accountCell = isAllMode && (
                  <td>
                    <AccountCell accountId={t.accountId} entry={findAccountLabel(accountLabels, t.broker, t.accountId)} sub={BROKER_LABELS[t.broker]} />
                  </td>
                );
                if (editingKey === key && editDraft) {
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="date"
                          value={editDraft.executedAt}
                          onChange={(e) => setEditDraft({ ...editDraft, executedAt: e.target.value })}
                        />
                      </td>
                      {accountCell}
                      <td className="text">
                        <div className="stack-inputs">
                          <input
                            value={editDraft.symbol}
                            onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                            style={{ width: 90 }}
                            placeholder="종목코드"
                            aria-label="종목코드"
                          />
                          <input
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            style={{ width: 90 }}
                            placeholder="종목명 (선택)"
                            aria-label="종목명"
                          />
                        </div>
                      </td>
                      <td>
                        <select
                          value={editDraft.side}
                          onChange={(e) => setEditDraft({ ...editDraft, side: e.target.value as 'BUY' | 'SELL' })}
                          aria-label="구분"
                        >
                          <option value="BUY">매수</option>
                          <option value="SELL">매도</option>
                        </select>
                      </td>
                      <td>
                        <div className="stack-inputs">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editDraft.quantity}
                            onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })}
                            placeholder="수량"
                            aria-label="수량"
                            style={{ width: 90 }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editDraft.price}
                            onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                            placeholder="단가"
                            aria-label="단가"
                            style={{ width: 90 }}
                          />
                        </div>
                      </td>
                      <td>
                        <div className="stack-inputs">
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                            <select
                              value={editDraft.currency}
                              onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value })}
                              aria-label="통화"
                            >
                              <option value="KRW">원</option>
                              <option value="USD">USD</option>
                            </select>
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                              {formatAmount(
                                netTradeAmount(
                                  computeAmount(editDraft.quantity, editDraft.price),
                                  editDraft.commission.trim() ? Number(editDraft.commission) : null,
                                  editDraft.tax.trim() ? Number(editDraft.tax) : null
                                ),
                                editDraft.currency
                              )}
                            </span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editDraft.commission}
                            onChange={(e) => setEditDraft({ ...editDraft, commission: e.target.value })}
                            placeholder="수수료 (선택)"
                            aria-label="수수료"
                            style={{ width: 110 }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editDraft.tax}
                            onChange={(e) => setEditDraft({ ...editDraft, tax: e.target.value })}
                            placeholder="세금 (선택)"
                            aria-label="세금"
                            style={{ width: 110 }}
                          />
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="ghost" onClick={() => saveEditTrade(t)} disabled={editSaving}>
                            {editSaving ? '저장 중...' : '저장'}
                          </button>
                          <button className="ghost" onClick={cancelEditTrade} disabled={editSaving}>
                            취소
                          </button>
                        </div>
                        {editError && (
                          <div className="text-critical" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                            {editError}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                }

                const fees = [
                  t.commission ? `수수료 ${formatAmount(t.commission, t.currency)}` : null,
                  t.tax ? `세금 ${formatAmount(t.tax, t.currency)}` : null,
                ].filter(Boolean);
                return (
                  <tr key={key}>
                    <td>{t.executedAt}</td>
                    {accountCell}
                    <td className="text">
                      <StockCell symbol={t.symbol} name={t.name} url={stockLinkFor(t.symbol, t.currency)} />
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          marginRight: 6,
                          background: t.side === 'BUY' ? 'var(--series-1)' : 'var(--series-2)',
                        }}
                      />
                      {t.side === 'BUY' ? '매수' : '매도'}
                    </td>
                    <td>
                      {qtyFmt.format(t.quantity)}주
                      <span className="cell-sub">× {formatAmount(t.price, t.currency)}</span>
                    </td>
                    <td>
                      {formatAmount(netTradeAmount(t.amount, t.commission, t.tax), t.currency)}
                      {/* 화면 금액 = 수량×단가 + 수수료 + 세금(저장값은 수량×단가 그대로 — frontend/CLAUDE.md 매매내역 절) */}
                      {fees.length > 0 && <span className="cell-sub">{fees.join(' · ')} 포함</span>}
                    </td>
                    <td>
                      {editable && (
                        <div className="row-actions">
                          <button className="ghost" onClick={() => startEditTrade(t)}>
                            수정
                          </button>
                          <button className="ghost" onClick={() => onDeleteTrade(t)}>
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
  );
}
