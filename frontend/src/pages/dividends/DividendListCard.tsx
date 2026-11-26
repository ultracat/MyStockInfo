import { useMemo, useState } from 'react';
import { api } from '../../api';
import { findAccountLabel, resolveDividendAccountId } from '../../accountLabels';
import AccountCell from '../../components/AccountCell';
import SortButton, { ariaSort } from '../../components/SortButton';
import Hint from '../../components/Hint';
import { sortDividendRecords, type DividendSortKey } from '../../calc/dividends';
import { BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import type { BrokerFilter, YearFilter } from '../../calc/dividends';
import { useStockLinkResolver } from '../../components/StockNameLink';
import StockCell from '../../components/StockCell';
import { krw, usdFmt } from '../../format';
import type { AccountLabel, BrokerId, DividendCurrency, DividendRecord } from '../../types';
import { DividendTransferBar } from './DividendTransferBar';
import type { useDividendSync } from './useDividendSync';

type PageSize = 10 | 20 | 30 | 'ALL';
const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, 'ALL'];
const PAGE_GROUP_SIZE = 10;

/**
 * 하단 "배당 기록" 카드 — 목록 전용 증권사 필터(그래프 필터와 독립), 종목명 일괄 갱신·배당 동기화 버튼, CSV/Google Sheets
 * 내보내기·가져오기, 페이지네이션, 인라인 수정·삭제(API 동기화 행은 "API 연동"으로 막음). 연도 필터는 위에서 받는다.
 */
