import { useMemo, useState, type FormEvent } from 'react';
import type { OnboardPrintCardInput, OnboardPrintCardResponse, UnregisteredPrintCard } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';

type RevisionDraft = OnboardPrintCardInput['revisions'][number];
type Props = { printCard: UnregisteredPrintCard; onCreated: () => void };

const emptyRevision = (label = '0'): RevisionDraft => ({ revisionLabel: label, revisionDate: '', description: '', csr: '', designer: '' });

export function UnregisteredPrintCardOnboarding({ printCard, onCreated }: Props) {
  const [form, setForm] = useState({ gNumber: '', customerNumber: '', customerName: '', partNumber: '', designNumber: '' });
  const [revisions, setRevisions] = useState<RevisionDraft[]>([emptyRevision('0')]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageUrl = useMemo(() => `/api/revisions/unregistered-print-card?${new URLSearchParams({ relativePath: printCard.relativePath })}`, [printCard.relativePath]);

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
      if (!response.ok) throw new Error('error' in payload && payload.error ? payload.error : 'The Print Card record could not be created.');
      onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The Print Card record could not be created.'); }
    finally { setSaving(false); }
  };

  return <div className="revision-onboarding-grid">
    <section className="revision-onboarding-info">
      <p className="eyebrow">Live Print Card found</p>
      <h3>No GraphicsFlow record yet</h3>
      <p>{printCard.fileName}</p>
      <dl><div><dt>Spec #</dt><dd>{printCard.specificationNumber}</dd></div><div><dt>Modified</dt><dd>{new Date(printCard.modifiedAt).toLocaleDateString()}</dd></div></dl>
      <p className="revision-onboarding-note">Create the record and enter all known historical revisions. The highest revision will become current, and the next new Print Card will continue from it.</p>
    </section>
    <section className="revision-onboarding-workspace">
      <div className="revision-onboarding-preview"><DocumentCanvas ariaLabel={`Live Print Card ${printCard.specificationNumber}`} fitScale={1} isActive renderAtLayoutScale={false}><div className="revision-document-sheet"><img alt={`Live Print Card ${printCard.specificationNumber}`} draggable={false} src={imageUrl} /></div></DocumentCanvas></div>
      <form className="revision-onboarding-form" onSubmit={submit}>
        <header><div><p className="eyebrow">Create record</p><h3>Connect this live Print Card</h3></div><button disabled={saving} type="submit">{saving ? 'Creating…' : 'Create Record'}</button></header>
        <div className="revision-onboarding-fields">
          <label>G#<input required value={form.gNumber} onChange={(event) => setForm({ ...form, gNumber: event.target.value })} /></label>
          <label>Customer #<input required value={form.customerNumber} onChange={(event) => setForm({ ...form, customerNumber: event.target.value })} /></label>
          <label>Customer Name<input required value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
          <label>Part #<input required value={form.partNumber} onChange={(event) => setForm({ ...form, partNumber: event.target.value })} /></label>
          <label>Design #<input value={form.designNumber} onChange={(event) => setForm({ ...form, designNumber: event.target.value })} /></label>
        </div>
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
