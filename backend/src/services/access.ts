import { createHash } from 'node:crypto';
import { AppPage, UserRole } from '@prisma/client';

export const ALL_PAGES: AppPage[] = [AppPage.DASHBOARD, AppPage.SCAN, AppPage.PEOPLE, AppPage.IMPORT, AppPage.TRANSACTIONS, AppPage.REPORTS, AppPage.SETTINGS, AppPage.USER_MANAGEMENT];
const SCANNER_PAGES: AppPage[] = [AppPage.SCAN];
const REPORTER_PAGES: AppPage[] = [AppPage.DASHBOARD, AppPage.SCAN, AppPage.TRANSACTIONS, AppPage.REPORTS];

export function allowedPagesFor(role: UserRole, customPages: AppPage[]): AppPage[] {
  if (role === 'OWNER' || role === 'ADMIN') return [...ALL_PAGES];
  if (role === 'SCANNER') return [...SCANNER_PAGES];
  if (role === 'REPORTER') return [...REPORTER_PAGES];
  return customPages;
}

// Stored in the session at login. Changing a user's password changes the
// stamp, which signs out every session created with the old password.
export function credentialStamp(passwordHash: string) {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}
