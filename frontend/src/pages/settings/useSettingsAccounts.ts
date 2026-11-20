import { useCallback, useMemo, useState } from 'react';
import { api } from '../../api';
import { accountLabelKey } from '../../accountLabels';
import { API_BROKER_IDS, BROKER_ORDER, CSV_ONLY_BROKER_IDS } from '../../brokers';
import type { AccountTaxType, AccountTaxTypeEntry, BrokerAccount, BrokerId, CredentialStatus } from '../../types';

export interface KnownAccount {
  broker: BrokerId;
  accountId: string;
}

/**
 * 설정 화면이 아는 계좌 목록 — "계좌 별칭 · 세금 유형" 카드와 "증권사 연동 상태"(NH 계좌 표시)가 함께 쓴다.
 *
 * (broker, accountId) → 별칭 + 세금 유형(ISA/연금저축/IRP 등). 관리는 여기서만
 * 하고 Dashboard.tsx/Trades.tsx/Dividends.tsx(별칭)/RealizedGains.tsx(세금
 * 유형)는 표시/계산할 때 읽기만 한다. "알려진 계좌" 목록은 이미 라벨/세금
 * 유형이 붙은 계좌 + holdings-store/trades-store/배당 기록에 실제로 나온
 * accountId(CSV 전용 브로커) + 실시간 계좌 목록(API 브로커, 자격증명이 설정된
 * 경우만) 전부의 합집합이다 — 데이터가 없어도 라벨/세금 유형만 미리 등록해둘
 * 수 있고, 반대로 라벨이 없어도 실제 데이터/계좌가 있으면 목록에 뜬다.
 * **API 브로커(토스/KIS)도 포함한다** — 계좌번호 자체는 이미 읽을 수 있는 값이라
 * 별칭은 잘 안 쓰지만, 세금 유형(ISA 등)은 API 브로커 계좌에도 똑같이 필요하다
 * (API 증권사에도 ISA 계좌가 있다 — backend/CLAUDE.md의 "계좌별 세금 유형" 절 참고).
 */
export function useSettingsAccounts() {
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);
  // API 브로커의 실시간 계좌 목록(모의투자 포함) — "증권사 연동 상태"의 계좌 정보 칸과 별칭 표의 모의투자 표시용.
  const [apiAccounts, setApiAccounts] = useState<Partial<Record<BrokerId, BrokerAccount[]>>>({});
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  // 표시용 계좌번호 — accountId가 사람이 읽는 번호가 아닌 브로커(토스증권의
  // accountSeq "1")만 입력칸을 보여준다(ACCOUNT_NUMBER_EDITABLE_BROKERS).
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [taxTypes, setTaxTypes] = useState<AccountTaxTypeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshAccounts = useCallback(async () => {
    setLoading(true);
    const credStatus = await api.getCredentialStatus().catch(() => ({}) as CredentialStatus);
    const [labels, taxTypeEntries, allDividends, perBroker, perApiBroker] = await Promise.all([
      api.listAccountLabels(),
      api.listAccountTaxTypes(),
      api.listDividends(),
      Promise.all(
        CSV_ONLY_BROKER_IDS.map((b) =>
          Promise.all([api.listHoldingsStore({ broker: b }), api.listTradesStore({ broker: b })]).then(([holdings, trades]) => ({
            broker: b,
            accountIds: new Set([...holdings.map((h) => h.accountId), ...trades.map((t) => t.accountId)]),
          }))
        )
      ),
      Promise.all(
        API_BROKER_IDS.filter((b) => credStatus[b]).map((b) =>
          api
            .listAccounts(b, { includePaper: true })
            .then((accounts) => ({ broker: b, accounts, accountIds: new Set(accounts.map((a) => a.id)) }))
            .catch(() => ({ broker: b, accounts: [] as BrokerAccount[], accountIds: new Set<string>() }))
        )
      ),
    ]);

    setApiAccounts(Object.fromEntries(perApiBroker.map((p) => [p.broker, p.accounts])));
    const known = new Map<string, KnownAccount>();
    for (const { broker: b, accountIds } of [...perBroker, ...perApiBroker]) {
      for (const accountId of accountIds) known.set(accountLabelKey(b, accountId), { broker: b, accountId });
    }
    for (const d of allDividends) {
      if (d.accountId && CSV_ONLY_BROKER_IDS.includes(d.broker)) {
        known.set(accountLabelKey(d.broker, d.accountId), { broker: d.broker, accountId: d.accountId });
      }
    }
    for (const l of labels) known.set(accountLabelKey(l.broker, l.accountId), { broker: l.broker, accountId: l.accountId });
    for (const t of taxTypeEntries) known.set(accountLabelKey(t.broker, t.accountId), { broker: t.broker, accountId: t.accountId });

    const list = Array.from(known.values()).sort(
      (a, b) => BROKER_ORDER.indexOf(a.broker) - BROKER_ORDER.indexOf(b.broker) || a.accountId.localeCompare(b.accountId)
    );
    setKnownAccounts(list);
    setTaxTypes(taxTypeEntries);

    const drafts: Record<string, string> = {};
    const nextNumberDrafts: Record<string, string> = {};
    for (const a of list) {
      const key = accountLabelKey(a.broker, a.accountId);
      const entry = labels.find((l) => l.broker === a.broker && l.accountId === a.accountId);
      drafts[key] = entry?.label ?? '';
      nextNumberDrafts[key] = entry?.accountNumber ?? '';
    }
    setLabelDrafts(drafts);
    setNumberDrafts(nextNumberDrafts);
    setLoading(false);
  }, []);

  const taxTypeByAccount = useMemo(() => {
    const m = new Map<string, AccountTaxType>();
    for (const t of taxTypes) m.set(accountLabelKey(t.broker, t.accountId), t.taxType);
    return m;
  }, [taxTypes]);

  const taxTypeFor = useCallback(
    (b: BrokerId, accountId: string): AccountTaxType => taxTypeByAccount.get(accountLabelKey(b, accountId)) ?? 'GENERAL',
    [taxTypeByAccount]
  );

  // 모의투자 계좌는 세금 계산(실현손익)에 들어가지 않아 세금 유형이 의미 없다.
  const isPaperAccount = useCallback(
    (b: BrokerId, accountId: string) => apiAccounts[b]?.some((x) => x.id === accountId && x.paper) ?? false,
    [apiAccounts]
  );

  return {
    knownAccounts,
    apiAccounts,
    labelDrafts,
    setLabelDrafts,
    numberDrafts,
    setNumberDrafts,
    setTaxTypes,
    loading,
    refreshAccounts,
    taxTypeFor,
    isPaperAccount,
  };
}

export type SettingsAccounts = ReturnType<typeof useSettingsAccounts>;
