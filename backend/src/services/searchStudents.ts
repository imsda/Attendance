import { prisma } from '../db.js';

export async function searchStudents(query: string, take = 20) {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const students = await prisma.student.findMany({
    where: {
      active: true,
      OR: [
        { studentId: { contains: q } },
        { barcode: { contains: q } },
        { AND: words.map((word) => ({ OR: [{ firstName: { contains: word } }, { lastName: { contains: word } }] })) }
      ]
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take,
    select: { id: true, studentId: true, barcode: true, firstName: true, lastName: true, grade: true }
  });
  return students;
}
