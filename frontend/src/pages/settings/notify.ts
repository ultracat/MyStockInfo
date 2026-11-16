// 설정 화면 맨 위 공용 안내(성공 문구·오류 문구) — 카드들이 이걸로 알린다(Settings.tsx가 만든다).
export interface Notify {
  /** 이전 안내를 지운다(새 동작을 시작할 때). */
  clear(): void;
  ok(text: string): void;
  fail(text: string): void;
}

export const errorText = (e: unknown) => (e as Error).message;
