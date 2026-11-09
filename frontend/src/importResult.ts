import type { ImportResult } from './types';

/** CSV/Sheets 가져오기 결과 안내 문구 — 보유종목/매매내역/배당금 화면 공용. */
export function formatImportResult(result: ImportResult): string {
  const failedText = result.failed.map((f) => `${f.row}행 - ${f.error}`).join('; ');
  if (result.aborted) {
    return `가져오기 취소됨 — 실패한 행이 있어 아무것도 바꾸지 않았습니다. 시트를 고친 뒤 다시 가져와주세요. (실패 ${result.failed.length}건: ${failedText})`;
  }
  // API·동기화 계좌 행은 실시간 조회/동기화만 쓴다(backend brokers/rowOwnership.ts) —
  // 내보낸 파일을 다시 가져오면 늘 생기는 정상 상황이라 실패로 세지 않는다.
  const skippedText = result.skipped > 0 ? ` · API·동기화 계좌 ${result.skipped}건은 건너뜀` : '';
  const base = `${result.added}건 추가됨${skippedText}`;
  return result.failed.length > 0 ? `${base} (실패 ${result.failed.length}건: ${failedText})` : base;
}

/** 수동 추가/수정처럼 행 1개짜리 가져오기에서, 그 행이 저장되지 않은 이유. */
export function singleRowImportError(result: ImportResult): string | null {
  if (result.failed.length > 0) return result.failed[0].error;
  if (result.skipped > 0) return 'API·동기화 계좌의 매매내역은 실시간 조회/동기화로만 바뀝니다.';
  return null;
}
