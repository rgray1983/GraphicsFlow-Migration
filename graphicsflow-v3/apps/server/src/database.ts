import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
import { config } from './config.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, '../../..');

function resolveDatabasePath(databasePath: string): string {
  return isAbsolute(databasePath) ? databasePath : resolve(projectRoot, databasePath);
}

const databasePath = resolveDatabasePath(config.DATABASE_PATH);

export const database = new DatabaseSync(databasePath, {
  readOnly: true,
});

export const resolvedDatabasePath = databasePath;
