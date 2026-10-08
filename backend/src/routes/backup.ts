import { Router } from 'express';
import { createBackupZip, restoreBackupZip } from '../backup';

export const backupRouter = Router();

backupRouter.get('/', (_req, res) => {
  try {
    const buffer = createBackupZip();
    const filename = `mystock-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: `백업 생성에 실패했습니다: ${(err as Error).message}` });
  }
});

// multipart/raw body 파서를 새로 추가하지 않으려고(이 프로젝트의 모든 API가
// 지금까지 JSON body만 썼다는 관례 유지) zip을 base64로 감싸 보통 JSON body로
// 받는다 — server.ts가 이 라우트를 위해 express.json()의 기본 제한값(100kb)을
// 올려뒀다(20mb).
backupRouter.post('/restore', (req, res) => {
  const { zipBase64 } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof zipBase64 !== 'string' || !zipBase64) {
    return res.status(400).json({ error: 'zipBase64(문자열)가 필요합니다.' });
  }

  try {
    const buffer = Buffer.from(zipBase64, 'base64');
    const result = restoreBackupZip(buffer);
    if (result.restored.length === 0) {
      return res.status(400).json({ error: '복원할 수 있는 파일이 zip 안에 없습니다.' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `복원에 실패했습니다: ${(err as Error).message}` });
  }
});
