import { Fragment, useMemo, type ReactNode } from 'react';
import { ALL_ACCOUNTS, dividendTotals as dividendTotalsOf, holdingRows } from '../calc/portfolio';
import type { BrokerId } from '../types';
import HoldingsTable from '../components/HoldingsTable';
import PurchaseMarketTile from '../components/PurchaseMarketTile';
import PrincipalCard from '../components/PrincipalCard';
import { krw } from '../format';
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import { useStockLinkResolver } from '../components/StockNameLink';
import { anyMarketOpen, describeMarket, useStockWarnings } from '../marketInsights';
import { AmountTile, RateTile } from './holdings/StatTiles';
import { HoldingsTransferButtons, useHoldingsTransfer } from './holdings/HoldingsTransfer';
import { useHoldings } from './holdings/useHoldings';

// 보유 종목 화면 — 2026-11-17 나눴다: 데이터는 holdings/useHoldings.ts, CSV·Google Sheets는 holdings/HoldingsTransfer.tsx,
// 타일은 holdings/StatTiles.tsx, 표 행 계산(비중·배당 포함 손익)은 calc/portfolio.ts의 holdingRows. 여기엔 선택칸·안내·타일 배치만.
export default function Dashboard() {
  const h = useHoldings();
  const {
    loading,
    error,
    brokers,
    configuredBrokers,
    selectedBroker,
    setSelectedBroker,
    accounts,
    accountId,
    setAccountId,
    userPickedAccountRef,
    portfolio,
    manualFxRate,
    effectiveFxRate,
    accountLabels,
    dividends,
    marketStatus,
    isCurrentBrokerApi,
    isKbSyncable,
    kbSyncing,
    kbSyncNotice,
    triggerKbSync,
    refreshing,
    refreshNotice,
    handleRefresh,
  } = h;
  const transfer = useHoldingsTransfer(h.refreshAfterStoreImport);
  const { importResult, googleSyncResult } = transfer;
  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();

  // 개별 타일의 금액(예: 손익금액이 우연히 0)이 아니라 포트폴리오가 실제로 달러
  // 투자금을 갖고 있는지로 판단 — AmountTile/RateTile 문서 주석 참고.
  const hasUsdHoldings = !!portfolio?.totalPurchaseAmountUsd;
  // 예수금은 보유종목과 통화 보유 여부가 다를 수 있어(예: 원화만 보유 중인데
  // 예수금엔 소액 달러가 남아있는 경우) 별도로 판단한다.
  const hasUsdCash = !!portfolio?.cashBalanceUsd;

  // 보유 종목의 매수 유의사항(토스) — 종목 목록이 바뀔 때만 다시 묻는다.
  const warningsBySymbol = useStockWarnings(portfolio?.positions.map((p) => p.symbol) ?? []);

  const rows = useMemo(() => {
    if (!portfolio) return [];
    const base = holdingRows(portfolio, {
      broker: selectedBroker,
      selectedAccountId: accountId,
      soleAccountId: accounts.length === 1 ? accounts[0].id : null,
      dividends,
      accountLabels,
      fxRate: effectiveFxRate,
    });
    return base.map((r) => ({ ...r, externalUrl: stockLinkFor(r.symbol, r.currency) ?? undefined, warnings: warningsBySymbol[r.symbol] }));
  }, [portfolio, effectiveFxRate, accountLabels, selectedBroker, stockLinkFor, dividends, accounts, accountId, warningsBySymbol]);

  // "총 손익금액(배당 포함)" 카드 — 표의 "배당 포함 손익금액" 열과 같은 값(rows의
  // dividendAmount, 포지션 통화 기준)을 통화별로 더한다. 카드와 표 합계가 어긋나지
  // 않도록 배당을 따로 다시 집계하지 않는다.
  const dividendTotals = useMemo(() => dividendTotalsOf(rows), [rows]);

  const hasUnconvertedUsd = portfolio?.positions.some((p) => p.currency === 'USD') && !effectiveFxRate;

  // 브로커/계좌를 아직 하나도 못 골랐을 때만(최초 로딩) 전체 화면을 스피너로
  // 막는다 — CSV 전용 브로커는 저장된 데이터가 없어도 헤더의 CSV 가져오기
  // 버튼까지 같이 사라지면 안 되므로, `!portfolio`로는 더 이상 막지 않는다
  // (예전엔 `if (!portfolio) return null`이라 빈 화면이 됐음).
  if (loading && brokers.length === 0) return <p>불러오는 중...</p>;
  if (error)
    return (
      <p className="notice text-critical" style={{ whiteSpace: 'pre-wrap' }}>
        {error}
      </p>
    );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">보유 종목</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <HoldingsTransferButtons t={transfer} />
          {isCurrentBrokerApi && (marketStatus.kr || marketStatus.us) && (
            <span
              style={{ fontSize: 12, color: 'var(--text-muted)' }}
              title={anyMarketOpen(marketStatus) ? '1분마다 자동 새로고침합니다' : '장이 모두 닫혀 있어 자동 새로고침을 쉽니다'}
            >
              {[describeMarket('국내', marketStatus.kr), describeMarket('미국', marketStatus.us)].filter(Boolean).join(' · ')}
            </span>
          )}
          {isCurrentBrokerApi && (
            <button className="ghost" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? '새로고침 중...' : '새로고침'}
            </button>
          )}
          {isKbSyncable && (
            <button className="ghost" onClick={triggerKbSync} disabled={kbSyncing}>
              {kbSyncing ? '동기화 중...' : '새로고침'}
            </button>
          )}
        </div>
      </div>

      {refreshNotice && (
        <div className="notice" style={{ fontSize: 13 }}>
          {refreshNotice}
        </div>
      )}
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
      {kbSyncing && (
        <div className="notice" style={{ fontSize: 13 }}>
          KB증권 최신 데이터를 백그라운드에서 가져오는 중...
        </div>
      )}
      {kbSyncNotice && (
        <div className="notice text-critical" style={{ fontSize: 13 }}>
          {kbSyncNotice}
        </div>
      )}

      {configuredBrokers.length > 1 && (
        <div className="form-row">
          <label>증권사</label>
          <select
            value={selectedBroker ?? ''}
            onChange={(e) => {
              // Reset accountId in the same commit as selectedBroker, not in
              // effect2's async body: otherwise there's a render where
              // selectedBroker is already the new broker but accountId still
              // holds the old broker's id (effect2 hasn't reset it yet), and
              // effect3 (deps [selectedBroker, accountId]) fires with that
              // mismatched pair — e.g. calling Toss's /api/v1/holdings with a
              // KIS account id as the accountSeq, which Toss correctly
              // rejects as account-not-found. The request then gets cancelled
              // before its (harmless but confusing) error reaches the UI, so
              // it only shows up as a backend log line.
              setSelectedBroker(e.target.value as BrokerId);
              setAccountId(null);
            }}
          >
            {configuredBrokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {accounts.length > 1 && (
        <div className="form-row">
          <label>계좌</label>
          <select
            value={accountId ?? ''}
            onChange={(e) => {
              userPickedAccountRef.current = true;
              setAccountId(e.target.value);
            }}
          >
            <option value={ALL_ACCOUNTS}>
              {accounts.some((a) => a.paper) ? '전체 계좌 (모의투자 제외)' : '전체 계좌'}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {formatAccountOption(
                  a,
                  selectedBroker
                    ? findAccountLabel(accountLabels, selectedBroker, a.id)
                    : undefined
                )}
              </option>
            ))}
          </select>
        </div>
      )}

      {accounts.find((a) => a.id === accountId)?.paper && (
        <div className="notice">
          모의투자 계좌입니다 — 가상 자산이라 대시보드·종목별 수익·배당·실현손익 합계와 순자산 기록에는 넣지 않고, 이
          화면과 매매내역에서만 보여줍니다.
        </div>
      )}

      {!portfolio && !loading && (
        <div className="notice">
          {isCurrentBrokerApi
            ? '표시할 데이터가 없습니다.'
            : '저장된 데이터가 없습니다 — 위의 "CSV 가져오기"로 보유종목을 등록해주세요.'}
        </div>
      )}

      {portfolio && (
        <>
          {hasUnconvertedUsd && (
            <div className="notice">
              USD 종목이 있지만 환율을 가져오지 못해 비중(%) 계산에서 제외됩니다. 설정 화면에서 USD/KRW 환율을
              직접 입력하시거나, 토스증권 연동 상태를 확인해주세요.
            </div>
          )}

          <div className="summary-row">
            {isCurrentBrokerApi ? (
              <AmountTile
                label="예수금"
                krwAmount={portfolio.cashBalanceKrw}
                usdAmount={portfolio.cashBalanceUsd}
                hasUsd={hasUsdCash}
                fxRate={effectiveFxRate}
              />
            ) : (
              // KB/삼성/미래에셋(CSV·Google Sheets로 관리하는 브로커)은 예수금을 알
              // 방법이 없다(KB는 SWQM2302 TR 권한 미부여, 삼성/미래에셋은 API 자체가
              // 없음, backend/CLAUDE.md의 "계좌별 예수금" 절 참고) — 값을 추정하거나
              // 수동 입력을 받는 대신 "미지원"으로 고정 표시한다.
              <div className="stat-tile">
                <div className="label">예수금</div>
                <div className="value" style={{ color: 'var(--text-muted)' }}>
                  미지원
                </div>
              </div>
            )}
            <PurchaseMarketTile
              purchase={{ krw: portfolio.totalPurchaseAmountKrw, usd: portfolio.totalPurchaseAmountUsd }}
              market={{ krw: portfolio.totalMarketValueKrw, usd: portfolio.totalMarketValueUsd }}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
            />
            <AmountTile
              label="총 손익금액 (배당 제외)"
              krwAmount={portfolio.totalProfitLossKrw}
              usdAmount={portfolio.totalProfitLossUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              signed
            />
            <AmountTile
              label="총 손익금액 (배당 포함)"
              krwAmount={portfolio.totalProfitLossKrw + dividendTotals.krw}
              usdAmount={(portfolio.totalProfitLossUsd ?? 0) + dividendTotals.usd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              signed
              note={dividendTotals.unconverted ? '일부 배당은 환율이 없어 빠짐' : undefined}
            />
            <RateTile
              label="손익률"
              krwPl={portfolio.totalProfitLossKrw}
              krwInvested={portfolio.totalPurchaseAmountKrw}
              usdPl={portfolio.totalProfitLossUsd}
              usdInvested={portfolio.totalPurchaseAmountUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              fallbackRate={portfolio.profitLossRate}
            />
          </div>

          {/* 환율·예수금 안내는 상자 두 개 대신 타일 아래 한 줄로(2026-11-18 UX 점검 — 안내 상자가 숫자보다 먼저 자리를 차지했다) */}
          {(() => {
            // 환율 줄과 토스 예수금 안내 — 있는 것만 " · "로 잇는다(예전엔 토스 안내만 있을 때 앞에 " · "가 붙었다, 2026-11-18)
            const parts: ReactNode[] = [];
            if (!hasUnconvertedUsd && effectiveFxRate && portfolio.positions.some((p) => p.currency === 'USD'))
              parts.push(
                <span key="fx">
                  적용 환율 1 USD = {krw.format(Math.round(effectiveFxRate))}원{manualFxRate ? '(설정에서 직접 입력)' : '(실시간 조회)'}
                </span>
              );
            if (isCurrentBrokerApi && selectedBroker === 'toss' && portfolio.cashBalanceKrw !== null)
              parts.push(
                <span key="cash" title="토스증권 예수금은 매수 가능 금액(미수 미발생 기준) API 값이라, 매도 후 정산 전 금액이 있으면 실제 예수금과 조금 다를 수 있습니다.">
                  토스증권 예수금은 "매수 가능 금액" 기준 ⓘ
                </span>
              );
            if (parts.length === 0) return null;
            return (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '-8px 0 16px' }}>
                {parts.map((p, i) => (
                  <Fragment key={i}>
                    {i > 0 && ' · '}
                    {p}
                  </Fragment>
                ))}
              </p>
            );
          })()}

          {/* 입금 기준 원금 — 입출금 내역 API가 있는 토스·NH·키움만(한투·KB는 없음). 모의투자 계좌는 원금 개념이 없어 뺀다. */}
          {isCurrentBrokerApi &&
            (selectedBroker === 'toss' || selectedBroker === 'nh' || selectedBroker === 'kiwoom') &&
            accountId &&
            !accounts.find((a) => a.id === accountId)?.paper && (
            <PrincipalCard
              key={selectedBroker}
              broker={selectedBroker}
              portfolio={portfolio}
              accountSeqs={accountId === ALL_ACCOUNTS ? accounts.filter((a) => !a.paper).map((a) => a.id) : [accountId]}
              fxRate={effectiveFxRate}
            />
          )}

          <div className="card">
            <HoldingsTable rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
