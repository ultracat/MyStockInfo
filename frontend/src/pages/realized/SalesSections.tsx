import type { RealizedSale } from '../../calc/realizedGains';
import Hint from '../../components/Hint';
import OfficialRealizedCompare from '../../components/OfficialRealizedCompare';
import { formatKrwValue } from '../../format';
import type { AccountLabel, BrokerId } from '../../types';
import { SalesTable } from './SalesTable';

/** 국내 상장(KRW) 일반계좌 매도 — 해외주식 양도소득세(22%) 대상이 아니라 안내와 함께 따로 보여준다. 매도가 없으면 그리지 않는다. */
export function DomesticSalesCard({
  year,
  sales,
  showAccount,
  accountLabels,
}: {
  year: number;
  sales: RealizedSale[];
  showAccount: boolean;
  accountLabels: AccountLabel[];
}) {
  if (sales.length === 0) return null;
  const domesticGainKrw = sales.reduce((sum, s) => sum + s.gainKrw, 0);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>국내 상장 종목 매도 (22% 대상 아님)</h3>
      <Hint>
        위 양도소득세 계산에 포함되지 않습니다. 국내 주식·국내 주식형 ETF(예: 코스피200 추종 ETF)의
        매매차익은 대주주가 아니면 <strong>비과세</strong>이고, 국내 상장 해외·기타 ETF(예: 미국 지수
        추종 ETF, 커버드콜 ETF)의 매매차익은 매도할 때 <strong>배당소득으로 15.4% 원천징수</strong>돼
        이미 과세가 끝납니다(아래 금융소득종합과세 기준에도 합산됨). 종목별 구분은 이 화면이 판단하지
        못하므로 증권사 자료로 확인해주세요.
      </Hint>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">{year}년 국내 상장 종목 실현손익(일반계좌)</div>
          <div className={`value ${domesticGainKrw >= 0 ? 'text-good' : 'text-critical'}`}>
            {domesticGainKrw >= 0 ? '+' : ''}
            {formatKrwValue(domesticGainKrw)}
          </div>
        </div>
      </div>
      <SalesTable rows={sales} showAccount={showAccount} accountLabels={accountLabels} />
    </div>
  );
}

/**
 * 증권사 공식 실현손익 대조 카드 묶음 — KIS(국내 + 해외 매도가 있으면 해외), NH(국내), 키움(국내 + 해외 매도가 있으면 해외).
 * 증권사 필터가 "전체"이거나 그 증권사일 때만. 앱 쪽 값은 세금 유형과 무관한 그 증권사의 그해 매도 전부(`yearSales`).
 */
export function OfficialCompareCards({ year, broker, yearSales }: { year: number; broker: 'ALL' | BrokerId; yearSales: RealizedSale[] }) {
  return (
    <>
      {(broker === 'ALL' || broker === 'kis') && (
        <>
          <OfficialRealizedCompare
            year={year}
            kisSales={yearSales.filter((s) => s.broker === 'kis' && s.currency === 'KRW')}
          />
          {yearSales.some((s) => s.broker === 'kis' && s.currency !== 'KRW') && (
            <OfficialRealizedCompare
              year={year}
              market="overseas"
              kisSales={yearSales.filter((s) => s.broker === 'kis' && s.currency !== 'KRW')}
            />
          )}
        </>
      )}

      {(broker === 'ALL' || broker === 'nh') && (
        <OfficialRealizedCompare
          year={year}
          broker="nh"
          kisSales={yearSales.filter((s) => s.broker === 'nh' && s.currency === 'KRW')}
        />
      )}

      {(broker === 'ALL' || broker === 'kiwoom') && (
        <>
          <OfficialRealizedCompare
            year={year}
            broker="kiwoom"
            kisSales={yearSales.filter((s) => s.broker === 'kiwoom' && s.currency === 'KRW')}
          />
          {yearSales.some((s) => s.broker === 'kiwoom' && s.currency !== 'KRW') && (
            <OfficialRealizedCompare
              year={year}
              broker="kiwoom"
              market="overseas"
              kisSales={yearSales.filter((s) => s.broker === 'kiwoom' && s.currency !== 'KRW')}
            />
          )}
        </>
      )}
    </>
  );
}

/** ISA/연금저축/IRP 계좌 매도 — 위 합계·추정 세액·배당소득에 넣지 않고 따로 보여준다. 매도가 없으면 그리지 않는다. */
export function TaxAdvantagedSalesCard({
  sales,
  showAccount,
  accountLabels,
}: {
  sales: RealizedSale[];
  showAccount: boolean;
  accountLabels: AccountLabel[];
}) {
  if (sales.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>세제혜택 계좌 매도 내역(ISA/연금저축/IRP)</h3>
      <Hint>
        위 실현손익 합계·추정 세액·배당소득에는 포함되지 않습니다 — 이 계좌들은 각자 다른 과세
        체계(ISA는 손익통산 후 비과세 한도 초과분만 9.9% 분리과세, 연금저축/IRP는 매도
        시점엔 과세되지 않고 나중에 연금·퇴직소득으로 인출할 때 과세)가 적용됩니다.
      </Hint>
      <SalesTable rows={sales} showAccount={showAccount} accountLabels={accountLabels} />
    </div>
  );
}
