// 증권사 응답 모양(공통) — **값은 버리고** 블록마다 필드 이름과 값의 형태만 남긴다(2026-11-17, KIS용으로 만든 것을 전 증권사로).
//   1) 실서버 점검의 `--record`(npm run kis:record / check:toss|nh|kb|kiwoom -- --record)가 실제 응답을 모아
//      backend/spec/snapshots/<증권사>-live.json에 기록한다(scripts/lib/live-check.cjs의 recordShapes).
//   2) 앱이 평소 조회할 때 그 기록(liveFields.gen.ts)과 비교해, 기록에 있던 필드가 빠지면 로그 파일에 한 번 경고한다.
// 블록 이름은 본문 안의 경로다: 최상위 글자 값들은 `$`, `output1`(KIS), `result`·`result.items`(토스), `Output_1`(NH),
// `acnt_evlt_remn_indv_tot`(키움), `dataBody`·`dataBody.Record1`(KB). 배열은 원소들을 합친 한 블록이다.
// 계좌번호·금액·종목 같은 값은 어디에도 남지 않는다(test/responseShape.test.ts가 확인).
import { LIVE_FIELDS } from './liveFields.gen';

export type Broker = 'kis' | 'toss' | 'nh' | 'kiwoom' | 'kb' | 'ls' | 'db';
export type ValueKind = 'empty' | 'number' | 'text' | 'object' | 'array';
export interface BlockShape {
  kind: 'array' | 'object';
  /** 실제로 줄이 있었나 — 없으면 필드를 알 수 없다(예: 보유 0건). */
  seenRows: boolean;
  fields: Record<string, ValueKind>;
}
export type ResponseShape = Record<string, BlockShape>;

/** 증권사별 봉투(성공 코드·메시지·연속조회 키) — 블록 필드가 아니다. */
const ENVELOPE: Record<Broker, RegExp> = {
  kis: /^(rt_cd|msg_cd|msg1|tr_cont|trCont|ctx_area_\w+)$/i,
  toss: /^$/,
  nh: /^(rsp_cd|rsp_msg)$/,
  kiwoom: /^(return_code|return_msg)$/,
  kb: /^(o_lngth|o_clsf|o_msg)$/,
  ls: /^(rsp_cd|rsp_msg)$/,
  db: /^(rsp_cd|rsp_msg)$/,
};
const RANK: Record<ValueKind, number> = { empty: 0, number: 1, text: 2, object: 3, array: 3 };
const MAX_DEPTH = 4;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function valueKind(v: unknown): ValueKind {
  if (Array.isArray(v)) return 'array';
  if (isObj(v)) return 'object';
  if (v === null || v === undefined) return 'empty';
  if (typeof v === 'number') return 'number';
  const s = String(v).trim();
  if (!s) return 'empty';
  return /^[-+]?[\d,]*\.?\d+$/.test(s) ? 'number' : 'text';
}

/** 응답 본문 → 블록별 모양. 값 자체는 어디에도 남지 않는다. */
export function describeResponse(body: unknown, broker: Broker): ResponseShape {
  const out: ResponseShape = {};
  const envelope = ENVELOPE[broker];
  const walk = (rows: Record<string, unknown>[], kind: 'array' | 'object', at: string, depth: number) => {
    const fields: Record<string, ValueKind> = {};
    const nested = new Map<string, { rows: Record<string, unknown>[]; kind: 'array' | 'object' }>();
    for (const r of rows) {
      for (const [f, v] of Object.entries(r)) {
        if (at === '$' && envelope.test(f)) continue;
        const k = valueKind(v);
        if (!(f in fields) || RANK[k] > RANK[fields[f]]) fields[f] = k;
        if (depth < MAX_DEPTH && (k === 'object' || (k === 'array' && (v as unknown[]).some(isObj)))) {
          const n = nested.get(f) ?? { rows: [], kind: k === 'array' ? 'array' : 'object' };
          n.rows.push(...(Array.isArray(v) ? v.filter(isObj) : [v as Record<string, unknown>]));
          nested.set(f, n);
        } else if (depth < MAX_DEPTH && k === 'array' && !nested.has(f)) {
          nested.set(f, { rows: [], kind: 'array' }); // 빈 배열 — 블록은 있지만 줄이 없다
        }
      }
    }
    // 최상위에 글자 값이 하나도 없으면(KIS·토스처럼 블록만 있는 본문) `$` 블록은 남기지 않는다.
    const scalarOnly = Object.entries(fields).filter(([f]) => !nested.has(f));
    if (at !== '$' || scalarOnly.length) out[at] = { kind, seenRows: rows.length > 0, fields: at === '$' ? Object.fromEntries(scalarOnly) : fields };
    for (const [f, n] of nested) walk(n.rows, n.kind, at === '$' ? f : `${at}.${f}`, depth + 1);
  };
  if (isObj(body)) walk([body], 'object', '$', 0);
  return out;
}

