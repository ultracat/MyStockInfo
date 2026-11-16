import { Router } from 'express';
import { BackupRequestError, createBackupZip, restoreBackupZip } from '../backup';
import { BackupPasswordError } from '../backupCrypto';
import { createAutoBackup, listAutoBackups, readAutoBackup } from '../autoBackup';

const optionalPassword = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** requestRestart는 Electron 메인이 넘겨준다(패키징된 앱만 — `app.relaunch()` +
 *  `app.exit()`). dev 실행·백엔드 단독 실행엔 없어서 사용자가 직접 다시 시작한다. */
export function createBackupRouter(options: { requestRestart?: () => void }): Router {
  const router = Router();

  // 비밀번호를 body로 받아야 해서 GET이 아니라 POST다 — URL(쿼리)에 넣으면 로그에 남는다.
  // 비밀번호를 안 주면 API 키·Google 연결은 빼고 만든다(backup.ts).
  router.post('/', async (req, res) => {
    try {
      const { buffer, includesSecrets } = await createBackupZip(optionalPassword(req.body?.password));
      const filename = `mystock-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Backup-Includes-Secrets', includesSecrets ? '1' : '0');
      res.send(buffer);
    } catch (err) {
      if (err instanceof BackupRequestError) return res.status(400).json({ error: err.message });
      res.status(500).json({ error: `백업 생성에 실패했습니다: ${(err as Error).message}` });
    }
  });

  // multipart/raw body 파서를 새로 추가하지 않으려고(이 프로젝트의 모든 API가
  // 지금까지 JSON body만 썼다는 관례 유지) zip을 base64로 감싸 보통 JSON body로
  // 받는다 — server.ts가 이 라우트를 위해 express.json()의 기본 제한값(100kb)을
  // 올려뒀다(20mb).
  router.post('/restore', async (req, res) => {
    const { zipBase64, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof zipBase64 !== 'string' || !zipBase64) {
      return res.status(400).json({ error: 'zipBase64(문자열)가 필요합니다.' });
    }

    try {
      // 복원 직전 상태를 자동 백업으로 남긴다 — 잘못 복원해도 되돌릴 수 있게(autoBackup.ts).
      await createAutoBackup('before-restore').catch((err) => console.error('[backup] 복원 전 자동 백업 실패:', err));
      const result = await restoreBackupZip(Buffer.from(zipBase64, 'base64'), optionalPassword(password));
      if (result.restored.length === 0 && result.secrets !== 'restored') {
        return res.status(400).json({ error: '복원할 수 있는 파일이 zip 안에 없습니다.' });
      }
      const restarting = Boolean(options.requestRestart);
      res.json({ ...result, restarting });
      // 응답이 렌더러에 닿을 틈을 두고 재시작한다.
      if (options.requestRestart) setTimeout(options.requestRestart, 1500);
    } catch (err) {
      if (err instanceof BackupPasswordError) return res.status(400).json({ error: err.message, code: 'BACKUP_PASSWORD' });
      if (err instanceof BackupRequestError) return res.status(400).json({ error: err.message });
      res.status(500).json({ error: `복원에 실패했습니다: ${(err as Error).message}` });
    }
  });

  // ---- 자동 로컬 백업(autoBackup.ts) — 비밀 정보 없는 하루 한 벌 + 복원 직전 한 벌, 최근 7개.
  router.get('/auto', (_req, res, next) => {
    try {
      res.json(listAutoBackups());
    } catch (err) {
      next(err);
    }
  });

  router.post('/auto', async (_req, res, next) => {
    try {
      res.json(await createAutoBackup('daily'));
    } catch (err) {
      next(err);
    }
  });

  // 자동 백업으로 되돌린다. 이름은 autoBackup.ts의 형식만 받는다(경로 조작 방지). 자동 백업엔 비밀 정보가 없어 지금 PC의
  // API 키·Google 연결은 그대로 남는다(restoreBackupZip의 'not-in-backup').
  router.post('/auto/:name/restore', async (req, res, next) => {
    try {
      let buf: Buffer;
      try {
        buf = readAutoBackup(req.params.name);
      } catch {
        return res.status(404).json({ error: '그 자동 백업을 찾을 수 없습니다.' });
      }
      await createAutoBackup('before-restore').catch((err) => console.error('[backup] 복원 전 자동 백업 실패:', err));
      const result = await restoreBackupZip(buf);
      const restarting = Boolean(options.requestRestart);
      res.json({ ...result, restarting });
      if (options.requestRestart) setTimeout(options.requestRestart, 1500);
    } catch (err) {
      if (err instanceof BackupRequestError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  return router;
}
