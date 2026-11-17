// KIS 응답 모양 — **값은 버리고** 블록(output·output1·output2…)마다 필드 이름과 값의 형태만 남긴다. 두 군데서 쓴다:
//   1) `npm run kis:record`(scripts/kis-live-check.cjs --record)가 실제 응답을 모아 backend/spec/snapshots/kis-live.json에 기록
//   2) 앱이 평소 조회할 때 그 기록(kisSpec.gen.ts의 KIS_LIVE_FIELDS)과 비교해, 필드가 빠지거나 새로 생기면 로그 파일에 한 번 경고
// KIS는 기계가 읽을 명세가 없어 실제 응답이 가장 정확한 명세다(backend/CLAUDE.md "KIS API 검증 묶음"). 계좌번호·금액·종목은 담지 않는다.
import { KIS_LIVE_FIELDS } from './kisSpec.gen';

export type KisValueKind = 'empty' | 'number' | 'text';
export interface KisBlockShape {
  kind: 'array' | 'object';
  /** 실제로 줄이 있었나 — 없으면 필드를 알 수 없다(예: 해외 보유 0건). */
  seenRows: boolean;
  fields: Record<string, KisValueKind>;
}
export type KisResponseShape = Record<string, KisBlockShape>;

/** 봉투(성공 코드·메시지·연속조회 키)는 블록이 아니다. */
const ENVELOPE = /^(rt_cd|msg_cd|msg1|tr_cont|trCont|ctx_area_\w+)$/i;
const RANK: Record<KisValueKind, number> = { empty: 0, number: 1, text: 2 };

export function valueKind(v: unknown): KisValueKind {
  if (v === null || v === undefined) return 'empty';
  const s = String(v).trim();
  if (!s) return 'empty';
  return /^[-+]?\d+(\.\d+)?$/.test(s) ? 'number' : 'text';
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 응답 본문 → 블록별 모양. 값 자체는 어디에도 남지 않는다. */
export function describeKisResponse(body: Record<string, unknown>): KisResponseShape {
  const out: KisResponseShape = {};
  for (const [key, v] of Object.entries(body)) {
    if (ENVELOPE.test(key)) continue;
    const rows = Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : null;
    if (!rows) continue; // 최상위 글자 값은 블록이 아니다
    const fields: Record<string, KisValueKind> = {};
    for (const r of rows) {
      for (const [f, fv] of Object.entries(r)) {
        const k = valueKind(fv);
        if (!(f in fields) || RANK[k] > RANK[fields[f]]) fields[f] = k;
      }
    }
    out[key] = { kind: Array.isArray(v) ? 'array' : 'object', seenRows: rows.length > 0, fields };
  }
  return out;
}

/** 같은 TR의 여러 응답(페이지·호출)을 합친다. 줄이 있던 쪽의 필드를 모두 모은다. */
export function mergeKisShapes(a: KisResponseShape, b: KisResponseShape): KisResponseShape {
  const out: KisResponseShape = { ...a };
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
type Observer = (trId: string, body: Record<string, unknown>) => void;
const observers = new Set<Observer>();

/** 성공한 KIS 응답을 볼 때마다 부른다(kis:record가 모양을 모을 때). 해제 함수를 돌려준다. */
export function observeKisResponses(fn: Observer): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

const warned = new Set<string>();

/**
 * 기록된 모양(KIS_LIVE_FIELDS)과 다른지 — 줄이 있는 블록만 본다. **빠진 필드**는 앱이 읽는 값이 비게 되는 신호라 경고하고,
 * 새로 생긴 필드는 같은 경고에 덧붙인다. 같은 TR·블록·차이는 프로세스당 한 번만(1분 새로고침마다 쌓이지 않게).
 * 돌려주는 값은 테스트용.
 */
export function checkKisDrift(trId: string, body: Record<string, unknown>): string[] {
  const expected = (KIS_LIVE_FIELDS as Record<string, Record<string, readonly string[]>>)[trId];
  if (!expected) return [];
  const messages: string[] = [];
  for (const [block, s] of Object.entries(describeKisResponse(body))) {
    const want = expected[block];
    if (!want || !s.seenRows) continue;
    const got = new Set(Object.keys(s.fields));
    const missing = want.filter((f) => !got.has(f));
    if (!missing.length) continue; // 새 필드만 생긴 건 앱을 깨지 않는다 — kis:verify가 따로 알려 준다
    const added = [...got].filter((f) => !want.includes(f));
    const msg = `${trId} ${block}: 빠짐 ${missing.join(', ')}${added.length ? ` / 새로 생김 ${added.join(', ')}` : ''}`;
    messages.push(msg);
    if (!warned.has(msg)) {
      warned.add(msg);
      console.warn(`[kis] 응답 모양이 기록(kis-live.json)과 다릅니다 — ${msg}. 화면 값이 비거나 0일 수 있습니다(npm run kis:verify).`);
    }
  }
  return messages;
}

/** kisGet이 성공 응답마다 부른다. 관찰·비교가 실패해도 조회 자체를 막지 않는다. */
export function noteKisResponse(trId: string, body: Record<string, unknown>): void {
  try {
    checkKisDrift(trId, body);
  } catch {
    /* 비교는 보조 기능 */
  }
  for (const fn of observers) {
    try {
      fn(trId, body);
    } catch {
      /* 관찰자 오류는 무시 */
    }
  }
}
