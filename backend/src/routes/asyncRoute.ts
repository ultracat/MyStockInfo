import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4는 async 핸들러가 던진(거부된) 예외를 잡아주지 않는다 — 응답 없이 요청이 매달리고 프로세스엔
 *  unhandledRejection만 남는다. 이 감싸개가 거부를 `next(err)`로 넘겨 server.ts의 전역 오류 처리기(JSON 응답 +
 *  긴 숫자열 가리기)가 받게 한다. 핸들러 안에서 직접 try/catch로 응답하는 경로는 그대로 동작한다. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
