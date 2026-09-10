import { Router } from 'express';
import { AttendanceResult } from '@prisma/client';
import { prisma } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const result = req.query.result === 'FAILURE' ? AttendanceResult.FAILURE : req.query.result === 'SUCCESS' ? AttendanceResult.SUCCESS : undefined;
  const rows = await prisma.attendance.findMany({
    where: {
      ...(result ? { result } : {}),
      ...(query ? { OR: [
        { scannedValue: { contains: query } },
        { student: { is: { OR: [{ studentId: { contains: query } }, { firstName: { contains: query } }, { lastName: { contains: query } }] } } }
      ] } : {})
    },
    include: { student: true, adminUser: { select: { username: true } } },
    orderBy: { timestamp: 'desc' },
    take: 500
  });
  res.json(rows);
});

export default router;
