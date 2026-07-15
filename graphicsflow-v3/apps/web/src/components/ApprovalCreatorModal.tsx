import { useEffect, useState, type FormEvent } from 'react';
import { formatGNumber, type GraphicRecord } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';
import './ApprovalCreatorModal.css';
import './ApprovalSuccessDialog.css';

type ApprovalDraft = {
  specificationNumber: string; designNumber: string; fluteTest: string; salesRep: string;
  revisionLabel: string; revisionDate: string; description: string; csr: string; designer: string;
  digitalPrint: boolean; digitalCut: boolean; digitalDieCut: boolean; labelDieCut: boolean; label4cProcess: boolean;
};
type SavedApproval = { graphicId: number; revisionId: number; revisionLabel: string; fileName: string; pdfUrl: string; downloadUrl: string };
type ApprovalCreatorModalProps = { isOpen: boolean; onClose: () => void; record: GraphicRecord | null };

const emptyDraft = (record: GraphicRecord | null): ApprovalDraft => ({
  specificationNumber: record?.specificationNumber || '', designNumber: '', fluteTest: '', salesRep: '', revisionLabel: '0',
  revisionDate: new Date().toISOString().slice(0, 10), description: 'FOR APPROVAL', csr: '', designer: '',
  digitalPrint: false, digitalCut: false, digitalDieCut: false, labelDieCut: false, label4cProcess: false,
});

