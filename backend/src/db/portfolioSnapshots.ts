import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/** 하루에 한 번(앱 진입 시) 프론트가 이미 계산해둔 전체 브로커/계좌 합산
 *  KRW 환산 총액을 그대로 받아 기록해두는 시계열 — 서버가 이 합산을 다시
 *  계산하지 않는다(Overview.tsx가 이미 하고 있는 걸 중복 구현하지 않으려는
 *  의도, `frontend/CLAUDE.md`의 Overview.tsx 절 참고). "매월 보유종목 투자금
 *  대비 수익률" 카드(매매내역에서 수량만 재구성하는 근사치)와 달리, 이건 그
 *  날 실제로 계산된 값을 그대로 남겨두는 거라 완전히 정확하지만 이 기능을 쓰기
 *  시작한 날부터만 쌓인다(과거 소급 불가). */
export interface SnapshotRecord {
  date: string; // YYYY-MM-DD
  totalMarketValueKrw: number;
  totalPurchaseAmountKrw: number;
  totalProfitLossKrw: number;
}

function store() {
  return new JsonStore<SnapshotRecord[]>('portfolio-snapshots.json', getDataDir(), []);
}

export function listSnapshots(): SnapshotRecord[] {
  return store()
    .read()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 같은 날짜가 이미 있으면 덮어쓴다 — 하루에 앱을 여러 번 열어도 그 날짜 한
 *  행으로 수렴하고, 지난 날짜는 다시 안 바뀐다(이미 지나간 날의 "그날 실제
 *  값"이 나중에 달라질 이유가 없음). */
export function upsertSnapshot(record: SnapshotRecord): SnapshotRecord {
  store().update((current) => {
    const idx = current.findIndex((s) => s.date === record.date);
    if (idx === -1) return [...current, record];
    const next = [...current];
    next[idx] = record;
    return next;
  });
  return record;
}
