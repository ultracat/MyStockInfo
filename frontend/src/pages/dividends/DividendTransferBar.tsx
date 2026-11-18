import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import type { BrokerFilter } from '../../calc/dividends';
import { downloadCsv, parseCsv } from '../../csv';
import { formatImportResult } from '../../importResult';
import type { BrokerId, DividendCurrency, DividendRecord } from '../../types';
import ActionMenu from '../../components/ActionMenu';

// export/import 왕복 호환을 위한 CSV 컬럼 — DividendRecord 필드명을 그대로 헤더로
// 쓴다(한글 헤더 대신 필드명을 쓰는 이유: 내보낸 파일을 그대로 다시 가져올 때
// 헤더 매칭이 대소문자만 다르면 되게 하기 위함). name(종목명)은 없다 — 심볼로부터
// 서버가 자동조회하므로 CSV에 넣을 필요가 없다(가져오기도 마찬가지). accountId는
// 선택 컬럼 — 브로커 한 곳에 계좌가 여러 개일 때만 채우면 된다.
// amount = 세후(실수령), tax = 원천징수 세금(선택 — 예전 CSV처럼 없어도 된다).
const DIVIDEND_CSV_HEADER = ['broker', 'accountId', 'symbol', 'currency', 'amount', 'paidDate', 'memo', 'tax'];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 배당 기록 CSV·Google Sheets 내보내기/가져오기 줄. CSV 내보내기 범위는 목록의 증권사 필터(listBroker) 그대로, CSV 가져오기는
 * 별도 "가져오기 대상"으로 고른다. Google Sheets는 전체 교체(확인창). 가져온 뒤 `refresh()`로 목록을 다시 읽는다.
 */
