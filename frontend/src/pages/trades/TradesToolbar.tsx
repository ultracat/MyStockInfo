import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { downloadCsv, parseCsv } from '../../csv';
import { formatImportResult } from '../../importResult';
import type { BrokerId } from '../../types';
import type { useTradesData } from './useTradesData';
import ActionMenu from '../../components/ActionMenu';
import { localToday } from '../../format';

// id는 브로커 고유 체결번호라 CSV 입력행엔 없고 없으면 서버가 새로 발급한다.
// name(종목명)은 선택 컬럼 — 비워두면 백엔드가 토스→KIS→KB 순으로 자동조회해서
// 채운다(backend/CLAUDE.md 참고), 값을 채우면 그 값을 그대로 쓴다(API 연동이
// 전혀 없을 때의 유일한 채움 경로).
const TRADES_CSV_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'name',
  'side',
  'quantity',
  'price',
  'amount',
  'currency',
  'executedAt',
  'commission',
  'tax',
  // 선택 컬럼(맨 뒤) — 다시 가져올 때 같은 거래로 덮어쓰게 해서 중복을 막는다
  // (backend/src/db/tradesStore.ts의 "중복 방지" 참고).
  'id',
];

/**
 * 매매내역 머리줄 — 제목 + CSV 내보내기(전체)/가져오기, Google Sheets 내보내기/가져오기, 종목명 일괄 갱신, KB 새로고침 버튼과
 * 그 결과 안내 줄들. 내보내기·가져오기 범위는 화면 선택과 무관하게 로컬 저장소 전체(행마다 broker/accountId가 있음).
 */
