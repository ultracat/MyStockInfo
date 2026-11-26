// 외부 HTTP 요청 공용 — 제한 시간(기본 15초)을 건 fetch.
//
// 왜: 증권사·Google 서버가 응답을 주지 않으면 fetch는 끝없이 기다린다. 이 백엔드는 같은 요청을
// 여러 화면이 공유하고(responseCache의 withCache), 토큰 발급도 한 번을 공유하므로 요청 하나가 멈추면
// 그걸 기다리는 화면 전부가 같이 멈춘다(2026-11-26 리뷰). NH는 원래 15초였고(SDK는 10초) 같은 값을 쓴다.
//
// - **본문까지** 제한 시간 안에 받는다: 헤더만 오고 본문이 멈추는 경우도 있어서, 응답을 여기서 다 읽고
//   같은 상태·헤더로 다시 감싼 Response를 돌려준다(호출부는 평소처럼 res.text()/res.json()을 쓰면 된다).
//   JSON API 용도라 본문을 메모리에 다 올려도 문제없다 — 큰 파일 내려받기에는 쓰지 않는다.
// - 호출부가 넘긴 `signal`이 있으면 둘 중 먼저 끝나는 쪽으로 끊는다(AbortSignal.any). 호출부 signal로
//   끊긴 건 원래 오류(AbortError)를 그대로 던지고, 제한 시간으로 끊긴 것만 FetchTimeoutError로 바꾼다.
// - FetchTimeoutError는 status 0·body ''를 가진다 — errors.ts의 handleBrokerApiError가 다른 증권사 오류처럼
//   502 + 메시지로 내보낸다(NH·LS·DB의 "연결 오류"도 status 0을 쓴다). 메시지에 URL을 넣지 않는다
//   (NH 토큰 발급처럼 쿼리에 앱키가 실리는 요청이 있다).
// - 매번 globalThis.fetch를 부른다(테스트의 가짜 서버가 fetch를 바꿔 끼운다).

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

let defaultTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS;

/** 테스트 전용 — 기본 제한 시간을 줄여 15초를 기다리지 않고 시간 초과 경로를 확인한다. */
export function setDefaultFetchTimeoutForTest(ms: number | null): void {
  defaultTimeoutMs = ms ?? DEFAULT_FETCH_TIMEOUT_MS;
}

export class FetchTimeoutError extends Error {
  readonly status = 0;
  readonly body = '';
  constructor(readonly label: string, readonly timeoutMs: number) {
    super(
      `${label} 서버가 ${Math.max(1, Math.round(timeoutMs / 1000))}초 안에 응답하지 않아 요청을 중단했습니다(시간 초과). ` +
        '네트워크 상태를 확인하고 잠시 후 다시 시도해주세요.'
    );
    this.name = 'FetchTimeoutError';
  }
}

export function isFetchTimeoutError(err: unknown): err is FetchTimeoutError {
  return err instanceof FetchTimeoutError;
}

export interface FetchWithTimeoutInit extends RequestInit {
  /** 제한 시간(ms). 없으면 15초. */
  timeoutMs?: number;
  /** 오류 메시지에 쓰는 상대 이름(예: "토스증권", "Google Sheets"). */
  label?: string;
}

// 본문을 가질 수 없는 상태 코드 — new Response(body, { status })가 이 상태에 본문을 주면 던진다.
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export async function fetchWithTimeout(input: string | URL, init: FetchWithTimeoutInit = {}): Promise<Response> {
  const { timeoutMs = defaultTimeoutMs, label = '외부', ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const callerSignal = rest.signal ?? undefined;
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  try {
    const res = await globalThis.fetch(input, { ...rest, signal });
    const buf = await res.arrayBuffer();
    return new Response(NULL_BODY_STATUS.has(res.status) ? null : buf, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    if (timeout.aborted && !callerSignal?.aborted) throw new FetchTimeoutError(label, timeoutMs);
    throw err;
  }
}