export function DividendTransferBar({
  listFilteredRecords,
  listBroker,
  refresh,
}: {
  listFilteredRecords: DividendRecord[];
  listBroker: BrokerFilter;
  refresh: () => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importBroker, setImportBroker] = useState<BrokerFilter>('ALL');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // listBroker(하단 목록 필터)를 그대로 내보내기 범위로 쓴다 — "전체"면 전체,
  // 특정 증권사를 골라두면 그 증권사만. 화면에 이미 있는 필터를 재사용하는 것뿐이라
  // 내보내기 전용 UI를 따로 둘 필요가 없다.
  function onExportCsv() {
    const rows: string[][] = [
      DIVIDEND_CSV_HEADER,
      ...listFilteredRecords.map((r) => [
        r.broker,
        r.accountId ?? '',
        r.symbol,
        r.currency,
        String(r.amount),
        r.paidDate,
        r.memo ?? '',
        r.tax === null ? '' : String(r.tax),
      ]),
    ];
    const scope = listBroker === 'ALL' ? 'all' : listBroker;
    downloadCsv(`dividends-${scope}-${today()}.csv`, rows);
  }

  function onImportClick() {
    fileInputRef.current?.click();
  }

  // CSV 헤더에서 필요한 컬럼 인덱스를 찾는다 — 컬럼 순서가 바뀐 파일도(예: 사용자가
  // 스프레드시트에서 열 순서를 바꿔 저장한 경우) 헤더 이름만 맞으면 그대로 읽는다.
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
      const iCurrency = colIndex('currency');
      const iAmount = colIndex('amount');
      const iPaidDate = colIndex('paidDate');
      const iMemo = colIndex('memo');
      const iTax = colIndex('tax');

      if ([iBroker, iSymbol, iCurrency, iAmount, iPaidDate].some((i) => i === -1)) {
        setImportResult(`CSV 헤더가 올바르지 않습니다. 다음 컬럼이 필요합니다: ${DIVIDEND_CSV_HEADER.join(', ')}`);
        return;
      }

      let parsedRecords = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim().toLowerCase() as BrokerId,
          accountId: iAccountId !== -1 && (r[iAccountId] ?? '').trim() ? r[iAccountId].trim() : null,
          symbol: (r[iSymbol] ?? '').trim(),
          currency: (r[iCurrency] ?? '').trim() as DividendCurrency,
          amount: Number((r[iAmount] ?? '').trim()),
          paidDate: (r[iPaidDate] ?? '').trim(),
          memo: iMemo !== -1 && (r[iMemo] ?? '').trim() ? r[iMemo] : null,
          tax: iTax !== -1 && (r[iTax] ?? '').trim() ? Number(r[iTax].trim()) : null,
        }));

      // "가져오기 대상" 선택이 전체가 아니면 해당 증권사 행만 골라서 보낸다 —
      // 여러 증권사가 섞인 CSV에서 특정 증권사분만 가져오고 싶을 때 쓴다.
      if (importBroker !== 'ALL') {
        parsedRecords = parsedRecords.filter((r) => r.broker === importBroker);
      }

      if (parsedRecords.length === 0) {
        setImportResult('가져올 행이 없습니다.');
        return;
      }

      const result = await api.importDividends(parsedRecords);
      setImportResult(formatImportResult(result));
      await refresh();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // Google Sheets 연동 — Settings.tsx에서 연결 여부만 확인하고, 실제 내보내기/
  // 가져오기는 여기서 실행한다(CSV 내보내기/가져오기와 같은 대상: 전체 배당
  // 기록, 브로커/계좌 필터 없음 — importBroker 필터는 CSV 전용).
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
    // 내보내기는 시트의 해당 탭 전체를 지우고 로컬 내용으로 다시 쓴다(전체
    // 교체) — 시트에 직접 입력했지만 아직 "가져오기"로 로컬에 반영 안 한 내용이
    // 있으면 그대로 지워진다. 그렇게 사라진 실제 사례가 있어(토스 배당 기록을
    // 시트에 직접 입력했다가 내보내기를 먼저 눌러 유실) 확인창을 넣는다.
    if (!window.confirm('Google Sheets의 Dividends 탭 전체를 로컬 데이터로 덮어씁니다. 시트에 직접 입력했지만 아직 "가져오기"로 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.exportToGoogleSheet('dividends');
      setGoogleSyncResult(`Google Sheets로 ${result.rowCount}건 내보냈습니다.`);
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  async function onImportFromGoogleSheet() {
    // 가져오기도 전체 교체다 — 로컬에서 직접 추가/수정했지만 아직 시트로
    // "내보내기"를 안 한 내용이 있으면 시트 내용으로 덮어써지며 사라진다.
    if (!window.confirm('Google Sheets의 Dividends 탭 내용으로 로컬 데이터 전체를 교체합니다. 시트에 실패하는 행이 하나라도 있으면 아무것도 바꾸지 않습니다. 로컬에서 직접 추가/수정했지만 아직 "내보내기"로 시트에 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.importFromGoogleSheet('dividends');
      setGoogleSyncResult(formatImportResult(result));
      await refresh();
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <ActionMenu label="가져오기·내보내기" align="left">
          <button className="ghost" onClick={onExportCsv} disabled={listFilteredRecords.length === 0}>
            CSV 내보내기 ({listBroker === 'ALL' ? '전체' : BROKER_LABELS[listBroker]})
          </button>
          <div className="menu-sep" />
          <div className="menu-row">
            <label>CSV 가져오기 대상</label>
            <select value={importBroker} onChange={(e) => setImportBroker(e.target.value as BrokerFilter)}>
              <option value="ALL">전체</option>
              {BROKER_ORDER.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
          <button className="ghost" onClick={onImportClick} disabled={importing}>
            {importing ? '가져오는 중...' : 'CSV 가져오기'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onImportFile} />
          <div className="menu-sep" />
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
          </ActionMenu>
          {importResult && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{importResult}</span>
          )}
          {googleSyncResult && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{googleSyncResult}</span>
          )}
        </div>
  );
}
