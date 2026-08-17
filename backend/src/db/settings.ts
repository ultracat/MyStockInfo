import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

interface AppSettings {
  /** Manually entered USD/KRW rate, used to blend USD holdings into KRW-based
   *  portfolio weights. Toss's Open API docs mention an FX endpoint under
   *  "Market Info" but don't publish its path/schema, so we don't guess it —
   *  this is a manual stand-in until that's verified. */
  usdKrwRate: number | null;
  /** 한국수출입은행 Open API(exchangeJSON) 인증키 — 토스 환율 조회가 실패했을 때의
   *  대체 소스(exchangeRateResolver.ts). 계좌/거래를 다루는 브로커 자격증명이
   *  아니라 공개 일별 환율 조회 전용 키라(계정 접근·거래 권한이 없음) 브로커
   *  자격증명처럼 credentials.ts의 safeStorage 암호화 저장을 쓰지 않고, 기존
   *  usdKrwRate와 같은 평문 설정으로 둔다 — 유출돼도 실질적 피해가 없는
   *  수준이라 암호화 인프라를 새로 얹을 실익이 적다고 판단. */
  eximbankAuthKey: string | null;
}

function store() {
  return new JsonStore<AppSettings>('settings.json', getDataDir(), { usdKrwRate: null, eximbankAuthKey: null });
}

export function getSettings(): AppSettings {
  const settings = store().read();
  // eximbankAuthKey 필드가 생기기 전에 저장된 settings.json엔 이 키 자체가 없어
  // undefined가 되는데, holdings의 memo/dividends의 accountId와 같은 이유로
  // 여기서 null로 정규화한다.
  return { ...settings, eximbankAuthKey: settings.eximbankAuthKey ?? null };
}

export function setUsdKrwRate(rate: number | null): AppSettings {
  return store().update((current) => ({ ...current, usdKrwRate: rate }));
}

export function setEximbankAuthKey(key: string | null): AppSettings {
  return store().update((current) => ({ ...current, eximbankAuthKey: key }));
}
