import { getValidAccessToken } from './oauth';

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

class SheetsApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new SheetsApiError(
      res.status,
      body?.error?.message ? `Google Sheets API 오류: ${body.error.message}` : `Google Sheets API 요청 실패: ${res.status}`
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface SpreadsheetInfo {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

export async function createSpreadsheet(title: string, tabTitles: string[]): Promise<SpreadsheetInfo> {
  const body = await sheetsFetch('', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: tabTitles.map((t) => ({ properties: { title: t } })),
    }),
  });
  return { spreadsheetId: body.spreadsheetId, spreadsheetUrl: body.spreadsheetUrl };
}

/** 저장된 spreadsheetId가 여전히 유효한지(사용자가 Drive에서 지우지 않았는지)
 *  확인한다 — 404가 아닌 다른 오류(인증 만료 등)는 "없다"로 잘못 판단해 새
 *  스프레드시트를 만들어버리면 안 되므로 그대로 던진다. */
export async function spreadsheetExists(spreadsheetId: string): Promise<boolean> {
  try {
    await sheetsFetch(`/${spreadsheetId}?fields=spreadsheetId`);
    return true;
  } catch (err) {
    if (err instanceof SheetsApiError && err.status === 404) return false;
    throw err;
  }
}

export async function ensureTab(spreadsheetId: string, title: string): Promise<void> {
  const meta = await sheetsFetch(`/${spreadsheetId}?fields=sheets.properties.title`);
  const existing = new Set<string>((meta.sheets ?? []).map((s: any) => s.properties?.title));
  if (existing.has(title)) return;
  await sheetsFetch(`/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

async function clearValues(spreadsheetId: string, range: string): Promise<void> {
  await sheetsFetch(`/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, { method: 'POST' });
}

/** 시트 전체(범위를 탭 이름만으로 지정 — Sheets API가 이걸 "그 탭 전체"로
 *  해석한다)를 지운 뒤 A1부터 다시 쓴다. 매번 전체를 비우고 다시 쓰는 이유는
 *  이전 내보내기보다 행이 줄었을 때 마지막 행들이 stale하게 남지 않게 하기
 *  위해서다(CSV 내보내기가 매번 전체 파일을 새로 쓰는 것과 같은 이유). */
export async function writeValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
  await clearValues(spreadsheetId, range);
  if (values.length === 0) return;
  await sheetsFetch(`/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range, values }),
  });
}

export async function readValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const body = await sheetsFetch(`/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return (body.values ?? []) as string[][];
}

const DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';

/** 로컬에 저장된 spreadsheetId가 없거나 더는 유효하지 않을 때(최초 연결,
 *  또는 예전 "연결 해제" 버그로 이미 중복 생성된 경우), 새로 또 만들기 전에
 *  이름이 정확히 일치하는 기존 스프레드시트가 있는지 찾는다 — drive.readonly
 *  범위만으로 되는 조회 전용 호출(oauth.ts의 SCOPES 주석 참고). 여러 개
 *  찾으면(사용자가 수동으로 사본을 만든 경우 등) 가장 최근에 수정된 것을
 *  쓴다 — 사용자가 최근에 실제로 편집하고 있던 파일일 가능성이 가장 높다. */
export async function findSpreadsheetByName(title: string): Promise<SpreadsheetInfo | null> {
  const token = await getValidAccessToken();
  const params = new URLSearchParams({
    q: `name = '${title.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: 'files(id,webViewLink,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
  });
  const res = await fetch(`${DRIVE_BASE_URL}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // 구 refresh_token에 drive.readonly 동의가 없는 경우(범위 추가 전에 연결한
    // 사용자) 403이 날 수 있다 — 검색 실패로 새 파일을 만들어버리지 않고, 그냥
    // "못 찾음"으로 처리해 기존 동작(스프레드시트 새로 생성)으로 자연스럽게
    // 넘어가게 한다. 사용자가 재연결하면 다음부터는 정상적으로 검색된다.
    return null;
  }
  const body = (await res.json().catch(() => ({}))) as {
    files?: { id: string; webViewLink?: string; modifiedTime?: string }[];
  };
  const first = body.files?.[0];
  if (!first) return null;
  return { spreadsheetId: first.id, spreadsheetUrl: first.webViewLink ?? `https://docs.google.com/spreadsheets/d/${first.id}/edit` };
}
