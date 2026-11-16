import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/csv';

test('CSV: 수식으로 실행될 글자 칸 앞에 \' — 부호 있는 숫자는 그대로', () => {
  const out = toCsv([['=1+1', '-1234.5', '+3', '@SUM(A1)', '-foo', '\tx', '정상']]);
  assert.equal(out, "'=1+1,-1234.5,+3,'@SUM(A1),'-foo,'\tx,정상");
});

test('CSV: 내보낸 것을 다시 가져오면 값이 같다(따옴표·콤마·줄바꿈·원래 \'로 시작하던 값 포함)', () => {
  const rows = [
    ['=1+1', '-1234.5', '+3', '@SUM(A1)', '-foo', 'a,b', 'say "hi"', 'line1\nline2', "'=x", "'plain", '정상'],
    ['', '0', 'USD', '2026-11-16'],
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('CSV 가져오기: BOM과 CRLF를 처리하고 빈 줄은 버린다', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,2\r\n\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});
