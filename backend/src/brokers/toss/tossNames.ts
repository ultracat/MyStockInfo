// 토스증권 종목 표시 이름 규칙.
/**
 * Toss's own `name` falls back to the bare ticker (e.g. `"SPY"`, `"NVDY"`)
 * for securities with no registered Korean short name — confirmed against
 * the live API for several US ETFs (checked 2026-08-14): `name` and
 * `symbol` were identical, while `englishName` had the real name (e.g.
 * `"SPDR S&P 500 ETF Trust"`, `"YIELDMAX NVDA OPTION INCOME STRATEGY ETF"`).
 * Prefer that over just showing the ticker again. Doesn't apply to Korean
 * stocks or well-known US names (Toss does have a Korean `name` for those,
 * e.g. AAPL → "애플").
 */
export function displayNameOf(info: { symbol: string; name: string; englishName: string | null }): string {
  if (info.name.toUpperCase() !== info.symbol.toUpperCase()) return info.name;
  return info.englishName?.trim() || info.name;
}
