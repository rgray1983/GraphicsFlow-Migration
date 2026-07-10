import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompanySettings,
  CompanySettingsInput,
  FileIndexJobStatus,
  IdentifierConfig,
  PathValidationResponse,
  StorageSettings,
} from '@graphicsflow/shared';
import { useEffect, useMemo, useState } from 'react';
import './SettingsPage.css';

async function loadSettings(): Promise<CompanySettings> {
  const response = await fetch('/api/settings/company');
  if (!response.ok) throw new Error('Company settings could not be loaded.');
  return response.json() as Promise<CompanySettings>;
}

async function saveSettings(settings: CompanySettingsInput): Promise<CompanySettings> {
  const response = await fetch('/api/settings/company', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('Company settings could not be saved.');
  return response.json() as Promise<CompanySettings>;
}

async function validatePaths(storage: StorageSettings): Promise<PathValidationResponse> {
  const response = await fetch('/api/settings/validate-paths', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(storage),
  });
  if (!response.ok) throw new Error('Storage paths could not be checked.');
  return response.json() as Promise<PathValidationResponse>;
}

async function startFileIndex(): Promise<FileIndexJobStatus> {
  const response = await fetch('/api/settings/file-index/refresh', { method: 'POST' });
  if (!response.ok) throw new Error('Live file index could not be started.');
  return response.json() as Promise<FileIndexJobStatus>;
}

async function loadFileIndexStatus(): Promise<FileIndexJobStatus> {
  const response = await fetch('/api/settings/file-index/status');
  if (!response.ok) throw new Error('Live file index status could not be loaded.');
  return response.json() as Promise<FileIndexJobStatus>;
}

function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined) return 'Calculating…';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const identifierRows = [
  ['graphics', 'Graphics Number', '12905'],
  ['specification', 'Specification Number', '48291'],
  ['design', 'Design Number', '7712'],
  ['printCard', 'Print Card', '12905'],
  ['factoryTicketMini', 'Factory Ticket Mini', '12905'],
] as const;

const storageRows = [
  ['aiRoot', 'Illustrator Artwork', 'Folder containing live Adobe Illustrator artwork files.'],
  ['pdfRoot', 'PDF Artwork', 'Folder containing browser-friendly or production PDF artwork.'],
  ['approvalsRoot', 'Approvals', 'Folder containing current approvals and approval revisions.'],
  ['printCardsRoot', 'Print Cards / Factory Tickets', 'Folder containing generated print-card and factory-ticket images.'],
  ['vendorApprovalsRoot', 'Vendor Approvals', 'Folder containing vendor-supplied approval documents.'],
] as const;

