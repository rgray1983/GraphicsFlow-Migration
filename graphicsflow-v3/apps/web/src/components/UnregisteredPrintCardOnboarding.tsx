import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { OnboardPrintCardInput, OnboardPrintCardResponse, UnregisteredPrintCard } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';

type RevisionDraft = OnboardPrintCardInput['revisions'][number];
type FormDraft = Pick<OnboardPrintCardInput, 'gNumber' | 'customerNumber' | 'customerName' | 'partNumber' | 'designNumber'>;
type SavedDraft = { form: FormDraft; revisions: RevisionDraft[] };
type Props = { printCard: UnregisteredPrintCard; onCreated: () => void };

const emptyForm = (): FormDraft => ({ gNumber: '', customerNumber: '', customerName: '', partNumber: '', designNumber: '' });
const emptyRevision = (label = '0'): RevisionDraft => ({ revisionLabel: label, revisionDate: '', description: '', csr: '', designer: '' });
const storageKey = (printCard: UnregisteredPrintCard) => `graphicsflow:print-card-onboarding:${printCard.specificationNumber}:${printCard.relativePath}`;

function readSavedDraft(printCard: UnregisteredPrintCard): SavedDraft {
  try {
    const saved = window.sessionStorage.getItem(storageKey(printCard));
    if (!saved) return { form: emptyForm(), revisions: [emptyRevision('0')] };
    const parsed = JSON.parse(saved) as Partial<SavedDraft>;
    const form = { ...emptyForm(), ...(parsed.form ?? {}) };
    const revisions = Array.isArray(parsed.revisions) && parsed.revisions.length ? parsed.revisions : [emptyRevision('0')];
    return { form, revisions };
  } catch {
    return { form: emptyForm(), revisions: [emptyRevision('0')] };
  }
}

