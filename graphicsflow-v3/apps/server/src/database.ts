import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { config } from './config.js';

function resolveDatabasePath(databasePath: string): string {
  return isAbsolute(databasePath) ? databasePath : resolve(process.cwd(), databasePath);
}

const databasePath = resolveDatabasePath(config.DATABASE_PATH);

export const database = new DatabaseSync(databasePath, {
  readOnly: true,
});

export const resolvedDatabasePath = databasePath;
