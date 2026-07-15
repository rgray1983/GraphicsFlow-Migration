import { useEffect, useState, type FormEvent } from 'react';
import { formatGNumber, type GraphicRecord, type PrintCardArtworkMatch, type PrintCardArtworkMatchesResponse } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';
import './ApprovalCreatorModal.css';
import './ApprovalSuccessDialog.css';

type ApprovalDraft = {
  specificationNumber: string; designNumber: string; fluteTest: string; salesRep: string;
  revisionLabel: string; revisionDate: string; description: string; csr: string; designer: string;
  digitalPrint: boolean; digitalCut: boolean; digitalDieCut: boolean; labelDieCut: boolean; label4cProcess: boolean;
  artPdfName: string; artPdfBase64: string; liveArtworkRelativePath: string;
};
type SavedApproval = { graphicId: number; revisionId: number; revisionLabel: string; fileName: string; pdfUrl: string; downloadUrl: string };
type ApprovalCreatorModalProps = { isOpen: boolean; onClose: () => void; record: GraphicRecord | null };

const emptyDraft = (record: GraphicRecord | null): ApprovalDraft => ({
  specificationNumber: record?.specificationNumber || '', designNumber: '', fluteTest: '', salesRep: '', revisionLabel: '0',
  revisionDate: new Date().toISOString().slice(0, 10), description: 'FOR APPROVAL', csr: '', designer: '',
  digitalPrint: false, digitalCut: false, digitalDieCut: false, labelDieCut: false, label4cProcess: false,
  artPdfName: '', artPdfBase64: '', liveArtworkRelativePath: '',
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The artwork PDF could not be read.'));
    reader.onload = () => { const result = String(reader.result ?? ''); resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result); };
    reader.readAsDataURL(file);
  });
}
function formatMatch(match: PrintCardArtworkMatch): string {
  const label = match.classification === 'approval' ? 'Approval artwork' : match.classification === 'print-card' ? 'Print Card artwork' : 'Other G# match';
  return `${label} · Modified ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(match.modifiedAt))}`;
}

