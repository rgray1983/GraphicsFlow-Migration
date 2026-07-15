import { useEffect, useState, type FormEvent } from 'react';
import type { ApprovalRevisionDetail, ApprovalRevisionDetailResponse, ApprovalRevisionUpdate } from '@graphicsflow/shared';
import { Modal } from './Modal';
import './ApprovalRevisionEditModal.css';

type Props = {
  graphicId: number;
  revisionId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const emptyDraft: ApprovalRevisionUpdate = {
  revisionLabel: '', revisionDate: '', description: '', specificationNumber: '', designNumber: '', fluteTest: '', salesRep: '', csr: '', designer: '',
  digitalPrint: false, digitalCut: false, digitalDieCut: false, labelDieCut: false, label4cProcess: false, artworkName: '', artworkRelativePath: '',
};

export function ApprovalRevisionEditModal({ graphicId, revisionId, isOpen, onClose, onSaved }: Props) {
  const [detail, setDetail] = useState<ApprovalRevisionDetail | null>(null);
  const [draft, setDraft] = useState<ApprovalRevisionUpdate>(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !revisionId) return;
    let cancelled = false;
    setLoading(true); setError(null); setDetail(null);
    void fetch(`/api/graphics/${graphicId}/approval/revisions/${revisionId}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null) as ApprovalRevisionDetailResponse | { error?: string } | null;
        if (!response.ok) throw new Error(body && 'error' in body ? body.error : 'The Approval revision could not be loaded.');
        return body as ApprovalRevisionDetailResponse;
      })
      .then(({ revision }) => {
        if (cancelled) return;
        setDetail(revision);
        setDraft({
          revisionLabel: revision.revisionLabel, revisionDate: revision.revisionDate, description: revision.description,
          specificationNumber: revision.specificationNumber, designNumber: revision.designNumber, fluteTest: revision.fluteTest,
          salesRep: revision.salesRep, csr: revision.csr, designer: revision.designer,
          digitalPrint: revision.digitalPrint, digitalCut: revision.digitalCut, digitalDieCut: revision.digitalDieCut,
          labelDieCut: revision.labelDieCut, label4cProcess: revision.label4cProcess,
          artworkName: revision.artworkName, artworkRelativePath: revision.artworkRelativePath,
        });
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The Approval revision could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [graphicId, revisionId, isOpen]);

  const update = (key: keyof ApprovalRevisionUpdate, value: string | boolean) => {
    const normalized = typeof value === 'string' && key !== 'revisionDate' && key !== 'artworkRelativePath' ? value.toUpperCase() : value;
    setDraft((current) => ({ ...current, [key]: normalized }));
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!revisionId || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/graphics/${graphicId}/approval/revisions/${revisionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => null) as ApprovalRevisionDetailResponse | { error?: string } | null;
      if (!response.ok) throw new Error(body && 'error' in body ? body.error : 'The Approval revision could not be updated.');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Approval revision could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={saving ? () => undefined : onClose} title={`Edit Approval Revision${detail ? ` · ${detail.revisionLabel}` : ''}`}>
      <form className="approval-revision-edit" onSubmit={save}>
        {loading && <div className="approval-revision-edit-state">Loading revision information…</div>}
        {!loading && error && <div className="approval-revision-edit-error" role="alert">{error}</div>}
        {!loading && detail && <>
          <div className="approval-revision-edit-origin"><span>{detail.source === 'legacy-import' ? 'Imported PHP revision' : 'GraphicsFlow revision'}</span><small>{detail.source === 'legacy-import' ? 'Edits are saved only to V3. The PHP database is never changed.' : 'This changes the stored revision metadata used for future PDF regeneration.'}</small></div>
          <section><h3>Revision Entry</h3><div className="approval-revision-edit-grid">
            <label><span>Revision</span><input required value={draft.revisionLabel} onInput={(event) => update('revisionLabel', event.currentTarget.value)} /></label>
            <label><span>Revision Date</span><input required type="date" value={draft.revisionDate} onChange={(event) => update('revisionDate', event.target.value)} /></label>
            <label className="wide"><span>Description</span><input required value={draft.description} onInput={(event) => update('description', event.currentTarget.value)} /></label>
            <label><span>CSR</span><input required value={draft.csr} onInput={(event) => update('csr', event.currentTarget.value)} /></label>
            <label><span>Designer</span><input required value={draft.designer} onInput={(event) => update('designer', event.currentTarget.value)} /></label>
          </div></section>
          <section><h3>Approval Information</h3><div className="approval-revision-edit-grid">
            <label><span>Spec # <em>Optional</em></span><input value={draft.specificationNumber} onInput={(event) => update('specificationNumber', event.currentTarget.value)} /></label>
            <label><span>Design #</span><input required value={draft.designNumber} onInput={(event) => update('designNumber', event.currentTarget.value)} /></label>
            <label><span>Flute / Test</span><input required value={draft.fluteTest} onInput={(event) => update('fluteTest', event.currentTarget.value)} /></label>
            <label><span>Sales Rep</span><input required value={draft.salesRep} onInput={(event) => update('salesRep', event.currentTarget.value)} /></label>
          </div></section>
          <section><h3>Production Options</h3><div className="approval-revision-edit-options">
            <fieldset><legend>Digital</legend><label><input type="checkbox" checked={draft.digitalPrint} onChange={(event) => update('digitalPrint', event.target.checked)} /> Digital Print</label><label><input type="checkbox" checked={draft.digitalCut} onChange={(event) => update('digitalCut', event.target.checked)} /> Die Cut</label><label><input type="checkbox" checked={draft.digitalDieCut} onChange={(event) => update('digitalDieCut', event.target.checked)} /> Die Cut Baysek</label></fieldset>
            <fieldset><legend>Label</legend><label><input type="checkbox" checked={draft.labelDieCut} onChange={(event) => update('labelDieCut', event.target.checked)} /> Die Cut</label><label><input type="checkbox" checked={draft.label4cProcess} onChange={(event) => update('label4cProcess', event.target.checked)} /> 4-C Process</label></fieldset>
          </div></section>
          <section><h3>Artwork Reference</h3><div className="approval-revision-edit-grid"><label className="wide"><span>Artwork File</span><input value={draft.artworkName} onInput={(event) => update('artworkName', event.currentTarget.value)} /></label><label className="wide"><span>Live Artwork Path</span><input value={draft.artworkRelativePath} onInput={(event) => update('artworkRelativePath', event.currentTarget.value)} /></label></div></section>
          <footer><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving Revision…' : 'Save Revision Information'}</button></footer>
        </>}
      </form>
    </Modal>
  );
}
