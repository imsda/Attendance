import { Router } from 'express';
import { importGoogleRoster, syncGoogleSheets, writeBackGoogleSheets, ROSTER_HEADERS } from '../services/googleSheetsService.js';
import { getSettings } from '../services/settingsService.js';

const router = Router();

router.get('/status', async (_req, res) => {
  const settings = await getSettings();
  res.json({
    enabled: settings.googleSheetsEnabled,
    autoSyncEnabled: settings.googleAutoSyncEnabled,
    lastSyncAt: settings.googleLastSyncAt,
    lastSyncSummary: settings.googleLastSyncSummary,
    credentialsConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
  });
});

router.post('/sync', async (_req, res) => {
  try { return res.json(await syncGoogleSheets()); }
  catch (error) {
    console.error('[GOOGLE_SYNC_MANUAL]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Google Sheets sync failed.' });
  }
});

router.post('/import-roster', async (_req, res) => {
  try { return res.json(await importGoogleRoster()); }
  catch (error) {
    console.error('[GOOGLE_ROSTER_IMPORT]', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Google roster import failed.' });
  }
});

router.post('/write-back', async (_req, res) => {
  try { return res.json(await writeBackGoogleSheets()); }
  catch (error) {
    console.error('[GOOGLE_WRITE_BACK]', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Google Sheet write-back failed.' });
  }
});

router.get('/template', (_req, res) => {
  res.type('text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="chapel-student-roster.csv"');
  res.send(`${ROSTER_HEADERS.join(',')}\n`);
});

export default router;
