import os from 'node:os';
// 숫자열 가리기는 백엔드 logRedact.ts의 것을 그대로 쓴다(규칙을 한 곳에 — 예전엔 두 곳에 정규식이 따로 있어 어긋났다).
// 패키징본에도 backend/dist/**가 node_modules/@mystock/backend로 들어간다(루트 package.json build.files).
import { maskDigitRuns } from '@mystock/backend/dist/logRedact';

// 로그 파일 한 줄 가리기(logging.ts가 쓴다). electron을 import하지 않는 별도 파일이라 node:test로 바로 시험할 수 있다(test/redact.test.ts).
// 홈 폴더 경로(→ `~`, 계정 이름), 이메일, `Bearer …`, 영문+숫자가 섞인 24자 이상 덩어리(토큰·키), 6자리 이상 숫자열(계좌번호·금액·날짜·종목코드).
export function redactLogLine(text: string, home: string = os.homedir()): string {
  const withoutHome = home && home.length > 1 ? text.split(home).join('~') : text; // 경로 속 계정 이름
  return maskDigitRuns(
    withoutHome
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
      .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
      .replace(/[A-Za-z0-9_\-+/=]{24,}/g, (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) ? '<redacted>' : m)),
  );
}