export function TradesToolbar({ data }: { data: ReturnType<typeof useTradesData> }) {
  const { isKbSyncable, triggerKbSync, kbSyncing, kbSyncNotice, refreshAfterStoreImport } = data;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [refreshingNames, setRefreshingNames] = useState(false);
  const [refreshNamesResult, setRefreshNamesResult] = useState<string | null>(null);

  // 로컬 저장소(trades-store)에 이미 쌓인 행 중 종목명이 없는 것만 채운다 —
  // name 필드가 생기기 전에 저장됐던 행(당시엔 write-through가 이름을 버렸음)이나,
  // 그때는 API 연동이 없어서 못 채웠던 행을 위한 일괄 백필. Dividends.tsx의
  // "종목명 일괄 갱신"과 같은 패턴(backend/CLAUDE.md의 "매매내역 종목명" 절 참고).
  async function onRefreshNames() {
    setRefreshingNames(true);
    setRefreshNamesResult(null);
    try {
      const result = await api.refreshTradeNames();
      setRefreshNamesResult(
        result.failed.length > 0
          ? `${result.updated}건 갱신됨 (조회 실패: ${result.failed.join(', ')})`
          : `${result.updated}건 갱신됨`
      );
      await data.refreshAfterNames();
    } catch (e) {
      setRefreshNamesResult((e as Error).message);
    } finally {
      setRefreshingNames(false);
    }
  }

  // 로컬 저장소(trades-store)는 실시간 조회가 성공할 때마다 write-through로
  // 갱신되고, CSV로도 채울 수 있다(API 연동이 없는 KB증권 등) — 내보내기는 현재
  // 화면에 보이는 연도/브로커 하나가 아니라 저장소에 쌓인 전체를 대상으로 한다.
  async function onExportCsv() {
    const stored = await api.listTradesStore();
    const rows: string[][] = [
      TRADES_CSV_HEADER,
      ...stored.map((t) => [
        t.broker,
        t.accountId,
        t.symbol,
        t.name ?? '',
        t.side,
        String(t.quantity),
        String(t.price),
        String(t.amount),
        t.currency,
        t.executedAt,
        t.commission === null ? '' : String(t.commission),
        t.tax === null ? '' : String(t.tax),
        t.id,
      ]),
    ];
    downloadCsv(`trades-${localToday()}.csv`, rows);
  }

  function onImportClick() {
    fileInputRef.current?.click();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setImportResult('CSV 파일이 비어 있습니다.');
        return;
      }

      const [header, ...dataRows] = rows;
      const colIndex = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
      const iBroker = colIndex('broker');
      const iAccountId = colIndex('accountId');
      const iSymbol = colIndex('symbol');
      const iName = colIndex('name');
      const iSide = colIndex('side');
      const iQuantity = colIndex('quantity');
      const iPrice = colIndex('price');
      const iAmount = colIndex('amount');
      const iCurrency = colIndex('currency');
      const iExecutedAt = colIndex('executedAt');
      const iCommission = colIndex('commission');
      const iTax = colIndex('tax');
      const iId = colIndex('id');

      if (
        [iBroker, iAccountId, iSymbol, iSide, iQuantity, iPrice, iAmount, iCurrency, iExecutedAt].some(
          (i) => i === -1
        )
      ) {
        setImportResult(`CSV 헤더가 올바르지 않습니다. 다음 컬럼이 필요합니다: ${TRADES_CSV_HEADER.join(', ')}`);
        return;
      }

      const num = (v: string | undefined) => {
        const trimmed = (v ?? '').trim();
        return trimmed === '' ? null : Number(trimmed);
      };

      const records = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim().toLowerCase() as BrokerId,
          accountId: (r[iAccountId] ?? '').trim(),
          symbol: (r[iSymbol] ?? '').trim(),
          name: iName !== -1 && (r[iName] ?? '').trim() ? r[iName].trim() : null,
          side: (r[iSide] ?? '').trim() as 'BUY' | 'SELL',
          quantity: Number((r[iQuantity] ?? '').trim()),
          price: Number((r[iPrice] ?? '').trim()),
          amount: Number((r[iAmount] ?? '').trim()),
          currency: (r[iCurrency] ?? '').trim(),
          executedAt: (r[iExecutedAt] ?? '').trim(),
          commission: iCommission !== -1 ? num(r[iCommission]) : null,
          tax: iTax !== -1 ? num(r[iTax]) : null,
          id: iId !== -1 && (r[iId] ?? '').trim() ? r[iId].trim() : undefined,
        }));

      const result = await api.importTradesStore(records);
      setImportResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // Google Sheets 연동 — Settings.tsx에서 연결 여부만 확인하고, 실제 내보내기/
  // 가져오기는 여기서 실행한다(CSV 내보내기/가져오기와 같은 대상: trades-store
  // 전체, 브로커/계좌 필터 없음).
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleSyncResult, setGoogleSyncResult] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGoogleStatus()
      .then((s) => setGoogleConnected(s.connected))
      .catch(() => setGoogleConnected(false));
  }, []);

  async function onExportToGoogleSheet() {
    // 내보내기/가져오기 둘 다 전체 교체다(Dividends.tsx와 같은 이유) — 어느
    // 한쪽에만 있는 최신 내용이 반대쪽으로 덮어써지며 사라질 수 있어 확인창을
    // 넣는다(실제로 시트에 직접 입력한 내용이 내보내기로 유실된 사례 있음).
    if (!window.confirm('Google Sheets의 Trades 탭 전체를 로컬 데이터로 덮어씁니다. 시트에 직접 입력했지만 아직 "가져오기"로 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.exportToGoogleSheet('trades');
      setGoogleSyncResult(`Google Sheets로 ${result.rowCount}건 내보냈습니다.`);
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  async function onImportFromGoogleSheet() {
    if (!window.confirm('Google Sheets의 Trades 탭 내용으로 수동 입력 계좌의 로컬 데이터를 전부 교체합니다(API·동기화 계좌는 실시간 조회/동기화 값을 그대로 둡니다). 시트에 실패하는 행이 하나라도 있으면 아무것도 바꾸지 않습니다. 로컬에서 직접 추가/수정했지만 아직 "내보내기"로 시트에 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.importFromGoogleSheet('trades');
      setGoogleSyncResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">매매내역</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ActionMenu label="가져오기·내보내기">
          <button className="ghost" onClick={onExportCsv}>
            CSV 내보내기 (전체)
          </button>
          <button className="ghost" onClick={onImportClick} disabled={importing}>
            {importing ? '가져오는 중...' : 'CSV 가져오기'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onImportFile} />
          <button
            className="ghost"
            onClick={onExportToGoogleSheet}
            disabled={!googleConnected || googleSyncing}
            title={googleConnected ? undefined : '설정에서 Google 계정을 먼저 연결해주세요.'}
          >
            {googleSyncing ? '처리 중...' : 'Google Sheets로 내보내기'}
          </button>
          <button
            className="ghost"
            onClick={onImportFromGoogleSheet}
            disabled={!googleConnected || googleSyncing}
            title={googleConnected ? undefined : '설정에서 Google 계정을 먼저 연결해주세요.'}
          >
            {googleSyncing ? '처리 중...' : 'Google Sheets에서 가져오기'}
          </button>
          <button
            className="ghost"
            onClick={onRefreshNames}
            disabled={refreshingNames}
            title="저장된 매매내역 중 종목명이 비어 있는 행만 토스→KIS→KB 순으로 조회해 채웁니다."
          >
            {refreshingNames ? '갱신 중...' : '종목명 일괄 갱신'}
          </button>
          </ActionMenu>
          {isKbSyncable && (
            <button className="ghost" onClick={triggerKbSync} disabled={kbSyncing}>
              {kbSyncing ? '동기화 중...' : '새로고침'}
            </button>
          )}
        </div>
      </div>

      {importResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {importResult}
        </div>
      )}
      {googleSyncResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {googleSyncResult}
        </div>
      )}
      {refreshNamesResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {refreshNamesResult}
        </div>
      )}
      {kbSyncing && (
        <div className="notice" style={{ fontSize: 13 }}>
          KB증권 최신 매매내역을 백그라운드에서 가져오는 중...
        </div>
      )}
      {kbSyncNotice && (
        <div className="notice text-critical" style={{ fontSize: 13 }}>
          {kbSyncNotice}
        </div>
      )}
    </>
  );
}
