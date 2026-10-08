// 최소 RFC4180 CSV 파서/직렬화 — 배당 기록 export/import 전용. 값에 콤마/따옴표/
// 줄바꿈이 섞여도(메모 필드) 안전하도록 따옴표 감싸기 규칙을 그대로 구현한다.
// 외부 라이브러리 없이 필드 몇 개짜리 CSV만 다루므로 직접 구현이 더 가볍다.

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

function escapeCsvField(value: string): string {
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

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
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