export function ApprovalCreatorModal({ isOpen, onClose, record }: ApprovalCreatorModalProps) {
  const [draft, setDraft] = useState<ApprovalDraft>(() => emptyDraft(record));
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedApproval, setSavedApproval] = useState<SavedApproval | null>(null);
  const [outputHandled, setOutputHandled] = useState(false);

  const clearPreview = () => setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });

  useEffect(() => {
    if (!isOpen) return;
    setDraft(emptyDraft(record)); setPreviewLoading(false); setPreviewError(null); setSaving(false); setSavedApproval(null); setOutputHandled(false); clearPreview();
  }, [isOpen, record?.id]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const update = (key: keyof ApprovalDraft, value: string | boolean) => {
    const normalized = typeof value === 'string' && key !== 'revisionDate' ? value.toUpperCase() : value;
    setDraft((current) => ({ ...current, [key]: normalized }));
    setPreviewError(null);
    if (previewUrl) clearPreview();
  };

  const generatePreview = async (event: FormEvent) => {
    event.preventDefault(); if (!record) return;
    const previewDraft = { ...draft };
    setPreviewLoading(true); setPreviewError(null);
    try {
      const response = await fetch(`/api/graphics/${record.id}/approval/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(previewDraft) });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error || 'The Approval preview could not be generated.'); }
      const nextUrl = URL.createObjectURL(await response.blob());
      setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl; });
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
      setSavedApproval(body as SavedApproval); setOutputHandled(false);
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'The Approval could not be saved.'); }
    finally { setSaving(false); }
  };

  const printApproval = () => {
    if (!savedApproval) return;
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed'; frame.style.width = '1px'; frame.style.height = '1px'; frame.style.opacity = '0'; frame.style.pointerEvents = 'none';
    frame.src = savedApproval.pdfUrl;
    frame.onload = () => { setOutputHandled(true); frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 60_000); };
    document.body.appendChild(frame);
  };

  const downloadApproval = () => {
    if (!savedApproval) return;
    const link = document.createElement('a'); link.href = savedApproval.downloadUrl; link.download = savedApproval.fileName; document.body.appendChild(link); link.click(); link.remove(); setOutputHandled(true);
  };

  const finish = () => { if (!outputHandled) return; setSavedApproval(null); onClose(); };
  const requestClose = () => { if (savedApproval) return; onClose(); };
  if (!record) return null;

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title={`Create Approval · ${formatGNumber(record.gNumber)}`} variant="creator">
      <div className="approval-creator-modal">
        <header className="approval-creator-heading"><div><p className="eyebrow">Approval workspace</p><h3>Create Approval</h3><p>Create and preview an Approval without changing any live production file.</p></div><span className="approval-save-policy">Manual save only</span></header>
        <div className="approval-creator-grid">
          <form className="approval-creator-form" onSubmit={generatePreview}>
            <header><div><p className="eyebrow">Approval information</p><h3>{formatGNumber(record.gNumber)}</h3></div><button disabled={previewLoading || saving} type="submit">{previewLoading ? 'Generating…' : 'Generate Preview'}</button></header>
            <div className="approval-record-summary"><strong>{record.customerName}</strong><span>{record.customerNumber} · {record.partNumber}</span></div>
            <div className="approval-field-grid">
              <label>Spec #<input onChange={(event) => update('specificationNumber', event.target.value)} value={draft.specificationNumber} /></label><label>Design #<input onChange={(event) => update('designNumber', event.target.value)} value={draft.designNumber} /></label>
              <label>Flute / Test<input onChange={(event) => update('fluteTest', event.target.value)} value={draft.fluteTest} /></label><label>Sales Rep<input onChange={(event) => update('salesRep', event.target.value)} value={draft.salesRep} /></label>
            </div>
            <section className="approval-production-options"><header><p className="eyebrow">Production options</p><h4>Digital and Label</h4></header><div className="approval-option-groups">
              <fieldset><legend>Digital</legend><label className="approval-check-option"><input checked={draft.digitalPrint} onChange={(event) => update('digitalPrint', event.target.checked)} type="checkbox" /><span>Digital Print</span></label><label className="approval-check-option"><input checked={draft.digitalCut} onChange={(event) => update('digitalCut', event.target.checked)} type="checkbox" /><span>Die Cut</span></label><label className="approval-check-option"><input checked={draft.digitalDieCut} onChange={(event) => update('digitalDieCut', event.target.checked)} type="checkbox" /><span>Die Cut Baysek</span></label></fieldset>
              <fieldset><legend>Label</legend><label className="approval-check-option"><input checked={draft.labelDieCut} onChange={(event) => update('labelDieCut', event.target.checked)} type="checkbox" /><span>Die Cut</span></label><label className="approval-check-option"><input checked={draft.label4cProcess} onChange={(event) => update('label4cProcess', event.target.checked)} type="checkbox" /><span>4-C Process</span></label></fieldset>
            </div></section>
            <section className="approval-revision-entry"><header><div><p className="eyebrow">Revision row</p><h4>Current Approval entry</h4></div></header><div className="approval-revision-grid">
              <label>Rev<input required onChange={(event) => update('revisionLabel', event.target.value)} value={draft.revisionLabel} /></label><label>Date<input required onChange={(event) => update('revisionDate', event.target.value)} type="date" value={draft.revisionDate} /></label><label>Description<input required onChange={(event) => update('description', event.target.value)} value={draft.description} /></label><label>CSR<input onChange={(event) => update('csr', event.target.value)} value={draft.csr} /></label><label>Designer<input onChange={(event) => update('designer', event.target.value)} value={draft.designer} /></label>
            </div></section>
            {previewError && <div className="approval-preview-error" role="alert">{previewError}</div>}
            <div className="approval-creator-policy"><strong>No automatic live-server writes</strong><span>Save Approval stores the PDF and revision in GraphicsFlow managed storage. Publishing to the configured live Approval folder remains separate.</span></div>
          </form>
          <aside className="approval-creator-preview"><DocumentCanvas ariaLabel={`${formatGNumber(record.gNumber)} Approval preview`} fitScale={1} isActive={isOpen} key={`${record.id}-${previewUrl}`} renderAtLayoutScale={false} toolbarEnd={<button disabled={!previewUrl || previewLoading || saving} onClick={saveApproval} type="button">{saving ? 'Saving…' : 'Save Approval'}</button>}><div className="approval-sheet-preview">{previewLoading ? <LoadingIndicator message="Filling HCC APPROVAL FORM-2026.pdf and rendering a temporary preview…" size="viewer" title="Generating Approval Preview" /> : previewUrl ? <img alt={`${formatGNumber(record.gNumber)} HCC Approval preview`} className="approval-template-preview-image" draggable={false} src={previewUrl} /> : <div className="approval-preview-prompt"><strong>Preview not generated</strong><span>Complete the information and choose Generate Preview.</span></div>}</div></DocumentCanvas></aside>
        </div>
        {savedApproval && <div className="approval-success-backdrop" role="presentation"><section aria-labelledby="approval-success-title" aria-modal="true" className="approval-success-dialog" role="dialog">
          <div className="approval-success-mark" aria-hidden="true">✓</div><p className="eyebrow">Approval saved</p><h3 id="approval-success-title">{formatGNumber(record.gNumber)} · Revision {savedApproval.revisionLabel}</h3>
          <p>The finished PDF and revision information are safely stored in GraphicsFlow. Print or download the Approval before closing.</p>
          <div className="approval-success-file"><span>Saved PDF</span><strong>{savedApproval.fileName}</strong></div>
          <div className="approval-success-actions"><button className="approval-success-secondary" onClick={printApproval} type="button">Print</button><button className="approval-success-primary" onClick={downloadApproval} type="button">Download PDF</button></div>
          <button className="approval-success-done" disabled={!outputHandled} onClick={finish} type="button">{outputHandled ? 'Done' : 'Print or download to continue'}</button>
        </section></div>}
      </div>
    </Modal>
  );
}