export function UnregisteredPrintCardOnboarding({ printCard, onCreated }: Props) {
  const initialDraft = useMemo(() => readSavedDraft(printCard), [printCard.specificationNumber, printCard.relativePath]);
  const [form, setForm] = useState<FormDraft>(initialDraft.form);
  const [revisions, setRevisions] = useState<RevisionDraft[]>(initialDraft.revisions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageUrl = useMemo(() => `/api/revisions/unregistered-print-card?${new URLSearchParams({ relativePath: printCard.relativePath })}`, [printCard.relativePath]);
  const draftStorageKey = useMemo(() => storageKey(printCard), [printCard.specificationNumber, printCard.relativePath]);
  const linkingExistingGraphic = Boolean(form.gNumber.trim());

  useEffect(() => {
    const saved = readSavedDraft(printCard);
    setForm(saved.form);
    setRevisions(saved.revisions);
    setError(null);
  }, [printCard.specificationNumber, printCard.relativePath]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ form, revisions } satisfies SavedDraft));
    } catch {
      // Draft persistence is a convenience; the form remains usable when browser storage is unavailable.
    }
  }, [draftStorageKey, form, revisions]);

  const updateRevision = (index: number, key: keyof RevisionDraft, value: string) => {
    setRevisions((current) => current.map((revision, position) => position === index ? { ...revision, [key]: value } : revision));
  };
  const addRevision = () => {
    const highest = Math.max(-1, ...revisions.map((revision) => Number(revision.revisionLabel.match(/\d+/)?.[0] ?? -1)));
    setRevisions((current) => [...current, emptyRevision(String(highest + 1))]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    const body: OnboardPrintCardInput = { specificationNumber: printCard.specificationNumber, liveRelativePath: printCard.relativePath, ...form, revisions };
    try {
      const response = await fetch('/api/revisions/onboard-print-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json() as OnboardPrintCardResponse | { error?: string };
      if (!response.ok) throw new Error('error' in payload && payload.error ? payload.error : 'The Print Card record could not be created or linked.');
      try { window.sessionStorage.removeItem(draftStorageKey); } catch { /* no-op */ }
      onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The Print Card record could not be created or linked.'); }
    finally { setSaving(false); }
  };

  return <div className="revision-onboarding-grid">
    <section className="revision-onboarding-info">
      <p className="eyebrow">Live Print Card found</p>
      <h3>No GraphicsFlow record yet</h3>
      <p>{printCard.fileName}</p>
      <dl><div><dt>Spec #</dt><dd>{printCard.specificationNumber}</dd></div><div><dt>Modified</dt><dd>{new Date(printCard.modifiedAt).toLocaleDateString()}</dd></div></dl>
      <p className="revision-onboarding-note">Link this Print Card to an existing G#, or leave G# blank and GraphicsFlow will create the next G# using the customer and part information below.</p>
    </section>
    <section className="revision-onboarding-workspace">
      <div className="revision-onboarding-preview"><DocumentCanvas ariaLabel={`Live Print Card ${printCard.specificationNumber}`} fitScale={1} isActive renderAtLayoutScale={false}><div className="revision-document-sheet"><img alt={`Live Print Card ${printCard.specificationNumber}`} draggable={false} src={imageUrl} /></div></DocumentCanvas></div>
      <form className="revision-onboarding-form" onSubmit={submit}>
        <header><div><p className="eyebrow">Create or link record</p><h3>Connect this live Print Card</h3></div><button disabled={saving} type="submit">{saving ? 'Connecting…' : 'Create/Link Print Card'}</button></header>
        <p className="revision-onboarding-note">Enter an existing G# to link this Print Card. Leave it blank to create a new G# automatically.</p>
        <div className="revision-onboarding-fields">
          <label>Existing G# <small>(optional)</small><input placeholder="Leave blank to create a new G#" value={form.gNumber} onChange={(event) => setForm({ ...form, gNumber: event.target.value })} /></label>
          <label>Customer #<input disabled={linkingExistingGraphic} required={!linkingExistingGraphic} value={form.customerNumber} onChange={(event) => setForm({ ...form, customerNumber: event.target.value })} /></label>
          <label>Customer Name<input disabled={linkingExistingGraphic} required={!linkingExistingGraphic} value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
          <label>Part #<input disabled={linkingExistingGraphic} required={!linkingExistingGraphic} value={form.partNumber} onChange={(event) => setForm({ ...form, partNumber: event.target.value })} /></label>
          <label>Design #<input value={form.designNumber} onChange={(event) => setForm({ ...form, designNumber: event.target.value })} /></label>
        </div>
        {linkingExistingGraphic && <p className="revision-onboarding-note">The existing G#’s saved customer and part information will be used. The disabled fields above will not overwrite that record.</p>}
        <section className="revision-onboarding-history">
          <header><div><p className="eyebrow">Existing revision history</p><h4>Add every documented revision</h4></div><button onClick={addRevision} type="button">+ Add Revision</button></header>
          {revisions.map((revision, index) => <div className="revision-onboarding-row" key={index}>
            <label>Rev<input required value={revision.revisionLabel} onChange={(event) => updateRevision(index, 'revisionLabel', event.target.value)} /></label>
            <label>Date<input value={revision.revisionDate} onChange={(event) => updateRevision(index, 'revisionDate', event.target.value)} /></label>
            <label>Description<input value={revision.description} onChange={(event) => updateRevision(index, 'description', event.target.value)} /></label>
            <label>CSR<input value={revision.csr} onChange={(event) => updateRevision(index, 'csr', event.target.value)} /></label>
            <label>Designer<input value={revision.designer} onChange={(event) => updateRevision(index, 'designer', event.target.value)} /></label>
            <button aria-label={`Remove revision ${revision.revisionLabel}`} disabled={revisions.length === 1} onClick={() => setRevisions((current) => current.filter((_, position) => position !== index))} type="button">×</button>
          </div>)}
        </section>
        {error && <p className="revision-onboarding-error">{error}</p>}
      </form>
    </section>
  </div>;
}