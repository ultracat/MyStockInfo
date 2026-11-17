import { Router } from 'express';
import fs from 'node:fs';

// 보고서 PDF 저장(2026-11-17) — 화면(보고서 화면)이 인쇄용 모양을 갖춘 뒤 부른다. 앱 창을 그대로 `printToPDF`로 찍어(인쇄 CSS가 사이드바·
// 버튼·줌을 걷어 낸다, frontend styles.css `@media print`) 저장 대화상자로 받은 경로에 쓴다. Electron 밖(단독 실행·테스트)이면 501.
// ⚠ 한 프로세스에서 printToPDF를 동시에 여러 번 돌리면 macOS에서 죽는 일이 있다(위키: HEV Log Analyzer) — 진행 중이면 409.
export const reportRouter = Router();

let printing = false;

reportRouter.post('/pdf', async (req, res) => {
  const raw = String((req.body as { fileName?: unknown })?.fileName ?? 'MyStock-보고서.pdf');
  const fileName = raw.replace(/[\\/:*?"<>|\n\r]/g, '_').slice(0, 100).replace(/(\.pdf)?$/i, '.pdf');
  let electron: typeof import('electron');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    electron = require('electron') as typeof import('electron');
    if (!electron?.BrowserWindow) throw new Error('no electron');
  } catch {
    return res.status(501).json({ error: 'PDF 저장은 앱(Electron)에서만 됩니다.' });
  }
  const win = electron.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return res.status(500).json({ error: '앱 창을 찾지 못했습니다.' });
  if (printing) return res.status(409).json({ error: '이미 PDF를 만들고 있습니다.' });
  printing = true;
  try {
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    const { canceled, filePath } = await electron.dialog.showSaveDialog(win, {
      title: '보고서 PDF 저장',
      defaultPath: fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return res.json({ saved: null });
    fs.writeFileSync(filePath, pdf);
    res.json({ saved: filePath });
  } catch (err) {
    res.status(500).json({ error: `PDF를 만들지 못했습니다: ${(err as Error).message}` });
  } finally {
    printing = false;
  }
});
