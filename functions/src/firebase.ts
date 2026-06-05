import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
if (getApps().length === 0) initializeApp();
export const db = getDatabase();
