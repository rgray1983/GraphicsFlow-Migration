import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { graphicsStoreDatabase } from './graphics-store.js';
import { settingsDatabasePath } from './settings-store.js';

const temporaryRoot = resolve(dirname(settingsDatabasePath), 'generated-documents', 'approvals', 'temporary');

export function clearApprovalTemporaryFilesSync(): void {
  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(temporaryRoot, { recursive: true });
  graphicsStoreDatabase.prepare(`
    UPDATE document_revisions
    SET rendered_relative_path=NULL
    WHERE rendered_relative_path LIKE 'temporary/%'
  `).run();
}