export function ApprovalCreatorModal({ isOpen, onClose, record }: ApprovalCreatorModalProps) {
  const [draft, setDraft] = useState<ApprovalDraft>(() => emptyDraft(record));
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedApproval, setSavedApproval] = useState<SavedApproval | null>(null);
  const [downloadCompleted, setDownloadCompleted] = useState(false);
  const [artworkMatches, setArtworkMatches] = useState<PrintCardArtworkMatchesResponse | null>(null);
  const [artworkLoading, setArtworkLoading] = useState(false);

  const clearPreview = () => setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });

  useEffect(() => {
    if (!isOpen || !record) return;
    let cancelled = false;
    setDraft(emptyDraft(record)); setPreviewLoading(false); setPreviewError(null); setSaving(false); setSavedApproval(null); setDownloadCompleted(false); setArtworkMatches(null); clearPreview();
    setArtworkLoading(true);
    fetch(`/api/graphics/${record.id}/print-card/artwork-matches`)
      .then(async (response) => { if (!response.ok) throw new Error('Live artwork PDFs could not be checked.'); return response.json() as Promise<PrintCardArtworkMatchesResponse>; })
      .then((matches) => {
        if (cancelled) return;
        setArtworkMatches(matches);
        const selected = matches.selectedRelativePath ? matches.matches.find((match) => match.relativePath === matches.selectedRelativePath) : null;
        if (selected) setDraft((current) => ({ ...current, artPdfName: selected.name, artPdfBase64: '', liveArtworkRelativePath: selected.relativePath }));
      })
      .catch((error: unknown) => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Live artwork PDFs could not be checked.'); })
      .finally(() => { if (!cancelled) setArtworkLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, record?.id]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const update = (key: keyof ApprovalDraft, value: string | boolean) => {
    const normalized = typeof value === 'string' && key !== 'revisionDate' && key !== 'artPdfBase64' && key !== 'liveArtworkRelativePath' ? value.toUpperCase() : value;
    setDraft((current) => ({ ...current, [key]: normalized })); setPreviewError(null); if (previewUrl) clearPreview();
  };
  const chooseLiveArtwork = (match: PrintCardArtworkMatch) => {
    setDraft((current) => ({ ...current, artPdfName: match.name, artPdfBase64: '', liveArtworkRelativePath: match.relativePath }));
    setPreviewError(null); if (previewUrl) clearPreview();
  };
  const chooseArtwork = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setPreviewError('Approval artwork must be a PDF.'); return; }
    setArtworkLoading(true); setPreviewError(null);
    try {
      const base64 = await fileToBase64(file);
      setDraft((current) => ({ ...current, artPdfName: file.name, artPdfBase64: base64, liveArtworkRelativePath: '' }));
      if (previewUrl) clearPreview();
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'The artwork PDF could not be read.'); }
    finally { setArtworkLoading(false); }
  };

  const generatePreview = async (event: FormEvent) => {
    event.preventDefault(); if (!record) return;
    if (!draft.artPdfBase64 && !draft.liveArtworkRelativePath) { setPreviewError('Select a live G# PDF or upload a PDF before generating the Approval preview.'); return; }
    const previewDraft = { ...draft }; setPreviewLoading(true); setPreviewError(null);
    try {
      const response = await fetch(`/api/graphics/${record.id}/approval/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(previewDraft) });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error || 'The Approval preview could not be generated.'); }
      const nextUrl = URL.createObjectURL(await response.blob()); setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl; });
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'The Approval preview could not be generated.'); }
    finally { setPreviewLoading(false); }
  };

  const saveApproval = async () => {
    if (!record || !previewUrl || saving) return;
    setSaving(true); setPreviewError(null);
    try {
      const response = await fetch(`/api/graphics/${record.id}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const body = await response.json().catch(() => null) as SavedApproval | { error?: string } | null;
      if (!response.ok) throw new Error(body && 'error' in body && body.error ? body.error : 'The Approval could not be saved.');
      setSavedApproval(body as SavedApproval); setDownloadCompleted(false);
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'The Approval could not be saved.'); }
    finally { setSaving(false); }
  };
  const printApproval = () => { if (!savedApproval) return; const frame = document.createElement('iframe'); frame.style.position='fixed'; frame.style.width='1px'; frame.style.height='1px'; frame.style.opacity='0'; frame.style.pointerEvents='none'; frame.src=savedApproval.pdfUrl; frame.onload=()=>{ frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(()=>frame.remove(),60000); }; document.body.appendChild(frame); };
  const downloadApproval = () => { if (!savedApproval) return; const link=document.createElement('a'); link.href=savedApproval.downloadUrl; link.download=savedApproval.fileName; document.body.appendChild(link); link.click(); link.remove(); setDownloadCompleted(true); };
  const finish = () => { if (!downloadCompleted) return; setSavedApproval(null); onClose(); };
  const requestClose = () => { if (savedApproval) return; onClose(); };
  if (!record) return null;

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title={`Create Approval · ${formatGNumber(record.gNumber)}`} variant="creator">
      <div className="approval-creator-modal">
        <header className="approval-creator-heading"><div><p className="eyebrow">Approval workspace</p><h3>Create Approval</h3><p>Create and preview an Approval without changing any live production file.</p></div><span className="approval-save-policy">Manual save only</span></header>
        <div className="approval-creator-grid">
          <form className="approval-creator-form" onSubmit={generatePreview}>
            <header><div><p className="eyebrow">Approval information</p><h3>{formatGNumber(record.gNumber)}</h3></div><button disabled={previewLoading || saving || artworkLoading} type="submit">{previewLoading ? 'Generating…' : 'Generate Preview'}</button></header>
            <div className="approval-record-summary"><strong>{record.customerName}</strong><span>{record.customerNumber} · {record.partNumber}</span></div>
            <section className="approval-artwork-section">
              <header><div><p className="eyebrow">Artwork PDF</p><h4>Add the G# artwork</h4></div><span className={`approval-artwork-state${draft.artPdfBase64 || draft.liveArtworkRelativePath ? ' is-ready' : ''}`}>{draft.artPdfBase64 || draft.liveArtworkRelativePath ? 'Ready' : 'Required'}</span></header>
              {artworkLoading && <span className="approval-artwork-loading">Searching the configured PDF folder…</span>}
              {artworkMatches && <div className="approval-artwork-matches"><strong>{artworkMatches.message}</strong>{artworkMatches.matches.length > 0 && <div className="approval-artwork-list">{artworkMatches.matches.map((match) => { const selected = draft.liveArtworkRelativePath === match.relativePath && !draft.artPdfBase64; return <button aria-pressed={selected} className={selected ? 'is-selected' : ''} key={match.relativePath} onClick={() => chooseLiveArtwork(match)} type="button"><span>✓</span><b>{match.name}</b><small>{formatMatch(match)}</small></button>; })}</div>}</div>}
              <label className="approval-artwork-upload"><input accept="application/pdf,.pdf" onChange={(event) => void chooseArtwork(event.target.files?.[0])} type="file" /><span><strong>{draft.artPdfBase64 ? draft.artPdfName : 'Choose Uploaded PDF Instead'}</strong><small>{draft.artPdfBase64 ? 'Temporary upload selected for this Approval.' : 'Uses the same 9 × 4 G# PDF accepted by Create Print Card.'}</small></span></label>
            </section>
            <div className="approval-field-grid"><label>Spec #<input onInput={(event) => update('specificationNumber', event.currentTarget.value)} value={draft.specificationNumber} /></label><label>Design #<input onInput={(event) => update('designNumber', event.currentTarget.value)} value={draft.designNumber} /></label><label>Flute / Test<input onInput={(event) => update('fluteTest', event.currentTarget.value)} value={draft.fluteTest} /></label><label>Sales Rep<input onInput={(event) => update('salesRep', event.currentTarget.value)} value={draft.salesRep} /></label></div>
            <section className="approval-production-options"><header><p className="eyebrow">Production options</p><h4>Digital and Label</h4></header><div className="approval-option-groups"><fieldset><legend>Digital</legend><label className="approval-check-option"><input checked={draft.digitalPrint} onChange={(event) => update('digitalPrint', event.target.checked)} type="checkbox" /><span>Digital Print</span></label><label className="approval-check-option"><input checked={draft.digitalCut} onChange={(event) => update('digitalCut', event.target.checked)} type="checkbox" /><span>Die Cut</span></label><label className="approval-check-option"><input checked={draft.digitalDieCut} onChange={(event) => update('digitalDieCut', event.target.checked)} type="checkbox" /><span>Die Cut Baysek</span></label></fieldset><fieldset><legend>Label</legend><label className="approval-check-option"><input checked={draft.labelDieCut} onChange={(event) => update('labelDieCut', event.target.checked)} type="checkbox" /><span>Die Cut</span></label><label className="approval-check-option"><input checked={draft.label4cProcess} onChange={(event) => update('label4cProcess', event.target.checked)} type="checkbox" /><span>4-C Process</span></label></fieldset></div></section>
            <section className="approval-revision-entry"><header><div><p className="eyebrow">Revision row</p><h4>Current Approval entry</h4></div></header><div className="approval-revision-grid"><label>Rev<input required onInput={(event) => update('revisionLabel', event.currentTarget.value)} value={draft.revisionLabel} /></label><label>Date<input required onChange={(event) => update('revisionDate', event.target.value)} type="date" value={draft.revisionDate} /></label><label>Description<input required onInput={(event) => update('description', event.currentTarget.value)} value={draft.description} /></label><label>CSR<input onInput={(event) => update('csr', event.currentTarget.value)} value={draft.csr} /></label><label>Designer<input onInput={(event) => update('designer', event.currentTarget.value)} value={draft.designer} /></label></div></section>
            {previewError && <div className="approval-preview-error" role="alert">{previewError}</div>}
            <div className="approval-creator-policy"><strong>No automatic live-server writes</strong><span>The selected live PDF is read-only. Uploaded artwork is temporary and is used only to generate this Approval.</span></div>
          </form>
          <aside className="approval-creator-preview"><DocumentCanvas ariaLabel={`${formatGNumber(record.gNumber)} Approval preview`} fitScale={1} isActive={isOpen} key={`${record.id}-${previewUrl}`} renderAtLayoutScale={false} toolbarEnd={<button disabled={!previewUrl || previewLoading || saving} onClick={saveApproval} type="button">{saving ? 'Saving…' : 'Save Approval'}</button>}><div className="approval-sheet-preview">{previewLoading ? <LoadingIndicator message="Placing the G# artwork and rendering the HCC Approval template…" size="viewer" title="Generating Approval Preview" /> : previewUrl ? <img alt={`${formatGNumber(record.gNumber)} HCC Approval preview`} className="approval-template-preview-image" draggable={false} src={previewUrl} /> : <div className="approval-preview-prompt"><strong>Preview not generated</strong><span>Select the G# PDF, complete the information, and choose Generate Preview.</span></div>}</div></DocumentCanvas></aside>
        </div>
        {savedApproval && <div className="approval-success-backdrop" role="presentation"><section aria-labelledby="approval-success-title" aria-modal="true" className="approval-success-dialog" role="dialog"><div className="approval-success-mark" aria-hidden="true">✓</div><p className="eyebrow">Approval saved</p><h3 id="approval-success-title">{formatGNumber(record.gNumber)} · Revision {savedApproval.revisionLabel}</h3><p>The revision is saved in GraphicsFlow. Download the temporary finished PDF before closing. Printing alone does not complete this step.</p><div className="approval-success-file"><span>Temporary PDF</span><strong>{savedApproval.fileName}</strong></div><div className="approval-success-actions"><button className="approval-success-secondary" onClick={printApproval} type="button">Print</button><button className="approval-success-primary" onClick={downloadApproval} type="button">Download PDF</button></div><button className="approval-success-done" disabled={!downloadCompleted} onClick={finish} type="button">{downloadCompleted ? 'Done' : 'Download PDF to continue'}</button></section></div>}
      </div>
    </Modal>
  );
}
