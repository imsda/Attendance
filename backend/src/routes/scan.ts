import { Router } from 'express';
import { z } from 'zod';
import { processAttendance } from '../services/attendanceService.js';
import { searchStudents } from '../services/searchStudents.js';

const router = Router();

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
