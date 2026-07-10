import { access, stat } from 'node:fs/promises';
import { constants, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  companySettingsInputSchema,
  companySettingsSchema,
  pathValidationResponseSchema,
  type CompanySettings,
  type CompanySettingsInput,
  type PathStatus,
  type StorageSettings,
} from '@graphicsflow/shared';
import { config } from './config.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, '../../..');
const storageRoot = isAbsolute(config.STORAGE_ROOT)
  ? config.STORAGE_ROOT
  : resolve(projectRoot, config.STORAGE_ROOT);

mkdirSync(storageRoot, { recursive: true });

const settingsDatabasePath = resolve(storageRoot, 'graphicsflow-v3.db');
const settingsDatabase = new DatabaseSync(settingsDatabasePath);

settingsDatabase.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const defaultSettings: CompanySettings = {
  company: {
    name: 'Hood Container Corporation',
    plantName: 'Sumter',
    logoPath: '',
  },
  branding: {
    primaryColor: '#14B8A6',
    secondaryColor: '#0F172A',
    accentColor: '#99F6E4',
    theme: 'dark',
  },
  identifiers: {
    graphics: { label: 'G#', prefix: 'G#', separator: '' },
    specification: { label: 'S#', prefix: 'S#', separator: '' },
    design: { label: 'D#', prefix: 'D#', separator: '' },
    printCard: { label: 'Print Card', prefix: '', separator: '' },
    factoryTicketMini: { label: 'Factory Ticket Mini', prefix: '', separator: '' },
  },
  storage: {
    aiRoot: config.AI_ROOT || '/Volumes/Artwork/GRAPHIC FILES #/ART FILES (Ai)',
    pdfRoot: config.PDF_ROOT || '/Volumes/Artwork/GRAPHIC FILES #/PDF',
    approvalsRoot: config.APPROVALS_ROOT || '/Volumes/Artwork/GRAPHIC FILES #/APPROVALS',
    printCardsRoot: config.PRINT_CARD_IMAGE_ROOT || '/Volumes/Artios/Image1',
    vendorApprovalsRoot: config.VENDOR_APPROVALS_ROOT || '',
  },
  updatedAt: null,
};

export function getCompanySettings(): CompanySettings {
  const row = settingsDatabase
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('company') as { value: string } | undefined;

  if (!row) return defaultSettings;

  try {
    return companySettingsSchema.parse(JSON.parse(row.value));
  } catch {
    return defaultSettings;
  }
}

export function saveCompanySettings(input: CompanySettingsInput): CompanySettings {
  const parsed = companySettingsInputSchema.parse(input);
  const settings: CompanySettings = {
    ...parsed,
    updatedAt: new Date().toISOString(),
  };

  settingsDatabase.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run('company', JSON.stringify(settings), settings.updatedAt);

  return settings;
}

const pathLabels: Record<keyof StorageSettings, string> = {
  aiRoot: 'Illustrator artwork',
  pdfRoot: 'PDF artwork',
  approvalsRoot: 'Approvals',
  printCardsRoot: 'Print cards / factory tickets',
  vendorApprovalsRoot: 'Vendor approvals',
};

async function inspectPath(key: keyof StorageSettings, path: string): Promise<PathStatus> {
  if (!path) {
    return {
      key,
      label: pathLabels[key],
      path,
      configured: false,
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
      message: 'Not configured',
    };
  }

  try {
    const information = await stat(path);
    const isDirectory = information.isDirectory();
    let readable = false;
    let writable = false;

    if (isDirectory) {
      readable = await access(path, constants.R_OK).then(() => true).catch(() => false);
      writable = await access(path, constants.W_OK).then(() => true).catch(() => false);
    }

    return {
      key,
      label: pathLabels[key],
      path,
      configured: true,
      exists: true,
      isDirectory,
      readable,
      writable,
      message: isDirectory
        ? readable
          ? writable ? 'Connected · read and write' : 'Connected · read only'
          : 'Folder found but not readable'
        : 'Path exists but is not a folder',
    };
  } catch {
    return {
      key,
      label: pathLabels[key],
      path,
      configured: true,
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
      message: 'Folder not found from this server',
    };
  }
}

export async function validateStoragePaths(storage: StorageSettings) {
  const entries = Object.entries(storage) as [keyof StorageSettings, string][];
  const items = await Promise.all(entries.map(([key, path]) => inspectPath(key, path)));
  return pathValidationResponseSchema.parse({ items, checkedAt: new Date().toISOString() });
}

export { settingsDatabasePath };
