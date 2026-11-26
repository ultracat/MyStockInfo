import { useCallback, useMemo, useState } from 'react';
import { YearEndTaxCard } from './realized/YearEndTaxCard';
import { TaxAccountLimitsCard } from './realized/TaxAccountLimitsCard';
import { OverseasGainsCard } from './realized/OverseasGainsCard';
import { DomesticSalesCard, OfficialCompareCards, TaxAdvantagedSalesCard } from './realized/SalesSections';
import { DividendIncomeCard } from './realized/DividendIncomeCard';
import { useRealizedGainsData } from './realized/useRealizedGainsData';
import type { AccountTaxType, BrokerId, DividendRecord } from '../types';
import { accountLabelKey } from '../accountLabels';
import { currentYear, localToday } from '../format';
import {
  computeRealizedSales,
  dividendIncomeSummary,
  generalGrossDividendKrwForYear,
  isaRealizedSales,
  overseasGeneralGainForYear,
} from '../calc/realizedGains';
import Hint from '../components/Hint';
import SectionNav from '../components/SectionNav';

/**
 * 매도 건별 실현손익 — 이동평균법(원가를 종목별로 누적하다 매도마다 평균단가 ×
 * 매도수량만큼 덜어냄)으로 계산한다. 과거 Overview.tsx에 있다가(지금은 수량만
 * 재구성하는 방식으로 바뀜) 지워진 "BUY는 원가에 더하고 SELL은 그 시점
 * 평균단가만큼 뺀다" 로직을 되살려, 이번엔 원가(KRW 환산 누적)까지 추적하고
 * 매도마다 실현손익을 기록으로 남긴다.
 *
 * **환율은 월평균을 쓴다**(일자별 정확한 환율이 아님) — 이 프로젝트가 배당금
 * 환산에 이미 월평균 환율을 공식 채택해둔 것과 같은 결정(`backend/CLAUDE.md`의
 * "배당금 월평균 환율" 절 참고). 정확한 세법은 거래 당일 환율을 요구하지만,
 * 이 화면은 "참고용 추정치"이지 공식 세무 자료가 아니므로 기존 결정과
 * 일관되게 월평균을 그대로 재사용한다.
 *
 * **ISA/연금저축/IRP 계좌는 일반 양도소득세(22%) 계산에서 제외한다** — 이
 * 계좌들은 매도차익에 완전히 다른 과세 체계(ISA는 손익통산+비과세 한도 후
 * 9.9% 분리과세, 연금저축/IRP는 매도 시점엔 과세이연되고 나중에 연금/퇴직
 * 소득으로 인출할 때 별도 세율)가 적용돼서, 이 둘을 섞어 22%를 적용하면
 * 완전히 틀린 숫자가 나온다. 계좌별 분류는 `account-tax-types.json`
 * (`backend/CLAUDE.md`의 "계좌별 세금 유형" 절 참고)에 저장하고 기본값은
 * GENERAL(일반계좌)이다.
 *
 * **22% 계산은 해외 상장 종목(통화가 KRW가 아닌 거래)만 대상이다** — 국내 상장
 * 종목은 해외주식 양도소득세 대상이 아니다: 국내 주식·국내 주식형 ETF 매매차익은
 * (대주주가 아니면) 비과세이고, 국내 상장 해외·기타 ETF 매매차익은 매도 시
 * 배당소득으로 15.4% 원천징수돼 이미 끝난다. 예전엔 통화 구분 없이 일반계좌
 * 매도를 전부 합산해 22%를 매겨서, 국내 ETF 차익에 세금을 이중으로 잡거나 국내
 * 손실로 해외 이익을 상계하는 틀린 숫자가 나왔다. 국내 상장분은 종목 정보만으로
 * 비과세/배당소득과세를 정확히 가를 수 없어 별도 카드에 안내와 함께만 보여준다.
 *
 * **배당금은 양도소득과 다른 소득(배당소득)이라 22% 계산에 넣지 않는다**(서로
 * 손익통산 불가, 250만원 공제도 없음) — 대신 "배당소득" 카드에 연간 합계와
 * 금융소득종합과세 기준(연 2,000만원) 대비 비율을 따로 보여준다.
 */
