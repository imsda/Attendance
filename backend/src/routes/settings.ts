import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { getSettings } from '../services/settingsService.js';

const router = Router();
const schema = z.object({
  schoolName: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  stationName: z.string().trim().min(1).max(100).optional(),
  scannerCooldownSeconds: z.number().min(0.25).max(30).optional(),
  scannerDiagnosticsEnabled: z.boolean().optional(),
  enableSounds: z.boolean().optional(),
  oneAttendancePerDay: z.boolean().optional(),
  hideInactiveByDefault: z.boolean().optional(),
  googleSheetsEnabled: z.boolean().optional(),
  googleSheetId: z.string().trim().max(300).optional(),
  googleRosterTabName: z.string().trim().min(1).max(100).optional(),
  googleAttendanceTabName: z.string().trim().min(1).max(100).optional(),
  googleSummaryTabName: z.string().trim().min(1).max(100).optional(),
  googleSyncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  googleAutoSyncEnabled: z.boolean().optional()
});

router.get('/', async (_req, res) => res.json(await getSettings()));
router.patch('/', async (req, res) => {
  try {
    const payload = schema.parse(req.body);
    if (payload.timezone) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone }).format(); }
      catch { return res.status(400).json({ error: 'Invalid IANA timezone.' }); }
    }
    return res.json(await prisma.setting.update({ where: { id: 1 }, data: payload }));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Invalid settings.' });
    return res.status(500).json({ error: 'Unable to save settings.' });
  }
});

export default router;
