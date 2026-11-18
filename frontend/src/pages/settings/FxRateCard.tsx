import { useEffect, useState } from 'react';
import { api } from '../../api';
import { errorText, type Notify } from './notify';
import Hint from '../../components/Hint';

/** "USD/KRW 환율" 카드 — 수동 환율(있으면 실시간보다 우선, fx.ts의 effectiveRate). */
export function FxRateCard({ notify }: { notify: Notify }) {
  const [fxRate, setFxRate] = useState('');

  useEffect(() => {
    api
      .getFxRate()
      .then((fx) => setFxRate(fx.usdKrwRate ? String(fx.usdKrwRate) : ''))
      .catch((e) => notify.fail(errorText(e)));
    // 처음 열 때 한 번 — notify는 매 렌더 새로 만들어지지만 같은 일을 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave() {
    notify.clear();
    const rate = fxRate ? Number(fxRate) : null;
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
      notify.fail('환율은 양수여야 합니다.');
      return;
    }
    try {
      await api.setFxRate(rate);
      notify.ok('환율이 저장되었습니다.');
    } catch (e) {
      notify.fail(errorText(e));
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>USD/KRW 환율</h3>
      <Hint>
        해외 종목 비중(%) 계산에 사용됩니다. 기본적으로 토스증권 Open API(GET /api/v1/exchange-rate)에서
        실시간으로 조회하고, 실패하면(가끔씩 일시 오류가 날 수 있음) 한국수출입은행 환율 API로
        자동 대체됩니다(위 인증키를 넣었을 때). 아래에 값을 입력하면 실시간 조회 대신 이 값을 우선 사용합니다 — 특정
        환율로 고정하고 싶을 때만 입력하고, 평소엔 비워두세요. (한국투자증권 국내주식 잔고는 전부
        원화라 이 설정이 필요 없습니다.)
      </Hint>
      <div className="form-row">
        <label>1 USD = ? KRW (선택 — 비워두면 실시간 조회)</label>
        <input type="number" min="0" step="0.01" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
      </div>
      <button className="primary" onClick={onSave}>
        저장
      </button>
    </div>
  );
}
