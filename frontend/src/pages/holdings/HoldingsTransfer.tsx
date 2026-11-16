import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { downloadCsv, parseCsv } from '../../csv';
import { formatImportResult } from '../../importResult';
import type { BrokerId } from '../../types';

const HOLDINGS_CSV_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'quantity',
  'averagePurchasePrice',
  'lastPrice',
  'purchaseAmount',
  'marketValue',
  'profitLossAmount',
  'profitLossRate',
  'commission',
  'tax',
  'currency',
  'market',
  'memo',
];

/**
 * 보유 종목 CSV·Google Sheets 내보내기/가져오기. 범위는 화면 선택과 무관하게 로컬 저장소 전체(행마다 broker/accountId).
 * CSV 가져오기는 CSV에 나온 계좌의 기존 행을 덮어쓴다. 가져온 뒤 `refreshAfterStoreImport()`(useHoldings)로 화면을 맞춘다.
 * 결과 문구(importResult·googleSyncResult)는 화면이 다른 안내 줄과 같은 자리에 그린다.
 */
export function useHoldingsTransfer(refreshAfterStoreImport: () => Promise<void>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // 로컬 저장소(holdings-store)는 실시간 조회가 성공할 때마다 write-through로
  // 갱신되고, CSV로도 채울 수 있다(API 연동이 없는 KB증권 등) — 내보내기는 현재
  // 화면의 브로커/계좌 하나가 아니라 저장소에 쌓인 전체를 대상으로 한다(여러
  // 브로커/계좌를 한 파일로 오가려는 용도).
  async function onExportCsv() {
    const holdings = await api.listHoldingsStore();
    const rows: string[][] = [
      HOLDINGS_CSV_HEADER,
      ...holdings.map((h) => [
        h.broker,
        h.accountId,
        h.symbol,
        String(h.quantity),
        String(h.averagePurchasePrice),
        String(h.lastPrice),
        String(h.purchaseAmount),
        String(h.marketValue),
        String(h.profitLossAmount),
        String(h.profitLossRate),
        h.commission === null ? '' : String(h.commission),
        h.tax === null ? '' : String(h.tax),
        h.currency ?? '',
        h.market ?? '',
        h.memo ?? '',
      ]),
    ];
    downloadCsv(`holdings-${new Date().toISOString().slice(0, 10)}.csv`, rows);
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
      const iQuantity = colIndex('quantity');
      const iAvgPrice = colIndex('averagePurchasePrice');
      const iLastPrice = colIndex('lastPrice');
      const iPurchaseAmount = colIndex('purchaseAmount');
      const iMarketValue = colIndex('marketValue');
      const iProfitLossAmount = colIndex('profitLossAmount');
      const iProfitLossRate = colIndex('profitLossRate');
      const iCommission = colIndex('commission');
      const iTax = colIndex('tax');
      const iCurrency = colIndex('currency');
      const iMarket = colIndex('market');
      const iMemo = colIndex('memo');

      if ([iBroker, iAccountId, iSymbol, iQuantity, iAvgPrice, iCurrency].some((i) => i === -1)) {
        setImportResult(
          `CSV 헤더가 올바르지 않습니다. 최소 broker,accountId,symbol,quantity,averagePurchasePrice,currency 컬럼이 필요합니다.`
        );
        return;
      }

      const num = (v: string | undefined) => {
        const trimmed = (v ?? '').trim();
        return trimmed === '' ? undefined : Number(trimmed);
      };

      const records = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim().toLowerCase() as BrokerId,
          accountId: (r[iAccountId] ?? '').trim(),
          symbol: (r[iSymbol] ?? '').trim(),
          quantity: Number((r[iQuantity] ?? '').trim()),
          averagePurchasePrice: Number((r[iAvgPrice] ?? '').trim()),
          lastPrice: iLastPrice !== -1 ? num(r[iLastPrice]) : undefined,
          purchaseAmount: iPurchaseAmount !== -1 ? num(r[iPurchaseAmount]) : undefined,
          marketValue: iMarketValue !== -1 ? num(r[iMarketValue]) : undefined,
          profitLossAmount: iProfitLossAmount !== -1 ? num(r[iProfitLossAmount]) : undefined,
          profitLossRate: iProfitLossRate !== -1 ? num(r[iProfitLossRate]) : undefined,
          commission: iCommission !== -1 ? (num(r[iCommission]) ?? null) : null,
          tax: iTax !== -1 ? (num(r[iTax]) ?? null) : null,
          currency: (r[iCurrency] ?? '').trim() as 'KRW' | 'USD',
          market: iMarket !== -1 && (r[iMarket] ?? '').trim() ? r[iMarket].trim() : null,
          memo: iMemo !== -1 && (r[iMemo] ?? '').trim() ? r[iMemo].trim() : null,
        }));

      const result = await api.importHoldingsStore(records);
      setImportResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // Google Sheets 연동 — Settings.tsx에서 연결 여부만 확인하고, 실제 내보내기/
  // 가져오기는 여기서 실행한다(CSV 내보내기/가져오기와 같은 대상: holdings-store
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
    if (!window.confirm('Google Sheets의 Holdings 탭 전체를 로컬 데이터로 덮어씁니다. 시트에 직접 입력했지만 아직 "가져오기"로 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.exportToGoogleSheet('holdings');
      setGoogleSyncResult(`Google Sheets로 ${result.rowCount}건 내보냈습니다.`);
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  async function onImportFromGoogleSheet() {
    if (!window.confirm('Google Sheets의 Holdings 탭 내용으로 수동 입력 계좌의 로컬 데이터를 전부 교체합니다(API·동기화 계좌는 실시간 조회/동기화 값을 그대로 둡니다). 시트에 실패하는 행이 하나라도 있으면 아무것도 바꾸지 않습니다. 로컬에서 직접 추가/수정했지만 아직 "내보내기"로 시트에 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.importFromGoogleSheet('holdings');
      setGoogleSyncResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  return {
    fileInputRef,
    importing,
    importResult,
    googleConnected,
    googleSyncing,
    googleSyncResult,
    onExportCsv,
    onImportClick,
    onImportFile,
    onExportToGoogleSheet,
    onImportFromGoogleSheet,
  };
}

/** 머리줄의 CSV·Google Sheets 버튼 네 개(+ 숨은 파일 입력). */
export function HoldingsTransferButtons({ t }: { t: ReturnType<typeof useHoldingsTransfer> }) {
  const { fileInputRef, importing, googleConnected, googleSyncing, onExportCsv, onImportClick, onImportFile, onExportToGoogleSheet, onImportFromGoogleSheet } = t;
  return (
    <>
          <button className="ghost" onClick={onExportCsv}>
            CSV 내보내기 (전체)
          </button>
          <button
            className="ghost"
            onClick={onImportClick}
            disabled={importing}
            title="CSV에 포함된 계좌(broker+accountId)의 기존 보유 종목을 전부 덮어씁니다."
          >
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
    </>
  );
}
