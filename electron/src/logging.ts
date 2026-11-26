import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { app } from 'electron';
import { redactLogLine } from './redact';

// 로컬 로그 파일(2026-11-16) — 예전엔 콘솔에만 찍혀서, 설치본 사용자가 "안 돼요"라고 하면 원인을 볼 방법이 없었다
// (맥 설치본은 표준 출력이 어디에도 남지 않는다). 메인 프로세스(백엔드 포함)의 console.* 를 그대로 두고 파일에도 쓴다.
//
// - 위치: `app.getPath('logs')`(맥 ~/Library/Logs/@mystock/electron, 윈도우 %APPDATA%\@mystock\electron\logs, 리눅스
//   ~/.config/@mystock/electron/logs) — 정보 화면의 "로그 폴더 열기"가 연다(backend routes/about.ts).
// - **가려서 쓴다**(redact.ts): 홈 폴더 경로(→ `~`, 계정 이름), 6자리 이상 숫자열(계좌번호·금액·날짜), 이메일, `Bearer …`,
//   24자 이상 영숫자·기호 덩어리(토큰·키)를 지운다.
//   백엔드도 응답 원문은 모양만 남기지만(logRedact.ts) 여기서 한 번 더 거른다 — 사용자가 이 파일을 문의에 첨부한다.
// - 크기: 시작할 때 2MB를 넘으면 main.1.log로 돌리고 그 전 것은 지운다(최대 약 4MB).
// - 처리 안 된 오류(unhandledRejection·uncaughtException)도 여기 남긴다 — 비동기 함수가 많아져 놓친 거부를 추적하려고.
//   uncaughtException은 Electron 기본 동작(오류 창)을 대신하므로 앱은 계속 돈다 — 백엔드 요청 하나의 실패로 앱이
//   멈추는 것보다 기록 후 계속이 낫다.

const MAX_BYTES = 2 * 1024 * 1024;

let installed = false;

export function setupFileLogging(): string | null {
  if (installed) return null;
  installed = true;
  let file: string;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    file = path.join(dir, 'main.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, 'main.1.log'));
  } catch {
    return null; // 로그를 못 남겨도 앱은 돌아야 한다
  }
  const stream = fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
  stream.on('error', () => {}); // 디스크 문제로 로깅이 앱을 죽이지 않게

  const write = (level: string, args: unknown[]) => {
    try {
      stream.write(`${new Date().toISOString()} [${level}] ${redactLogLine(format(...args))}\n`);
    } catch {
      // 무시
    }
  };
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
  });

  console.log(`[logging] MyStock ${app.isPackaged ? app.getVersion() : '(dev)'} 시작 — ${process.platform} ${process.arch}, Electron ${process.versions.electron}`);
  return file;
}
