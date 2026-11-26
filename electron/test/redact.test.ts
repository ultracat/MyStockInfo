import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactLogLine } from '../src/redact';

// 백엔드 dist(@mystock/backend/dist/logRedact)를 쓰므로 먼저 `npm run build:backend`가 돼 있어야 한다(루트 npm test는 CI에서 build 뒤에 돈다).

test('redactLogLine: 홈 폴더를 ~로 바꾼다', () => {
  assert.equal(redactLogLine('열기 실패: /Users/someone/Library/x.json', '/Users/someone'), '열기 실패: ~/Library/x.json');
});

test('redactLogLine: 이메일·Bearer·긴 토큰을 가린다', () => {
  assert.equal(redactLogLine('user a.b+c@example.co.kr 로그인', '/home/x'), 'user <email> 로그인');
  assert.equal(redactLogLine('Authorization: Bearer abc.def.ghi', '/home/x'), 'Authorization: Bearer <redacted>');
  assert.equal(redactLogLine('key: Ab12Cd34Ef56Gh78Ij90Kl12Mn', '/home/x'), 'key: <redacted>');
  // 글자만인 긴 단어는 토큰이 아니다
  assert.equal(redactLogLine('abcdefghijklmnopqrstuvwxyzabc', '/home/x'), 'abcdefghijklmnopqrstuvwxyzabc');
});

test('redactLogLine: 6자리 이상 숫자열(계좌번호·금액·날짜·소수)을 가린다', () => {
  assert.equal(redactLogLine('계좌 12345678-01 평가 1,234,567원 단가 12345.67 기준일 2026-11-26', '/home/x'),
    '계좌 ########### 평가 #########원 단가 ######## 기준일 ##########');
  assert.equal(redactLogLine('잔고 123456', '/home/x'), '잔고 ######');
});

test('redactLogLine: 시작 줄의 버전·포트·주소는 남긴다', () => {
  const line = '[logging] MyStock 1.6.0 시작 — darwin arm64, Electron 45.5.0 / listening on http://127.0.0.1:4317';
  assert.equal(redactLogLine(line, '/home/x'), line);
});
