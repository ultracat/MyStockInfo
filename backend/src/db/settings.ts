import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

interface AppSettings {
  /** Manually entered USD/KRW rate, used to blend USD holdings into KRW-based
   *  portfolio weights. Toss's Open API docs mention an FX endpoint under
   *  "Market Info" but don't publish its path/schema, so we don't guess it —
   *  this is a manual stand-in until that's verified. */
  usdKrwRate: number | null;
}

function store() {
  return new JsonStore<AppSettings>('settings.json', getDataDir(), { usdKrwRate: null });
}

export function getSettings(): AppSettings {
  return store().read();
}

export function setUsdKrwRate(rate: number | null): AppSettings {
  return store().update((current) => ({ ...current, usdKrwRate: rate }));
}
