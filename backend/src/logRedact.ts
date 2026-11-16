// 로그에 증권사 응답을 남길 때 쓰는 가리기 도우미(2026-11-16 보안 재검토).
// 예전엔 "응답 형식이 예상과 다르다" 로그가 원본 응답 전체(계좌번호·보유 수량·금액)를 그대로 찍었다.
// 맥 설치본은 표준 출력이 어디에도 저장되지 않지만, 터미널에서 띄우거나 Linux·Windows에서는 남을 수 있다.
//
// - `describeShape(v)` — 값은 버리고 **모양만** 남긴다(키 이름·타입·문자열 길이·배열 길이·첫 원소 모양).
//   "형식이 바뀌었다"를 고치는 데 필요한 건 모양이지 값이 아니다.
// - `redactText(s)` — 오류 본문처럼 자유 텍스트는 6자리 이상 숫자열(계좌번호·금액)을 가리고 길이를 자른다.

const MAX_DEPTH = 6;
const MAX_KEYS = 40;

export function describeShape(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `<array:${value.length}>`;
    return value.length === 0 ? [] : [`<array:${value.length}>`, describeShape(value[0], depth + 1)];
  }
  switch (typeof value) {
    case 'string':
      return `<string:${value.length}>`;
    case 'number':
    case 'boolean':
      return `<${typeof value}>`;
    case 'object': {
      if (depth >= MAX_DEPTH) return '<object>';
      const out: Record<string, unknown> = {};
      const keys = Object.keys(value as object);
      for (const k of keys.slice(0, MAX_KEYS)) out[k] = describeShape((value as Record<string, unknown>)[k], depth + 1);
      if (keys.length > MAX_KEYS) out['…'] = `+${keys.length - MAX_KEYS} keys`;
      return out;
    }
    default:
      return `<${typeof value}>`;
  }
}

/** 로그 한 줄용 — 모양을 JSON 문자열로. */
export function shapeForLog(value: unknown): string {
  return JSON.stringify(describeShape(value));
}

export function redactText(text: string, maxLength = 500): string {
  const masked = text.replace(/\d[\d-]{5,}\d/g, (m) => '#'.repeat(m.length));
  return masked.length > maxLength ? `${masked.slice(0, maxLength)}…(+${masked.length - maxLength})` : masked;
}
