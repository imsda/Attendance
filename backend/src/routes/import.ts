import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { prisma } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function value(row: Record<string, unknown>, ...keys: string[]) {
  const actual = Object.keys(row).find((key) => keys.includes(key.trim().toLowerCase().replace(/[_-]+/g, ' ')));
  return actual ? String(row[actual] ?? '').trim() : '';
}

router.post('/csv', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV file.' });
  let records: Record<string, unknown>[];
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    return res.status(400).json({ error: 'The CSV could not be read.' });
  }
  let imported = 0;
  const errors: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const row = records[index];
    const studentId = value(row, 'student id', 'id');
    const firstName = value(row, 'first name');
    const lastName = value(row, 'last name');
    if (!studentId || !firstName || !lastName) {
      errors.push(`Row ${index + 2}: Student ID, First Name, and Last Name are required.`);
      continue;
    }
    const barcode = value(row, 'barcode') || studentId;
    const activeValue = value(row, 'active').toLowerCase();
    try {
      await prisma.student.upsert({
        where: { studentId },
        create: { studentId, barcode, firstName, lastName, grade: value(row, 'grade') || null, active: !['false', 'no', '0', 'inactive'].includes(activeValue) },
        update: { barcode, firstName, lastName, grade: value(row, 'grade') || null, active: !['false', 'no', '0', 'inactive'].includes(activeValue) }
      });
      imported += 1;
    } catch { errors.push(`Row ${index + 2}: Student ID or barcode conflicts with another student.`); }
  }
  await prisma.importHistory.create({ data: { source: req.file.originalname, totalRows: records.length, successRows: imported, failedRows: errors.length, errorSummary: errors.slice(0, 20).join('\n') || null } });
  res.json({ imported, failed: errors.length, errors });
});

export default router;
