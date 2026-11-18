import { useMemo, useState } from 'react';
import { api } from '../../api';
import { accountLabelKey } from '../../accountLabels';
import { BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import type { BrokerFilter, YearFilter } from '../../calc/dividends';
import StockNameLink, { useStockLinkResolver } from '../../components/StockNameLink';
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
}: {
  year: YearFilter;
  visibleRecords: DividendRecord[];
  brokerOptions: BrokerId[];
  accountLabels: AccountLabel[];
  sync: ReturnType<typeof useDividendSync>;
  refresh: () => Promise<void>;
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

  // 계좌 별칭 — 관리는 Settings.tsx에서만 하고 여기선 읽기만 한다.
  const accountLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of accountLabels) {
      const text = l.label || l.accountNumber;
      if (text) m.set(accountLabelKey(l.broker, l.accountId), text);
    }
    return m;
  }, [accountLabels]);
  function displayAccountId(recordBroker: BrokerId, accountId: string | null): string {
    if (!accountId) return '-';
    return accountLabelMap.get(accountLabelKey(recordBroker, accountId)) ?? accountId;
  }

  async function onDelete(id: string) {
    await api.deleteDividend(id);
    await refresh();
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
  const pageCount = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(listFilteredRecords.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRecords = useMemo(() => {
    if (pageSize === 'ALL') return listFilteredRecords;
    const start = (currentPage - 1) * pageSize;
    return listFilteredRecords.slice(start, start + pageSize);
  }, [listFilteredRecords, pageSize, currentPage]);

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
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>지급일</th>
              <th>증권사</th>
              <th>계좌</th>
              <th>종목코드</th>
              <th>종목명</th>
              <th title="세후 실수령액">배당금</th>
              <th title="원천징수 세금 — 세전 = 배당금 + 세금">세금</th>
              <th>메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listFilteredRecords.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
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
                    <select
                      value={editDraft.broker}
                      onChange={(e) => setEditDraft({ ...editDraft, broker: e.target.value as BrokerId })}
                    >
                      {BROKER_ORDER.map((id) => (
                        <option key={id} value={id}>
                          {BROKER_LABELS[id]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={editDraft.accountId}
                      onChange={(e) => setEditDraft({ ...editDraft, accountId: e.target.value })}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      value={editDraft.symbol}
                      onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select
                        value={editDraft.currency}
                        onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value as DividendCurrency })}
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
                        style={{ width: 90 }}
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editDraft.tax}
                      onChange={(e) => setEditDraft({ ...editDraft, tax: e.target.value })}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      value={editDraft.memo}
                      onChange={(e) => setEditDraft({ ...editDraft, memo: e.target.value })}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
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
                  <td>{BROKER_LABELS[r.broker]}</td>
                  <td>{displayAccountId(r.broker, r.accountId)}</td>
                  <td>{r.symbol}</td>
                  <td>
                    <StockNameLink name={r.name} url={stockLinkFor(r.symbol, r.currency)} />
                  </td>
                  <td>{r.currency === 'USD' ? usdFmt.format(r.amount) : `${krw.format(r.amount)}원`}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {r.tax === null ? '-' : r.currency === 'USD' ? usdFmt.format(r.tax) : `${krw.format(r.tax)}원`}
                  </td>
                  <td>{r.memo ?? '-'}</td>
                  <td>
                    {isRowSyncOwned(r.broker, r.currency) ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }} title="API 동기화로만 관리됩니다">
                        API 연동
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="ghost" onClick={() => startEdit(r)}>
                          수정
                        </button>
                        <button className="ghost" onClick={() => onDelete(r.id)}>
                          삭제
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