type SettingsSection = 'company' | 'branding' | 'identifiers' | 'storage' | 'fileIndex';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['company-settings'], queryFn: loadSettings });
  const indexStatusQuery = useQuery({
    queryKey: ['file-index-status'],
    queryFn: loadFileIndexStatus,
    refetchInterval: (query) => query.state.data?.status === 'running' ? 1000 : false,
  });
  const [draft, setDraft] = useState<CompanySettingsInput | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>('company');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (settingsQuery.data) {
      const { updatedAt: _updatedAt, ...editable } = settingsQuery.data;
      setDraft(editable);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    const status = indexStatusQuery.data;
    if (status?.status === 'completed' && status.result) {
      queryClient.invalidateQueries({ queryKey: ['graphic-files'] });
    }
  }, [indexStatusQuery.data, queryClient]);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(['company-settings'], saved);
      setNotice('Settings saved.');
      window.setTimeout(() => setNotice(''), 2500);
    },
  });
  const pathMutation = useMutation({ mutationFn: validatePaths });
  const indexMutation = useMutation({
    mutationFn: startFileIndex,
    onSuccess: (status) => {
      queryClient.setQueryData(['file-index-status'], status);
      setNotice(status.status === 'running' ? 'File indexing started in the background.' : 'File index is already running.');
      window.setTimeout(() => setNotice(''), 3000);
    },
  });

  const dirty = useMemo(() => {
    if (!draft || !settingsQuery.data) return false;
    const { updatedAt: _updatedAt, ...saved } = settingsQuery.data;
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }, [draft, settingsQuery.data]);

  if (settingsQuery.isPending || !draft) return <section className="settings-state">Loading company settings…</section>;
  if (settingsQuery.isError) return <section className="settings-state settings-state-error">Company settings could not be loaded.</section>;

  const updateIdentifier = (key: keyof CompanySettingsInput['identifiers'], value: IdentifierConfig) => {
    setDraft((current) => current ? { ...current, identifiers: { ...current.identifiers, [key]: value } } : current);
  };
  const setStorageValue = (key: keyof StorageSettings, value: string) => {
    setDraft((current) => current ? { ...current, storage: { ...current.storage, [key]: value } } : current);
  };

  const indexStatus = indexStatusQuery.data;
  const indexRunning = indexStatus?.status === 'running';
  const progress = indexStatus?.progress;
  const progressLabel = progress?.phase === 'approvals'
    ? 'Scanning approvals'
    : progress?.phase === 'printCards'
      ? 'Scanning print cards'
      : progress?.phase === 'finalizing'
        ? 'Finalizing index'
        : 'Preparing index';
  const lastResult = indexStatus?.result;

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <div><p className="eyebrow">Administration</p><h2>Company Settings</h2><p>Configure identity, branding, record prefixes, and the live folders GraphicsFlow is allowed to use.</p></div>
        <div className="settings-save-area">
          <span className={dirty ? 'unsaved-indicator is-dirty' : 'unsaved-indicator'}>{dirty ? 'Unsaved changes' : notice || 'Up to date'}</span>
          <button className="primary-button" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate(draft)} type="button">{saveMutation.isPending ? 'Saving…' : 'Save Settings'}</button>
        </div>
      </div>

      <div className="settings-workspace">
        <nav className="settings-nav" aria-label="Company settings sections">
          {([['company', 'Company Profile'], ['branding', 'Branding'], ['identifiers', 'Identifiers'], ['storage', 'Storage & Files'], ['fileIndex', 'File Index']] as const).map(([key, label]) => (
            <button className={activeSection === key ? 'active' : ''} key={key} onClick={() => setActiveSection(key)} type="button">{label}</button>
          ))}
          <div className="settings-nav-future"><span>Coming in later PRs</span><button disabled type="button">Users</button><button disabled type="button">Roles & Permissions</button></div>
        </nav>

        <div className="settings-content">
          {activeSection === 'company' && <div className="settings-panel"><div className="settings-panel-heading"><h3>Company Profile</h3><p>These values identify the company and plant throughout GraphicsFlow.</p></div><div className="settings-form-grid"><label><span>Company Name</span><input value={draft.company.name} onChange={(event) => setDraft({ ...draft, company: { ...draft.company, name: event.target.value } })} /></label><label><span>Plant / Location</span><input value={draft.company.plantName} onChange={(event) => setDraft({ ...draft, company: { ...draft.company, plantName: event.target.value } })} /></label><label className="full-field"><span>Logo File Path or URL</span><input placeholder="Optional" value={draft.company.logoPath} onChange={(event) => setDraft({ ...draft, company: { ...draft.company, logoPath: event.target.value } })} /><small>Logo upload and asset management will be connected later. This field establishes the stored source now.</small></label></div></div>}

          {activeSection === 'branding' && <div className="settings-panel"><div className="settings-panel-heading"><h3>Branding</h3><p>Set the core colors that future themes and company-branded documents will use.</p></div><div className="color-settings-grid">{([['primaryColor', 'Primary Color'], ['secondaryColor', 'Secondary Color'], ['accentColor', 'Accent Color']] as const).map(([key, label]) => <label className="color-field" key={key}><span>{label}</span><div><input aria-label={`${label} picker`} type="color" value={draft.branding[key]} onChange={(event) => setDraft({ ...draft, branding: { ...draft.branding, [key]: event.target.value.toUpperCase() } })} /><input value={draft.branding[key]} onChange={(event) => setDraft({ ...draft, branding: { ...draft.branding, [key]: event.target.value.toUpperCase() } })} /></div></label>)}</div><label className="theme-field"><span>Theme Preference</span><select value={draft.branding.theme} onChange={(event) => setDraft({ ...draft, branding: { ...draft.branding, theme: event.target.value as CompanySettingsInput['branding']['theme'] } })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow System</option></select></label></div>}

          {activeSection === 'identifiers' && <div className="settings-panel"><div className="settings-panel-heading"><h3>Identifiers</h3><p>Labels and prefixes are separate. Leave a prefix blank when a plant uses only the numeric value.</p></div><div className="identifier-list">{identifierRows.map(([key, name, sample]) => { const item = draft.identifiers[key]; const example = `${item.prefix}${item.separator}${sample}`; return <div className="identifier-row" key={key}><div className="identifier-name"><strong>{name}</strong><span>Example: {example || sample}</span></div><label><span>Display Label</span><input value={item.label} onChange={(event) => updateIdentifier(key, { ...item, label: event.target.value })} /></label><label><span>Prefix</span><input placeholder="No prefix" value={item.prefix} onChange={(event) => updateIdentifier(key, { ...item, prefix: event.target.value })} /></label><label><span>Separator</span><input placeholder="None" value={item.separator} onChange={(event) => updateIdentifier(key, { ...item, separator: event.target.value })} /></label></div>; })}</div></div>}

          {activeSection === 'storage' && (
            <div className="settings-panel">
              <div className="settings-panel-heading storage-heading"><div><h3>Storage & Files</h3><p>GraphicsFlow will only access these approved server locations.</p></div><button className="secondary-button" disabled={pathMutation.isPending} onClick={() => pathMutation.mutate(draft.storage)} type="button">{pathMutation.isPending ? 'Checking…' : 'Check Connections'}</button></div>
              <div className="storage-list">{storageRows.map(([key, label, description]) => { const status = pathMutation.data?.items.find((item) => item.key === key); return <label className="storage-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><input placeholder="Not configured" value={draft.storage[key]} onChange={(event) => setStorageValue(key, event.target.value)} /><span className={`path-status ${status ? (status.readable ? 'is-connected' : 'is-error') : ''}`}>{status?.message || 'Not checked'}</span></label>; })}</div>
              <p className="storage-note">Save changed folder paths before refreshing the File Index.</p>
            </div>
          )}

          {activeSection === 'fileIndex' && (
            <div className="settings-panel file-index-panel">
              <div className="settings-panel-heading file-index-heading">
                <div><h3>File Index</h3><p>GraphicsFlow indexes live approval and print-card metadata so G# records open instantly without crawling the network on every click.</p></div>
                <button className="secondary-button" disabled={dirty || indexRunning || indexMutation.isPending} onClick={() => indexMutation.mutate()} type="button">{indexRunning ? 'Indexing in Background…' : 'Refresh Index'}</button>
              </div>

              <div className={`file-index-status-card status-${indexStatus?.status ?? 'idle'}`}>
                <div className="file-index-status-top">
                  <div><span className="file-index-status-dot" /><strong>{indexRunning ? progressLabel : indexStatus?.status === 'completed' ? 'Index ready' : indexStatus?.status === 'failed' ? 'Index failed' : 'Index not started'}</strong></div>
                  <span>{progress?.progressPercent !== null && progress?.progressPercent !== undefined ? `${Math.round(progress.progressPercent)}%` : indexRunning ? 'Scanning…' : ''}</span>
                </div>

                <div className={`file-index-progress${progress?.progressPercent === null || progress?.progressPercent === undefined ? ' is-indeterminate' : ''}`}>
                  <span style={progress?.progressPercent !== null && progress?.progressPercent !== undefined ? { width: `${progress.progressPercent}%` } : undefined} />
                </div>

                <div className="file-index-metrics">
                  <div><span>Files Discovered</span><strong>{(progress?.discoveredFiles ?? lastResult?.totalCount ?? 0).toLocaleString()}</strong></div>
                  <div><span>Entries Examined</span><strong>{(progress?.scannedEntries ?? 0).toLocaleString()}</strong></div>
                  <div><span>Elapsed</span><strong>{formatDuration(progress?.elapsedMs ?? lastResult?.durationMs)}</strong></div>
                  <div><span>Estimated Remaining</span><strong>{indexRunning ? formatDuration(progress?.estimatedRemainingMs) : '—'}</strong></div>
                </div>

                {indexStatus?.status === 'completed' && lastResult && (
                  <div className="file-index-breakdown">
                    <span>Approvals <strong>{lastResult.approvalCount.toLocaleString()}</strong></span>
                    <span>Print Cards <strong>{lastResult.printCardCount.toLocaleString()}</strong></span>
                    <span>Last Updated <strong>{formatDateTime(lastResult.indexedAt)}</strong></span>
                  </div>
                )}

                {indexStatus?.status === 'failed' && <p className="file-index-error">{indexStatus.error || 'The index could not be completed.'}</p>}
                {indexRunning && <p className="file-index-note">The server owns this job. You can leave this page or close the browser while GraphicsFlow continues indexing.</p>}
              </div>

              <div className="preview-cache-card">
                <div><span className="eyebrow">Preview Cache</span><h4>Foundation ready</h4><p>GraphicsFlow now tracks source file fingerprints and invalidates stale preview records when indexed files change. Approval rendering and artwork cropping will connect to this cache in the viewer PR.</p></div>
                <span className="availability-badge is-connected">Ready</span>
              </div>
            </div>
          )}

          {(saveMutation.isError || pathMutation.isError || indexMutation.isError || indexStatusQuery.isError) && <div className="settings-error">{saveMutation.error?.message || pathMutation.error?.message || indexMutation.error?.message || indexStatusQuery.error?.message}</div>}
        </div>
      </div>
    </section>
  );
}
