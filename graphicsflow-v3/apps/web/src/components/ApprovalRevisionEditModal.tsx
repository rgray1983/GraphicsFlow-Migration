import { useEffect, useState, type FormEvent } from 'react';
import type { ApprovalRevisionDetail, ApprovalRevisionDetailResponse, ApprovalRevisionUpdate, PrintCardArtworkMatch, PrintCardArtworkMatchesResponse } from '@graphicsflow/shared';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';
import './ApprovalRevisionEditModal.css';

type Props = {
  graphicId: number;
  revisionId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type Mode = 'information' | 'artwork';

const emptyDraft: ApprovalRevisionUpdate = {
  revisionLabel: '', revisionDate: '', description: '', specificationNumber: '', designNumber: '', fluteTest: '', salesRep: '', csr: '', designer: '',
  digitalPrint: false, digitalCut: false, digitalDieCut: false, labelDieCut: false, label4cProcess: false, artworkName: '', artworkRelativePath: '',
};

export function ApprovalRevisionEditModal({ graphicId, revisionId, isOpen, onClose, onSaved }: Props) {
  const [detail, setDetail] = useState<ApprovalRevisionDetail | null>(null);
  const [draft, setDraft] = useState<ApprovalRevisionUpdate>(emptyDraft);
  const [mode, setMode] = useState<Mode>('information');
  const [matches, setMatches] = useState<PrintCardArtworkMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !revisionId) return;
    let cancelled = false;
    setMode('information'); setLoading(true); setError(null); setDetail(null); setMatches([]);
    void Promise.all([
      fetch(`/api/graphics/${graphicId}/approval/revisions/${revisionId}`).then(async (response) => {
        const body = await response.json().catch(() => null) as ApprovalRevisionDetailResponse | { error?: string } | null;
        if (!response.ok) throw new Error(body && 'error' in body ? body.error : 'The Approval revision could not be loaded.');
        return body as ApprovalRevisionDetailResponse;
      }),
      fetch(`/api/graphics/${graphicId}/print-card/artwork-matches`).then(async (response) => response.ok ? response.json() as Promise<PrintCardArtworkMatchesResponse> : null),
    ]).then(([{ revision }, artwork]) => {
      if (cancelled) return;
      setDetail(revision);
      setMatches(artwork?.matches ?? []);
      setDraft({
        revisionLabel: revision.revisionLabel, revisionDate: revision.revisionDate, description: revision.description,
        specificationNumber: revision.specificationNumber, designNumber: revision.designNumber, fluteTest: revision.fluteTest,
        salesRep: revision.salesRep, csr: revision.csr, designer: revision.designer,
        digitalPrint: revision.digitalPrint, digitalCut: revision.digitalCut, digitalDieCut: revision.digitalDieCut,
        labelDieCut: revision.labelDieCut, label4cProcess: revision.label4cProcess,
        artworkName: revision.artworkName, artworkRelativePath: revision.artworkRelativePath,
      });
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The Approval revision could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [graphicId, revisionId, isOpen]);

  const update = (key: keyof ApprovalRevisionUpdate, value: string | boolean) => {
    const normalized = typeof value === 'string' && key !== 'revisionDate' && key !== 'artworkRelativePath' ? value.toUpperCase() : value;
    setDraft((current) => ({ ...current, [key]: normalized }));
    setError(null);
  };

  const selectArtwork = (match: PrintCardArtworkMatch) => {
    setDraft((current) => ({ ...current, artworkName: match.name, artworkRelativePath: match.relativePath }));
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!revisionId || saving) return;
    setSaving(true); setError(null);
    try {
      const payload = mode === 'artwork' && detail
        ? { ...detail, artworkName: draft.artworkName, artworkRelativePath: draft.artworkRelativePath }
        : draft;
      const response = await fetch(`/api/graphics/${graphicId}/approval/revisions/${revisionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as ApprovalRevisionDetailResponse | { error?: string } | null;
      if (!response.ok) throw new Error(body && 'error' in body ? body.error : 'The Approval revision could not be updated.');
      onSaved(); onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Approval revision could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={saving ? () => undefined : onClose} title={`Edit Approval Revision${detail ? ` · ${detail.revisionLabel}` : ''}`}>
      <form className="approval-revision-edit" onSubmit={save}>
        <div className="approval-revision-edit-tabs" role="tablist">
          <button aria-selected={mode === 'information'} className={mode === 'information' ? 'active' : ''} onClick={() => setMode('information')} role="tab" type="button"><strong>Edit Information</strong><span>Revision data and production options</span></button>
          <button aria-selected={mode === 'artwork'} className={mode === 'artwork' ? 'active' : ''} onClick={() => setMode('artwork')} role="tab" type="button"><strong>Replace Artwork Only</strong><span>Keep every revision field unchanged</span></button>
        </div>
        <div className="approval-revision-edit-body">
          {loading && <LoadingIndicator title="Loading Revision" message="Loading the saved Approval information and matching artwork PDFs…" size="panel" />}
          {!loading && error && <div className="approval-revision-edit-error" role="alert">{error}</div>}
          {!loading && detail && <>
            <div className="approval-revision-edit-origin"><span>{detail.source === 'legacy-import' ? 'Imported PHP revision' : 'GraphicsFlow revision'}</span><small>{detail.source === 'legacy-import' ? 'Edits are saved only to V3. The PHP database is never changed.' : 'Saved metadata is used whenever this Approval is regenerated.'}</small></div>
            {mode === 'information' ? <div className="approval-revision-edit-sections">
              <section><header><span>01</span><div><h3>Revision Entry</h3><p>The identifying information for this saved revision.</p></div></header><div className="approval-revision-edit-grid">
                <label><span>Revision</span><input required value={draft.revisionLabel} onInput={(event) => update('revisionLabel', event.currentTarget.value)} /></label>
                <label><span>Revision Date</span><input required type="date" value={draft.revisionDate} onChange={(event) => update('revisionDate', event.target.value)} /></label>
                <label className="wide"><span>Description</span><input required value={draft.description} onInput={(event) => update('description', event.currentTarget.value)} /></label>
                <label><span>CSR</span><input required value={draft.csr} onInput={(event) => update('csr', event.currentTarget.value)} /></label>
                <label><span>Designer</span><input required value={draft.designer} onInput={(event) => update('designer', event.currentTarget.value)} /></label>
              </div></section>
              <section><header><span>02</span><div><h3>Approval Information</h3><p>The header fields used to rebuild the finished Approval.</p></div></header><div className="approval-revision-edit-grid">
                <label><span>Spec # <em>Optional</em></span><input value={draft.specificationNumber} onInput={(event) => update('specificationNumber', event.currentTarget.value)} /></label>
                <label><span>Design #</span><input required value={draft.designNumber} onInput={(event) => update('designNumber', event.currentTarget.value)} /></label>
                <label><span>Flute / Test</span><input required value={draft.fluteTest} onInput={(event) => update('fluteTest', event.currentTarget.value)} /></label>
                <label><span>Sales Rep</span><input required value={draft.salesRep} onInput={(event) => update('salesRep', event.currentTarget.value)} /></label>
              </div></section>
              <section><header><span>03</span><div><h3>Production Options</h3><p>Optional Digital and Label selections.</p></div></header><div className="approval-revision-edit-options">
                <fieldset><legend>Digital</legend><label><input type="checkbox" checked={draft.digitalPrint} onChange={(event) => update('digitalPrint', event.target.checked)} /> Digital Print</label><label><input type="checkbox" checked={draft.digitalCut} onChange={(event) => update('digitalCut', event.target.checked)} /> Die Cut</label><label><input type="checkbox" checked={draft.digitalDieCut} onChange={(event) => update('digitalDieCut', event.target.checked)} /> Die Cut Baysek</label></fieldset>
                <fieldset><legend>Label</legend><label><input type="checkbox" checked={draft.labelDieCut} onChange={(event) => update('labelDieCut', event.target.checked)} /> Die Cut</label><label><input type="checkbox" checked={draft.label4cProcess} onChange={(event) => update('label4cProcess', event.target.checked)} /> 4-C Process</label></fieldset>
              </div></section>
            </div> : <section className="approval-artwork-only"><header><span>ART</span><div><h3>Replace Artwork Only</h3><p>Revision number, date, description, CSR, Designer, and production options will not change.</p></div></header>
              <div className="approval-artwork-current"><span>Currently connected</span><strong>{draft.artworkName || 'No artwork file connected'}</strong><small>{draft.artworkRelativePath || 'Choose a matching live PDF below.'}</small></div>
              <div className="approval-artwork-list">{matches.length ? matches.map((match) => {
                const selected = draft.artworkRelativePath === match.relativePath;
                return <button className={selected ? 'selected' : ''} key={match.relativePath} onClick={() => selectArtwork(match)} type="button"><span>{selected ? '✓' : 'PDF'}</span><div><strong>{match.name}</strong><small>{match.classification === 'approval' ? 'Approval artwork' : 'Matching G# artwork'} · {new Date(match.modifiedAt).toLocaleString()}</small></div></button>;
              }) : <div className="approval-artwork-empty">No matching live artwork PDFs were found.</div>}</div>
            </section>}
          </>}
        </div>
        {!loading && detail && <footer><div><strong>{mode === 'artwork' ? 'Artwork-only update' : 'Revision information update'}</strong><span>The finished PDF is regenerated separately after saving.</span></div><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving || (mode === 'artwork' && !draft.artworkRelativePath)}>{saving ? 'Saving…' : mode === 'artwork' ? 'Save Artwork Change' : 'Save Changes'}</button></footer>}
      </form>
    </Modal>
  );
}
