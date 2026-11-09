/** CSV/Sheets 가져오기 세 종류(보유종목/매매내역/배당금) 공통 응답.
 *  - `skipped`: API·동기화 계좌 행이라 쓰지 않고 건너뛴 수(brokers/rowOwnership.ts) —
 *    내보낸 파일을 그대로 다시 가져오면 늘 생기므로 실패가 아니다.
 *  - `aborted`: Sheets 가져오기에서 실패한 행이 하나라도 있어 **아무것도 바꾸지
 *    않았다**는 뜻(전체 교체라 일부만 반영하면 실패한 행이 로컬에서 조용히
 *    사라진다). CSV 가져오기는 실패 행만 빼고 저장하므로 항상 없음. */
export interface ImportResult {
  added: number;
  failed: { row: number; error: string }[];
  skipped: number;
  aborted?: boolean;
}