/** 같은 API의 여러 응답(페이지·호출)을 합친다. 줄이 있던 쪽의 필드를 모두 모은다. */
export function mergeShapes(a: ResponseShape, b: ResponseShape): ResponseShape {
  const out: ResponseShape = { ...a };
  for (const [block, s] of Object.entries(b)) {
    const prev = out[block];
    if (!prev) {
      out[block] = { ...s, fields: { ...s.fields } };
      continue;
    }
    const fields = { ...prev.fields };
    for (const [f, k] of Object.entries(s.fields)) if (!(f in fields) || RANK[k] > RANK[fields[f]]) fields[f] = k;
    out[block] = { kind: prev.seenRows ? prev.kind : s.kind, seenRows: prev.seenRows || s.seenRows, fields };
  }
  return out;
}

// ── 응답 관찰 ────────────────────────────────────────────────────────────────
type Observer = (broker: Broker, key: string, body: unknown) => void;
const observers = new Set<Observer>();

/** 성공한 응답을 볼 때마다 부른다(실서버 점검의 --record가 모양을 모을 때). 해제 함수를 돌려준다. */
export function observeResponses(fn: Observer): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

const warned = new Set<string>();

/**
 * 실제 응답 기록과 다른지 — 줄이 있는 블록만 본다. **빠진 필드**는 앱이 읽는 값이 비게 되는 신호라 경고하고, 새로 생긴 필드는
 * 같은 경고에 덧붙인다(새 필드만 생긴 건 앱을 깨지 않아 경고하지 않는다). 같은 차이는 프로세스당 한 번만. 돌려주는 값은 테스트용.
 */
export function checkDrift(
  broker: Broker,
  key: string,
  body: unknown,
  expectedOverride?: Record<string, readonly string[]>
): string[] {
  const expected = expectedOverride ?? LIVE_FIELDS[broker]?.fields[key];
  if (!expected) return [];
  const messages: string[] = [];
  for (const [block, s] of Object.entries(describeResponse(body, broker))) {
    const want = expected[block];
    if (!want || !s.seenRows) continue;
    const got = new Set(Object.keys(s.fields));
    const missing = want.filter((f) => !got.has(f));
    if (!missing.length) continue;
    const added = [...got].filter((f) => !want.includes(f));
    const msg = `${broker} ${key} ${block}: 빠짐 ${missing.join(', ')}${added.length ? ` / 새로 생김 ${added.join(', ')}` : ''}`;
    messages.push(msg);
    if (!warned.has(msg)) {
      warned.add(msg);
      console.warn(`[${broker}] 응답 모양이 실제 응답 기록(${broker}-live.json)과 다릅니다 — ${msg}. 화면 값이 비거나 0일 수 있습니다.`);
    }
  }
  return messages;
}

/** 각 증권사 요청 함수가 성공 응답마다 부른다. 비교·관찰이 실패해도 조회 자체를 막지 않는다. */
export function noteResponse(broker: Broker, key: string, body: unknown): void {
  try {
    checkDrift(broker, key, body);
  } catch {
    /* 비교는 보조 기능 */
  }
  for (const fn of observers) {
    try {
      fn(broker, key, body);
    } catch {
      /* 관찰자 오류는 무시 */
    }
  }
}
