// 로그에 증권사 응답을 남길 때 쓰는 가리기 도우미(2026-11-16 보안 재검토).
// 예전엔 "응답 형식이 예상과 다르다" 로그가 원본 응답 전체(계좌번호·보유 수량·금액)를 그대로 찍었다.
// 맥 설치본은 표준 출력이 어디에도 저장되지 않지만, 터미널에서 띄우거나 Linux·Windows에서는 남을 수 있다.
//
// - `describeShape(v)` — 값은 버리고 **모양만** 남긴다(키 이름·타입·문자열 길이·배열 길이·첫 원소 모양).
//   "형식이 바뀌었다"를 고치는 데 필요한 건 모양이지 값이 아니다.
// - `redactText(s)` — 오류 본문처럼 자유 텍스트는 6자리 이상 숫자열(계좌번호·금액·날짜)을 가리고 길이를 자른다.
// - `maskDigitRuns(s)` — 그 숫자열 가리기 자체. Electron 로그 파일(electron/src/redact.ts)도 이 함수를 그대로 쓴다(규칙 한 곳).

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

// 숫자 사이에 `,`(천 단위) `.`(소수점) `-`(계좌번호·날짜)가 끼어도 한 덩어리로 본다. **글자 수가 아니라 숫자 개수**로 센다 —
// 예전 `\d[\d-]{5,}\d`는 "7글자 이상"이라 `123456`(6자리)·`1,234.56`(소수)을 놓쳤고, 반대로 글자 수로 세면 버전 `24.22.3`까지 가렸다.
// - 가리는 것: `123456`, `1,234,567`, `12345.67`, `12345678-01`, `2026-11-26`(날짜도 — 거래일이 계좌 활동을 드러낸다).
//   ⚠ 국내 종목코드(`005930`, 6자리)도 가려진다 — 보유 종목을 드러내므로 의도한 것.
// - 남기는 것: 5자리 이하(`4317` 포트, `00123` 오류 코드, `70,000`), 버전(`45.5.0`), IPv4 주소(`127.0.0.1` — 숫자 6개지만
//   금액·계좌번호 모양이 아니고, "어디에 붙었나"를 읽어야 한다). 시각 `12:34:56`은 `:`라 애초에 한 덩어리가 아니다.
const DIGIT_RUN = /\d(?:[\d,.-]*\d)?/g;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function maskDigitRuns(text: string, minDigits = 6): string {
  return text.replace(DIGIT_RUN, (m) => {
    let digits = 0;
    for (const c of m) if (c >= '0' && c <= '9') digits++;
    if (digits < minDigits || IPV4.test(m)) return m;
    return '#'.repeat(m.length);
  });
}

export function redactText(text: string, maxLength = 500): string {
  const masked = maskDigitRuns(text);
  return masked.length > maxLength ? `${masked.slice(0, maxLength)}…(+${masked.length - maxLength})` : masked;
}
