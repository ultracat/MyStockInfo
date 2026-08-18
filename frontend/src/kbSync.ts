import { api } from './api';

/** KB증권 Open API 연동 상태 — appKey/appSecret이 계좌 하나에 고정 바인딩돼
 *  있어(계좌 목록 조회 API 자체가 없음) "연동돼 있는지"와 "그 계좌가 로컬
 *  accountId로 뭔지"만 알면 된다. Dashboard.tsx/Trades.tsx가 마운트 시 한 번씩
 *  불러서, KB가 선택되고 그 계좌가 화면에 보일 때 백그라운드 동기화를
 *  트리거하는 데 쓴다(accountLabels.ts와 같은 톤의 작은 공용 유틸). */
export interface KbLinkStatus {
  configured: boolean;
  linkedAccountId: string | null;
}

export async function getKbLinkStatus(): Promise<KbLinkStatus> {
  const [status, info] = await Promise.all([api.getCredentialStatus(), api.getCredentialInfo()]);
  const linkedAccountId = info.kb?.accountId?.trim();
  return { configured: !!status.kb, linkedAccountId: linkedAccountId ? linkedAccountId : null };
}
