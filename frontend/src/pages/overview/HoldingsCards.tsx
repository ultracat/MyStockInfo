import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import DonutChart from '../../components/DonutChart';
import DonutDetailModal from '../../components/DonutDetailModal';
import { formatKrwValue } from '../../format';
import type { useWhenActive } from '../../pageActivity';
import type { AccountLabel } from '../../types';
import {
  holdingAccountRows,
  holdingDetailRows,
  holdingSlices,
  sectorEtfCounts,
  sectorSlices,
  type FlatHolding,
  type SectorWeights,
  type ToKrw,
} from '../../calc/overview';
import Hint from '../../components/Hint';

/** 대시보드 "전체 계좌 보유종목 비중"·"섹터 비중" 카드 + 보유종목 상세 팝업(종목별/계좌별). */
export function HoldingsCards({
  holdings,
  accountLabels,
  totalMarketKrw,
  toKrw,
  whenActive,
}: {
  holdings: FlatHolding[];
  accountLabels: AccountLabel[];
  totalMarketKrw: number;
  toKrw: ToKrw;
  whenActive: ReturnType<typeof useWhenActive>;
}) {
  const slices = useMemo(() => holdingSlices(holdings, toKrw), [holdings, toKrw]);
  // 도넛은 상위 5종목 + "기타"로 접지만, 가운데 숫자를 누르면 보유 중인 전 종목을 수량까지 보여준다.
  const [showDetail, setShowDetail] = useState(false);
  const detailRows = useMemo(() => holdingDetailRows(holdings, toKrw), [holdings, toKrw]);
  const accountRows = useMemo(() => holdingAccountRows(holdings, accountLabels, toKrw), [holdings, accountLabels, toKrw]);

  // ---- 1-2) 섹터 비중(토스 섹터 분류) ----
  // 종목 → 토스 대분류 섹터는 백엔드가 하루 한 번 만들어 둔다(첫 호출은 수십 초 — 화면을 막지 않고 따로 받는다).
  // 백엔드가 종목마다 섹터 배분(weights, 합 1)을 준다: 보통주는 토스 섹터(여러 섹터면 균등), 우선주는 보통주 섹터,
  // 국내 ETF는 한투 구성종목(상위 30)으로 쪼개고, 그게 안 되면 토스 ETF 섹터 분류. 못 나눈 몫은 "분류 안 됨".
  const [sectorWeights, setSectorWeights] = useState<SectorWeights | null>(null);
  const [sectorSources, setSectorSources] = useState<Record<string, string>>({});
  const [sectorEtfPending, setSectorEtfPending] = useState(false);
  const holdingSymbolsKey = [...new Set(holdings.map((h) => h.symbol))].sort().join(',');
  useEffect(() => {
    if (!holdingSymbolsKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSectorWeights(null);
    // 토스 ETF 분류표는 백엔드가 백그라운드로 만든다(첫 생성 약 2분) — 만드는 중이면 30초마다 최대 6번 다시 받는다.
    const load = (attempt: number) =>
      api
        .getSectors(holdingSymbolsKey.split(','))
        .then((r) => {
          if (cancelled) return;
          setSectorWeights(r.date ? (r.weights ?? {}) : {});
          setSectorSources(r.sources ?? {});
          setSectorEtfPending(!!r.etfPending && attempt < 6);
          if (r.etfPending && attempt < 6)
            timer = setTimeout(() => whenActive('sectors', () => !cancelled && void load(attempt + 1)), 30_000); // 숨겨진 동안은 미룸
        })
        .catch(() => {
          if (cancelled) return;
          setSectorWeights((prev) => prev ?? {});
          setSectorEtfPending(false);
        });
    void load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingSymbolsKey]);

  const sectors = useMemo(() => (sectorWeights ? sectorSlices(holdings, sectorWeights, toKrw) : []), [holdings, sectorWeights, toKrw]);
  const etfCounts = useMemo(() => sectorEtfCounts(holdings, sectorSources), [holdings, sectorSources]);

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>전체 계좌 보유종목 비중</h3>
        <DonutChart
          slices={slices}
          centerLabel="총 평가금액"
          centerValue={formatKrwValue(totalMarketKrw)}
          formatValue={formatKrwValue}
          onCenterClick={() => setShowDetail(true)}
        />
      </div>

      {sectorWeights === null && holdings.length > 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>섹터 비중</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            토스증권 섹터 분류를 불러오는 중입니다(하루에 한 번, 처음엔 수십 초 걸립니다).
          </p>
        </div>
      ) : (
        sectors.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>섹터 비중</h3>
            <Hint>
              토스증권 섹터 분류(대분류) 기준입니다. 여러 섹터에 속한 종목은 평가금액을 똑같이 나누고, 우선주는 보통주의
              섹터를 따릅니다. <strong>ETF</strong>는 국내 ETF면 한국투자증권 구성종목(비중 상위 30개)대로 쪼개고
              {etfCounts.components > 0 && ` (${etfCounts.components}개)`}, 안 되면 토스가 분류한 섹터에
              넣습니다{etfCounts.sector > 0 && ` (${etfCounts.sector}개)`}. 상위 30개 밖 비중, 채권·현금, 분류가 없는
              ETF(미국 지수·커버드콜 등)는 "분류 안 됨"입니다.
              {sectorEtfPending && ' 토스 ETF 섹터 분류를 받는 중이라(하루 한 번, 약 2분) 끝나면 자동으로 다시 그립니다.'}
            </Hint>
            <DonutChart
              slices={sectors}
              centerLabel="총 평가금액"
              centerValue={formatKrwValue(totalMarketKrw)}
              formatValue={formatKrwValue}
            />
          </div>
        )
      )}

      {showDetail && (
        <DonutDetailModal
          title="전체 계좌 보유종목 상세"
          totalValueKrw={totalMarketKrw}
          views={[
            {
              id: 'symbol',
              label: '종목별',
              countLabel: (n) => `${n}개 종목`,
              rows: detailRows.map((r) => ({
                symbol: r.symbol,
                name: r.name,
                valueKrw: r.valueKrw,
                meta: `${r.quantity}주`,
              })),
            },
            {
              id: 'account',
              label: '계좌별',
              countLabel: (n) => `${n}개 계좌`,
              rows: accountRows.map((r) => ({
                symbol: r.key,
                name: r.label,
                label: r.label,
                sub: r.sub,
                valueKrw: r.valueKrw,
                meta: r.meta,
                details: r.details,
              })),
            },
          ]}
          formatValue={formatKrwValue}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}
