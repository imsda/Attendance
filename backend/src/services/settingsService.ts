import { prisma } from '../db.js';

let initialization: Promise<void> | null = null;

export async function ensureSettingsInitialized() {
  if (!initialization) {
    initialization = prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {}
    }).then(() => undefined).catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}

export async function getSettings() {
  await ensureSettingsInitialized();
  return prisma.setting.findUniqueOrThrow({ where: { id: 1 } });
}
