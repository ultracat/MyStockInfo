// 최소 RFC4180 CSV 파서/직렬화 — 배당 기록 export/import 전용. 값에 콤마/따옴표/
// 줄바꿈이 섞여도(메모 필드) 안전하도록 따옴표 감싸기 규칙을 그대로 구현한다.
// 외부 라이브러리 없이 필드 몇 개짜리 CSV만 다루므로 직접 구현이 더 가볍다.

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

// CSV 수식 주입 방지 — 엑셀·구글 시트는 =, +, -, @(와 탭·CR)로 시작하는 칸을 수식으로 실행한다.
// 메모·종목명처럼 사람이 쓴 글자가 그대로 나가므로 그런 칸 앞에 '를 붙여 글자로 만든다(OWASP 권고).
// 음수·부호 있는 숫자(-1234.5, +3)는 숫자 그대로 둔다 — 금액 칸이 글자가 되면 안 된다.
// 우리 가져오기(parseCsv)는 이 '를 다시 떼서 왕복해도 값이 같다.
const FORMULA_START = /^[=+\-@\t\r]/;
const SIGNED_NUMBER = /^[+-]?\d[\d,]*(\.\d+)?$/;
// 원래 '로 시작하던 값('=x)도 하나 더 붙여 내보낸다 — 가져올 때 하나만 떼므로 왕복해도 같다.
const needsFormulaGuard = (v: string): boolean => {
  const body = v.replace(/^'+/, '');
  return FORMULA_START.test(body) && !SIGNED_NUMBER.test(body);
};

function escapeCsvField(raw: string): string {
  const value = needsFormulaGuard(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // 순수 개행(빈 줄)만 있는 파일이면 빈 배열을 돌려준다.
  const src = text.replace(/^﻿/, '');

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r) => r.map((f) => (f.startsWith("'") && needsFormulaGuard(f.slice(1)) ? f.slice(1) : f)));
}

/** 브라우저 표준 API(Blob + objectURL + <a download>)만으로 파일을 내려받는다 —
 *  Electron IPC나 네이티브 저장 대화상자 없이도 되는 방식이라 CSV 외의
 *  다운로드(예: 데이터 백업 zip, Settings.tsx)에도 그대로 쓴다. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: string[][]) {
  // BOM을 붙여야 엑셀/한글 스프레드시트에서 UTF-8로 바로 인식한다.
  downloadBlob(filename, new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
}