export function DividendListCard({
  year,
  visibleRecords,
  brokerOptions,
  accountLabels,
  sync,
  refresh,
  fxRateFor,
}: {
  year: YearFilter;
  visibleRecords: DividendRecord[];
  brokerOptions: BrokerId[];
  accountLabels: AccountLabel[];
  sync: ReturnType<typeof useDividendSync>;
  refresh: () => Promise<void>;
  /** 금액 정렬용 — 달러 배당을 지급월 평균 환율로 원화 환산해 비교한다(없으면 그 행은 맨 뒤). */
  fxRateFor: (month: string) => number | null;
}) {
  const { syncOwnedBrokers, dividendSyncing, dividendSyncNotice, runDividendSync, isRowSyncOwned } = sync;
  const [listBroker, setListBroker] = useState<BrokerFilter>('ALL');
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);
  // 연도를 바꾸면 첫 페이지로(예전엔 연도 select의 onChange가 같이 했다 — 이제 연도는 위 화면 몫이라 렌더 중에 맞춘다).
  const [pageYear, setPageYear] = useState(year);
  if (pageYear !== year) {
    setPageYear(year);
    setPage(1);
  }
  const [refreshingNames, setRefreshingNames] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);


  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();

  // 계좌 별칭 — 관리는 Settings.tsx에서만 하고 여기선 읽기만 한다. 배당 기록의 계좌는 토스처럼 표시용 번호로 적혀 있을 수 있어
  // 내부 accountId로 되돌려 별칭을 찾는다(없으면 적힌 값 그대로).
  function accountCell(recordBroker: BrokerId, accountId: string | null) {
    if (!accountId) return <span className="cell-account">{BROKER_LABELS[recordBroker]}</span>;
    const id = resolveDividendAccountId(accountLabels, recordBroker, accountId) ?? accountId;
    return <AccountCell accountId={id} entry={findAccountLabel(accountLabels, recordBroker, id)} sub={BROKER_LABELS[recordBroker]} />;
  }

  // 삭제 — 되돌릴 수 없어서 한 번 묻고(Google Sheets 덮어쓰기와 같은 window.confirm), 실패하면 표 위에 알린다(2026-11-26 — 예전엔
  // 묻지 않고 지웠고, 실패하면 거부가 그대로 묻혀 아무 반응이 없었다).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function onDelete(r: DividendRecord) {
    const amountText = r.currency === 'USD' ? usdFmt.format(r.amount) : `${krw.format(r.amount)}원`;
    if (!window.confirm(`${r.paidDate} ${r.name || r.symbol} 배당 ${amountText} 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setDeleteError(null);
    setDeletingId(r.id);
    try {
      await api.deleteDividend(r.id);
      await refresh();
    } catch (e) {
      setDeleteError(`삭제하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  }

  // 배당 기록 목록의 인라인 수정 — 한 번에 한 행만 편집 가능(editingId).
  // 다른 행에서 "수정"을 누르면 그 행으로 그냥 전환된다(저장 안 한 편집 내용은
  // 버려짐) — 개인용 기록 관리 화면이라 "저장 안 한 변경사항" 경고까지는
  // 과하다고 판단.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    broker: BrokerId;
    accountId: string;
    symbol: string;
    name: string;
    currency: DividendCurrency;
    amount: string;
    paidDate: string;
    memo: string;
    tax: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(r: DividendRecord) {
    setEditingId(r.id);
    setEditDraft({
      broker: r.broker,
      accountId: r.accountId ?? '',
      symbol: r.symbol,
      name: r.name,
      currency: r.currency,
      amount: String(r.amount),
      paidDate: r.paidDate,
      memo: r.memo ?? '',
      tax: r.tax === null ? '' : String(r.tax),
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    const amountNum = Number(editDraft.amount);
    if (!editDraft.symbol || !editDraft.name || !amountNum || amountNum <= 0 || !editDraft.paidDate) {
      setEditError('종목코드, 종목명, 배당금(양수), 지급일을 입력해주세요.');
      return;
    }
    const editTax = editDraft.tax.trim() ? Number(editDraft.tax) : null;
    if (editTax !== null && (!Number.isFinite(editTax) || editTax < 0)) {
      setEditError('세금은 0 이상의 숫자로 입력해주세요(모르면 비워 두세요).');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateDividend(id, {
        broker: editDraft.broker,
        accountId: editDraft.accountId.trim() || null,
        symbol: editDraft.symbol,
        name: editDraft.name,
        currency: editDraft.currency,
        amount: amountNum,
        paidDate: editDraft.paidDate,
        memo: editDraft.memo || null,
        tax: editTax,
      });
      setEditingId(null);
      setEditDraft(null);
      await refresh();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function onRefreshNames() {
    setRefreshingNames(true);
    setRefreshResult(null);
    try {
      const result = await api.refreshDividendNames();
      setRefreshResult(
        result.failed.length > 0
          ? `${result.updated}건 갱신됨 (조회 실패: ${result.failed.join(', ')})`
          : `${result.updated}건 갱신됨 (${result.resolved}개 종목 조회)`
      );
      await refresh();
    } catch (e) {
      setRefreshResult((e as Error).message);
    } finally {
      setRefreshingNames(false);
    }
  }

  // 배당 기록 목록 전용 증권사 필터 — chartBroker(그래프 전용)와는 독립적이다.
  // 연도 필터(visibleRecords)는 그래프·증권사별 표·목록에 전부 적용되는 페이지
  // 전역 필터인 반면, 이건 하단 "배당 기록" 목록 하나만 좁힌다("증권사별 배당금
  // 총계" 표는 비교가 목적이라 여기서도 필터링하지 않는다).
  const listFilteredRecords = useMemo(() => {
    if (listBroker === 'ALL') return visibleRecords;
    return visibleRecords.filter((r) => r.broker === listBroker);
  }, [visibleRecords, listBroker]);

  // 하단 배당 기록 목록의 페이지네이션. `page` state가 필터/삭제로 범위를
  // 벗어나도(예: 마지막 페이지 항목을 지운 경우) 별도 effect로 되돌리지 않고
  // 매 렌더마다 pageCount 안으로 clamp해서 쓴다 — 그래서 슬라이스에도, "현재
  // 페이지" 표시에도 항상 이 clamp된 값 하나만 쓴다.
  // 표 정렬(2026-11-20) — 기본은 지급일 최근 순서. 금액(세후)은 달러를 지급월 평균 환율로 원화 환산해 비교한다.
  const [sortKey, setSortKey] = useState<DividendSortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const sortedRecords = useMemo(
    () => sortDividendRecords(listFilteredRecords, sortKey, sortAsc, fxRateFor),
    [listFilteredRecords, sortKey, sortAsc, fxRateFor]
  );
  const sortButton = (key: DividendSortKey, label: string, opts?: { text?: boolean }) => (
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
  const money = (v: number, currency: DividendCurrency) => (currency === 'USD' ? usdFmt.format(v) : `${krw.format(v)}원`);

  const pageCount = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRecords = useMemo(() => {
    if (pageSize === 'ALL') return sortedRecords;
    const start = (currentPage - 1) * pageSize;
    return sortedRecords.slice(start, start + pageSize);
  }, [sortedRecords, pageSize, currentPage]);

  // 페이지 번호 버튼은 한 번에 10개(PAGE_GROUP_SIZE) 그룹 단위로만 보여준다 —
  // pageCount가 크면(예: "표시 개수"를 10개로 두고 기록이 몇 백 건이면) 버튼이
  // 한 줄에 다 안 들어가서, currentPage가 속한 그룹만 렌더링하고 그 그룹 양 끝에
  // "이전 10개"/"다음 10개"로 그룹 자체를 이동하는 버튼을 둔다.
  const pageGroupStart = Math.floor((currentPage - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1;
  const pageGroupEnd = Math.min(pageGroupStart + PAGE_GROUP_SIZE - 1, pageCount);

  return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={onRefreshNames} disabled={refreshingNames}>
            {refreshingNames ? '갱신 중...' : '종목명 일괄 갱신'}
          </button>
          {refreshResult && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{refreshResult}</span>}
          {syncOwnedBrokers.size > 0 && (
            <button
              className="ghost"
              onClick={() => runDividendSync(true)}
              disabled={dividendSyncing}
              title={`${[...syncOwnedBrokers].map((b) => BROKER_LABELS[b]).join('·')} 배당을 API 내용으로 다시 맞춥니다`}
            >
              {dividendSyncing ? '배당 동기화 중...' : '배당 동기화'}
            </button>
          )}
          {dividendSyncNotice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dividendSyncNotice}</span>}
          <DividendTransferBar listFilteredRecords={listFilteredRecords} listBroker={listBroker} refresh={refresh} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>증권사</label>
            <select
              value={listBroker}
              onChange={(e) => {
                setListBroker(e.target.value as BrokerFilter);
                setPage(1);
              }}
            >
              <option value="ALL">전체</option>
              {brokerOptions.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
        </div>
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
          배당금은 <b>세후 실수령액</b>이고 아래 작은 글씨가 원천징수 세금입니다(세전 = 배당금 + 세금). 증권사 API로 동기화되는 기록(토스·한국투자·NH·키움·LS·DB의
          원화 배당 등)은 다음 동기화 때 API 내용으로 바뀌어 여기서 고치거나 지울 수 없습니다 — 수정·삭제 버튼은 직접 입력한 기록에만 있습니다.
        </Hint>
        {deleteError && (
          <p className="text-critical" style={{ whiteSpace: 'pre-wrap' }}>
            {deleteError}
          </p>
        )}
        <div className="table-scroll">
        {/* 2026-11-20 표 정리: 증권사는 계좌 칸 아래 줄, 세금은 배당금 아래 작은 글씨(8열 → 6열). 수정 행도 같은 칸에 입력칸을 쌓는다. */}
        <table>
          <thead>
            <tr>
              <th aria-sort={ariaSort(sortKey, sortAsc, 'date')}>{sortButton('date', '지급일')}</th>
              <th>계좌</th>
              <th className="text" aria-sort={ariaSort(sortKey, sortAsc, 'name')}>{sortButton('name', '종목', { text: true })}</th>
              <th aria-sort={ariaSort(sortKey, sortAsc, 'amount')}>{sortButton('amount', '배당금')}</th>
              <th className="text">메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listFilteredRecords.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {year === 'ALL' ? '배당 기록이 없습니다.' : `${year}년 배당 기록이 없습니다.`}
                  {listBroker !== 'ALL' ? ` (${BROKER_LABELS[listBroker]} 기준)` : ''}
                </td>
              </tr>
            )}
            {pagedRecords.map((r) =>
              editingId === r.id && editDraft ? (
                <tr key={r.id}>
                  <td>
                    <input
                      type="date"
                      value={editDraft.paidDate}
                      onChange={(e) => setEditDraft({ ...editDraft, paidDate: e.target.value })}
                    />
                  </td>
                  <td>
                    <div className="stack-inputs">
                      <input
                        value={editDraft.accountId}
                        onChange={(e) => setEditDraft({ ...editDraft, accountId: e.target.value })}
                        placeholder="계좌 (선택)"
                        aria-label="계좌"
                        style={{ width: 120 }}
                      />
                      <select
                        value={editDraft.broker}
                        onChange={(e) => setEditDraft({ ...editDraft, broker: e.target.value as BrokerId })}
                        aria-label="증권사"
                      >
                        {BROKER_ORDER.map((id) => (
                          <option key={id} value={id}>
                            {BROKER_LABELS[id]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="text">
                    {/* 종목코드 위, 종목명 아래 — 보기 칸(StockCell)과 같은 순서로 한 칸에 쌓는다(매매내역 수정 행과 같은 방식). */}
                    <div className="stack-inputs">
                      <input
                        value={editDraft.symbol}
                        onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                        placeholder="종목코드"
                        aria-label="종목코드"
                        style={{ width: 80 }}
                      />
                      <input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        placeholder="종목명"
                        aria-label="종목명"
                      />
                    </div>
                  </td>
                  <td>
                    <div className="stack-inputs">
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          value={editDraft.currency}
                          onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value as DividendCurrency })}
                          aria-label="통화"
                        >
                          <option value="KRW">원</option>
                          <option value="USD">USD</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDraft.amount}
                          onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
                          placeholder="배당금(세후)"
                          aria-label="배당금(세후)"
                          style={{ width: 100 }}
                        />
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.tax}
                        onChange={(e) => setEditDraft({ ...editDraft, tax: e.target.value })}
                        placeholder="세금 (선택)"
                        aria-label="세금"
                        style={{ width: 100 }}
                      />
                    </div>
                  </td>
                  <td className="text">
                    <input
                      value={editDraft.memo}
                      onChange={(e) => setEditDraft({ ...editDraft, memo: e.target.value })}
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="ghost" onClick={() => saveEdit(r.id)} disabled={editSaving}>
                        {editSaving ? '저장 중...' : '저장'}
                      </button>
                      <button className="ghost" onClick={cancelEdit} disabled={editSaving}>
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
              ) : (
                <tr key={r.id}>
                  <td>{r.paidDate}</td>
                  <td>{accountCell(r.broker, r.accountId)}</td>
                  <td className="text">
                    <StockCell symbol={r.symbol} name={r.name} url={stockLinkFor(r.symbol, r.currency)} />
                  </td>
                  <td>
                    {money(r.amount, r.currency)}
                    {r.tax !== null && r.tax > 0 && <span className="cell-sub">세금 {money(r.tax, r.currency)}</span>}
                  </td>
                  {/* 긴 메모가 표를 넓히지 않게 — 이 폭에서 줄을 바꾼다 */}
                  <td className="text cell-memo">{r.memo ?? '-'}</td>
                  <td>
                    {isRowSyncOwned(r.broker, r.currency) ? (
                      <span className="cell-sub" style={{ textAlign: 'right' }}>API 연동</span>
                    ) : (
                      <div className="row-actions">
                        <button className="ghost" onClick={() => startEdit(r)}>
                          수정
                        </button>
                        <button className="ghost" onClick={() => onDelete(r)} disabled={deletingId !== null}>
                          {deletingId === r.id ? '삭제 중...' : '삭제'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        </div>
      </div>
  );
}
