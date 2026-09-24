import { Router } from 'express';
import { z } from 'zod';
import { processAttendance } from '../services/attendanceService.js';
import { searchStudents } from '../services/searchStudents.js';
import { getSettings } from '../services/settingsService.js';
import { prisma } from '../db.js';

const router = Router();

router.get('/config', async (req, res) => {
  const settings = await getSettings();
  const user = await prisma.adminUser.findUnique({ where: { id: req.session.adminUserId }, select: { scannerCooldownSeconds: true } });
  res.json({
    scannerCooldownSeconds: user?.scannerCooldownSeconds ?? settings.scannerCooldownSeconds,
    scannerCooldownDefaultSeconds: settings.scannerCooldownSeconds,
    scannerDiagnosticsEnabled: settings.scannerDiagnosticsEnabled,
    enableSounds: settings.enableSounds,
    chapelScanWindowEnabled: settings.chapelScanWindowEnabled,
    chapelScanStartTime: settings.chapelScanStartTime,
    chapelScanEndTime: settings.chapelScanEndTime
  });
});

router.patch('/config', async (req, res) => {
  const payload = z.object({ scannerCooldownSeconds: z.number().min(0.25).max(30).nullable() }).parse(req.body);
  await prisma.adminUser.update({
    where: { id: req.session.adminUserId },
    data: { scannerCooldownSeconds: payload.scannerCooldownSeconds }
  });
  const settings = await getSettings();
  return res.json({
    scannerCooldownSeconds: payload.scannerCooldownSeconds ?? settings.scannerCooldownSeconds,
    scannerCooldownDefaultSeconds: settings.scannerCooldownSeconds
  });
});

router.get('/students', async (req, res) => {
  try {
    return res.json(await searchStudents(typeof req.query.q === 'string' ? req.query.q : ''));
  } catch (error) {
    console.error('[STUDENT_SEARCH]', error);
    return res.status(500).json({ error: 'Unable to search students.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = z.object({ scannedValue: z.string().trim().min(1).max(200) }).parse(req.body);
    const result = await processAttendance(payload.scannedValue, req.session.adminUserId);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'A barcode or student ID is required.' });
    console.error('[ATTENDANCE_SCAN]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to record attendance.' });
  }
});

export default router;
