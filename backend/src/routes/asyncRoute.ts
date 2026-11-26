import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** async 핸들러의 거부를 `next(err)`로 넘겨 server.ts의 전역 오류 처리기(JSON 응답 + 긴 숫자열 가리기)가 받게 한다.
 *  Express 4는 이걸 안 해 줘서 응답 없이 요청이 매달렸다(2026-11-26 이 감싸개를 넣은 이유). Express 5부터는 프레임워크가
 *  같은 일을 하므로 이 감싸개는 **없어도 되지만**, 의도를 드러내고 Express 4식 코드로 되돌아가도 안전하게 남겨 둔다.
 *  핸들러 안에서 직접 try/catch로 응답하는 경로는 그대로 동작한다. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