export default function RealizedGains() {
  // 받기(매매·배당·별칭·세금 유형·보유·planner·환율)는 realized/useRealizedGainsData.ts.
  const { allTrades, loading, error, effectiveFxRate, monthlyRateFor, allDividends, accountLabels, taxTypes, holdings, plannerState } =
    useRealizedGainsData();

  // 올해 — 모듈 상수로 두면 앱을 켜 둔 채 해가 바뀌어도 옛 연도로 남아서 렌더마다 계산한다(2026-11-26).
  const thisYear = currentYear();
  const [year, setYear] = useState(thisYear);
  const [broker, setBroker] = useState<'ALL' | BrokerId>('ALL');

  const taxTypeByAccount = useMemo(() => {
    const m = new Map<string, AccountTaxType>();
    for (const t of taxTypes) m.set(accountLabelKey(t.broker, t.accountId), t.taxType);
    return m;
  }, [taxTypes]);

  const taxTypeFor = useCallback(
    (b: BrokerId, accountId: string): AccountTaxType => taxTypeByAccount.get(accountLabelKey(b, accountId)) ?? 'GENERAL',
    [taxTypeByAccount]
  );

  // 이동평균법 실현손익 — calc/realizedGains.ts(순수 함수, frontend/test/realizedGains.test.ts).
  const { sales, excludedSymbols } = useMemo(() => computeRealizedSales(allTrades, monthlyRateFor), [allTrades, monthlyRateFor]);

  const yearSales = useMemo(
    () => sales.filter((s) => s.date.slice(0, 4) === String(year) && (broker === 'ALL' || s.broker === broker)),
    [sales, year, broker]
  );
  const generalSales = useMemo(
    () => yearSales.filter((s) => taxTypeFor(s.broker, s.accountId) === 'GENERAL'),
    [yearSales, taxTypeFor]
  );
  const taxAdvantagedSales = useMemo(
    () => yearSales.filter((s) => taxTypeFor(s.broker, s.accountId) !== 'GENERAL'),
    [yearSales, taxTypeFor]
  );

  const overseasSales = useMemo(() => generalSales.filter((s) => s.currency !== 'KRW'), [generalSales]);
  const domesticSales = useMemo(() => generalSales.filter((s) => s.currency === 'KRW'), [generalSales]);

  // 배당 기록의 accountId는 사용자가 직접 적는 자유 문자열이라, 토스처럼 내부
  // accountId("1")와 화면 표시 계좌번호가 다른 계좌는 표시 번호로 적혀 있을 수
  // 있다 — 세금 유형(내부 accountId 기준)을 찾기 전에 표시 번호를 되돌린다.
  const dividendAccountOf = useCallback(
    (d: DividendRecord): string | null => {
      if (!d.accountId) return null;
      const byNumber = accountLabels.find((l) => l.broker === d.broker && l.accountNumber === d.accountId);
      return byNumber ? byNumber.accountId : d.accountId;
    },
    [accountLabels]
  );
  const dividendTaxType = useCallback(
    (d: DividendRecord): AccountTaxType => {
      const accountId = dividendAccountOf(d);
      return accountId ? taxTypeFor(d.broker, accountId) : 'GENERAL';
    },
    [dividendAccountOf, taxTypeFor]
  );

  // 배당소득 카드·연말 절세·ISA 한도의 합계는 calc/realizedGains.ts(순수 함수, frontend/test/realizedGains.test.ts).
  const dividendSummary = useMemo(
    () => dividendIncomeSummary(allDividends, { year, broker, taxTypeOf: dividendTaxType, rateFor: monthlyRateFor }),
    [allDividends, year, broker, dividendTaxType, monthlyRateFor]
  );

  const isGeneralAccount = useCallback((b: string, accountId: string) => taxTypeFor(b as BrokerId, accountId) === 'GENERAL', [taxTypeFor]);
  // 연말 절세 도우미 — 고른 연도·증권사와 상관없이 **올해** 전체(일반 계좌) 기준.
  const thisYearOverseasGainKrw = useMemo(
    () => overseasGeneralGainForYear(sales, thisYear, isGeneralAccount),
    [sales, thisYear, isGeneralAccount]
  );
  const thisYearDividendKrw = useMemo(
    () => generalGrossDividendKrwForYear(allDividends, thisYear, dividendTaxType, monthlyRateFor),
    [allDividends, thisYear, dividendTaxType, monthlyRateFor]
  );
  // ISA 한도용 매매손익 — 계좌마다 따로 이동평균(calc/realizedGains.ts isaRealizedSales).
  const isaSales = useMemo(() => isaRealizedSales(taxTypes, allTrades, monthlyRateFor), [taxTypes, allTrades, monthlyRateFor]);

  // 특정 증권사를 골랐으면 모든 행이 같은 값이라 증권사/계좌 컬럼 자체가
  // 불필요하다 — Trades.tsx의 "전체" 모드에서만 증권사/계좌 컬럼을 보여주는
  // 기존 패턴과 동일. 계좌정보 + 종목명 때문에 나머지(수량/금액/손익) 숫자를
  // 보려고 매번 가로 스크롤해야 한다는 피드백으로 추가했다.
  const isAllMode = broker === 'ALL';

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>;

  return (
    <div>
      <h2 className="page-title">실현손익</h2>
      {error && <p className="text-critical">{error}</p>}

      <Hint card>
        매도 거래를 이동평균법으로 계산한 <strong>참고용 추정치</strong>입니다 — 환율은 거래
        당일이 아니라 <strong>그 달의 평균 환율</strong>을 쓰고, 로컬에 매수 기록이 없는
        매도분은 원가를 알 수 없어 그만큼 제외됩니다. 실제 세금 신고는 증권사가 발급하는
        공식 자료나 세무 전문가를 통해 꼭 확인해주세요.
      </Hint>

      {excludedSymbols.length > 0 && (
        <p className="card text-critical" style={{ fontSize: 13 }}>
          환율 정보를 구하지 못해 계산에서 제외된 종목: {excludedSymbols.join(', ')} — 설정에서
          수동 환율을 입력하면 다시 계산됩니다.
        </p>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        계좌별 세금 유형(ISA/연금저축/IRP)은 설정 화면의 "계좌 별칭 · 세금 유형"에서
        지정합니다.
      </p>

      <SectionNav
        items={[
          { id: 'rg-yearend', label: '연말 절세' },
          { id: 'rg-overseas', label: '해외 양도소득' },
          { id: 'rg-domestic', label: '국내 매도' },
          { id: 'rg-dividend', label: '배당소득' },
          { id: 'rg-limits', label: 'ISA·연금 한도' },
        ]}
      />

      {/* 연말 절세 도우미는 이 화면에서 가장 "할 일"로 이어지는 카드라 맨 위로(예전엔 맨 아래 근처였다, 2026-11-18 UX 점검) */}
      <div id="rg-yearend" className="section-anchor" />
      <YearEndTaxCard
        realizedOverseasKrw={thisYearOverseasGainKrw}
        holdings={holdings}
        isGeneral={isGeneralAccount}
        usdRate={effectiveFxRate}
        dividendIncomeKrw={thisYearDividendKrw}
        year={thisYear}
      />

      <div id="rg-overseas" className="section-anchor" />
      <OverseasGainsCard
        year={year}
        onYearChange={setYear}
        thisYear={thisYear}
        broker={broker}
        onBrokerChange={setBroker}
        sales={overseasSales}
        showAccount={isAllMode}
        accountLabels={accountLabels}
      />

      <div id="rg-domestic" className="section-anchor" />
      <DomesticSalesCard year={year} sales={domesticSales} showAccount={isAllMode} accountLabels={accountLabels} />

      <OfficialCompareCards year={year} broker={broker} yearSales={yearSales} />

      <div id="rg-dividend" className="section-anchor" />
      <DividendIncomeCard year={year} summary={dividendSummary} />

      <div id="rg-limits" className="section-anchor" />
      <TaxAccountLimitsCard
        accounts={taxTypes}
        planner={plannerState.planner}
        onUpdate={plannerState.update}
        sales={isaSales}
        dividends={allDividends}
        holdings={holdings}
        dividendAccountOf={dividendAccountOf}
        rateFor={monthlyRateFor}
        accountLabels={accountLabels}
        year={String(year)}
        currentMonth={localToday().slice(0, 7)}
      />

      <TaxAdvantagedSalesCard sales={taxAdvantagedSales} showAccount={isAllMode} accountLabels={accountLabels} />
    </div>
  );
}
