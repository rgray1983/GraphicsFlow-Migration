import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  formatGNumber,
  type GraphicRecord,
  type PrintCardArtworkMatch,
  type PrintCardArtworkMatchesResponse,
} from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator, ShimmerPreview } from './LoadingIndicator';
import { Modal } from './Modal';
import './PrintCardCreatorModal.css';
import './ApprovalCreatorModal.css';
import './ApprovalSuccessDialog.css';

type ApprovalDraft = {
  specificationNumber: string;
  designNumber: string;
  fluteTest: string;
  salesRep: string;
  revisionLabel: string;
  revisionDate: string;
  description: string;
  csr: string;
  designer: string;
  digitalPrint: boolean;
  digitalCut: boolean;
  digitalDieCut: boolean;
  labelDieCut: boolean;
  label4cProcess: boolean;
  artPdfName: string;
  artPdfBase64: string;
  liveArtworkRelativePath: string;
};

type SavedApproval = {
  graphicId: number;
  revisionId: number;
  revisionLabel: string;
  fileName: string;
  pdfUrl: string;
  downloadUrl: string;
};

type ApprovalCreatorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord | null;
};

const emptyDraft = (record: GraphicRecord | null): ApprovalDraft => ({
  specificationNumber: record?.specificationNumber || '',
  designNumber: '',
  fluteTest: '',
  salesRep: '',
  revisionLabel: '0',
  revisionDate: new Date().toISOString().slice(0, 10),
  description: 'FOR APPROVAL',
  csr: '',
  designer: '',
  digitalPrint: false,
  digitalCut: false,
  digitalDieCut: false,
  labelDieCut: false,
  label4cProcess: false,
  artPdfName: '',
  artPdfBase64: '',
  liveArtworkRelativePath: '',
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The artwork PDF could not be read.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function formatMatch(match: PrintCardArtworkMatch): string {
  const label = match.classification === 'approval'
    ? 'Approval artwork'
    : match.classification === 'print-card'
      ? 'Print Card artwork'
      : 'Other G# match';
  return `${label} · Modified ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(match.modifiedAt))}`;
}

export function ApprovalCreatorModal({ isOpen, onClose, record }: ApprovalCreatorModalProps) {
  const [draft, setDraft] = useState<ApprovalDraft>(() => emptyDraft(record));
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedApproval, setSavedApproval] = useState<SavedApproval | null>(null);
  const [downloadCompleted, setDownloadCompleted] = useState(false);
  const [artworkMatches, setArtworkMatches] = useState<PrintCardArtworkMatchesResponse | null>(null);
  const [artworkLoading, setArtworkLoading] = useState(false);

  const clearPreview = () => {
    setPreviewOpen(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  };

  useEffect(() => {
    if (!isOpen || !record) return;
    let cancelled = false;
    setDraft(emptyDraft(record));
    setError(null);
    setSaving(false);
    setSavedApproval(null);
    setDownloadCompleted(false);
    setArtworkMatches(null);
    clearPreview();
    setArtworkLoading(true);

    fetch(`/api/graphics/${record.id}/print-card/artwork-matches`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Live artwork PDFs could not be checked.');
        return response.json() as Promise<PrintCardArtworkMatchesResponse>;
      })
      .then((matches) => {
        if (cancelled) return;
        setArtworkMatches(matches);
        const selected = matches.selectedRelativePath
          ? matches.matches.find((match) => match.relativePath === matches.selectedRelativePath)
          : null;
        if (selected) {
          setDraft((current) => ({
            ...current,
            artPdfName: selected.name,
            artPdfBase64: '',
            liveArtworkRelativePath: selected.relativePath,
          }));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Live artwork PDFs could not be checked.');
      })
      .finally(() => {
        if (!cancelled) setArtworkLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, record?.id]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const update = (key: keyof ApprovalDraft, value: string | boolean) => {
    const normalized = typeof value === 'string'
      && key !== 'revisionDate'
      && key !== 'artPdfBase64'
      && key !== 'liveArtworkRelativePath'
      ? value.toUpperCase()
      : value;
    setDraft((current) => ({ ...current, [key]: normalized }));
    setError(null);
    if (previewUrl) clearPreview();
  };

  const chooseLiveArtwork = (match: PrintCardArtworkMatch) => {
    setDraft((current) => ({
      ...current,
      artPdfName: match.name,
      artPdfBase64: '',
      liveArtworkRelativePath: match.relativePath,
    }));
    setError(null);
    if (previewUrl) clearPreview();
  };

  const chooseArtwork = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Approval artwork must be a PDF.');
      return;
    }
    setArtworkLoading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      setDraft((current) => ({
        ...current,
        artPdfName: file.name,
        artPdfBase64: base64,
        liveArtworkRelativePath: '',
      }));
      if (previewUrl) clearPreview();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The artwork PDF could not be read.');
    } finally {
      setArtworkLoading(false);
    }
  };

  const missing = useMemo(() => {
    const fields: string[] = [];
    if (!draft.artPdfBase64 && !draft.liveArtworkRelativePath) fields.push('Artwork PDF');
    if (!draft.specificationNumber.trim()) fields.push('Spec #');
    if (!draft.revisionLabel.trim()) fields.push('Revision');
    if (!draft.revisionDate.trim()) fields.push('Revision Date');
    if (!draft.description.trim()) fields.push('Description');
    if (!draft.csr.trim()) fields.push('CSR');
    if (!draft.designer.trim()) fields.push('Designer');
    return fields;
  }, [draft]);

  const readinessTotal = 7;
  const readinessPercent = Math.max(0, Math.round(((readinessTotal - missing.length) / readinessTotal) * 100));

  const generatePreview = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!record || previewLoading) return;
    if (missing.length) {
      setError(`Complete the required Approval information: ${missing.join(', ')}.`);
      return;
    }

    setPreviewOpen(true);
    setPreviewLoading(true);
    setError(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });

    try {
      const response = await fetch(`/api/graphics/${record.id}/approval/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'The Approval preview could not be generated.');
      }
      const nextUrl = URL.createObjectURL(await response.blob());
      setPreviewUrl(nextUrl);
    } catch (reason) {
      setPreviewOpen(false);
      setError(reason instanceof Error ? reason.message : 'The Approval preview could not be generated.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => setPreviewOpen(false);

  const saveApproval = async () => {
    if (!record || !previewUrl || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/graphics/${record.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => null) as SavedApproval | { error?: string } | null;
      if (!response.ok) throw new Error(body && 'error' in body && body.error ? body.error : 'The Approval could not be saved.');
      setSavedApproval(body as SavedApproval);
      setDownloadCompleted(false);
      setPreviewOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Approval could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const printApproval = () => {
    if (!savedApproval) return;
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.src = savedApproval.pdfUrl;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  };

  const downloadApproval = () => {
    if (!savedApproval) return;
    const link = document.createElement('a');
    link.href = savedApproval.downloadUrl;
    link.download = savedApproval.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setDownloadCompleted(true);
  };

  const finish = () => {
    if (!downloadCompleted) return;
    setSavedApproval(null);
    onClose();
  };

  const requestClose = () => {
    if (savedApproval || saving || previewLoading || artworkLoading) return;
    onClose();
  };

  if (!record) return null;

  const artworkReady = Boolean(draft.artPdfBase64 || draft.liveArtworkRelativePath);
  const metadataReady = Boolean(draft.specificationNumber.trim());
  const revisionReady = Boolean(
    draft.revisionLabel.trim()
    && draft.revisionDate.trim()
    && draft.description.trim()
    && draft.csr.trim()
    && draft.designer.trim(),
  );

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title={`Approval Workspace · ${formatGNumber(record.gNumber)}`} variant="creator">
      <form className="print-card-creator approval-workspace" onSubmit={generatePreview}>
        <section className="creator-editor">
          <div className="creator-intro">
            <div>
              <span className="creator-kicker">Document Workspace</span>
              <h3>Create Approval</h3>
              <p>Select the G# artwork, complete the Approval information, and inspect the finished HCC form before saving.</p>
            </div>
            <div className={`creator-readiness${missing.length === 0 ? ' is-ready' : ''}`}>
              <div><span>Approval Ready</span><strong>{readinessPercent}%</strong></div>
              <div className="creator-readiness-track"><i style={{ width: `${readinessPercent}%` }} /></div>
              <small>{missing.length ? `Missing: ${missing.join(', ')}` : 'All required Approval information is complete.'}</small>
            </div>
          </div>

          <div className="creator-record-summary">
            <div><span>Customer #</span><strong>{record.customerNumber}</strong></div>
            <div><span>Customer</span><strong>{record.customerName}</strong></div>
            <div><span>Part #</span><strong>{record.partNumber}</strong></div>
          </div>

          <section className="creator-work-section creator-artwork-section">
            <header>
              <div><span className="creator-step">01</span><div><h4>Artwork</h4><p>Use the same read-only G# PDF used by Create Print Card, or upload a temporary override.</p></div></div>
              <span className={`creator-step-state${artworkReady ? ' is-complete' : ''}`}>{artworkReady ? 'Ready' : 'Required'}</span>
            </header>
            {artworkLoading && <div className="approval-inline-loading">Searching the configured PDF folder…</div>}
            {artworkMatches && <section className="creator-artwork-matches">
              <div><span className="creator-kicker">Available Artwork PDFs</span><h4>{artworkMatches.message}</h4></div>
              {artworkMatches.matches.length > 0 && <div className="creator-artwork-list" role="listbox" aria-label="Available artwork PDFs">
                {artworkMatches.matches.map((match) => {
                  const selected = draft.liveArtworkRelativePath === match.relativePath && !draft.artPdfBase64;
                  return <button aria-selected={selected} className={`creator-artwork-row${selected ? ' is-selected' : ''}`} key={match.relativePath} onClick={() => chooseLiveArtwork(match)} role="option" type="button">
                    <span className="creator-artwork-found" aria-hidden="true">✓</span>
                    <strong>{match.name}</strong>
                    <span>{formatMatch(match)}</span>
                    <small title={match.relativePath}>{match.relativePath}</small>
                  </button>;
                })}
              </div>}
            </section>}
            <label className="creator-artwork-upload">
              <input accept="application/pdf,.pdf" onChange={(event) => void chooseArtwork(event.target.files?.[0])} type="file" />
              <span><strong>{draft.artPdfBase64 ? draft.artPdfName : 'Choose Uploaded PDF Instead'}</strong><small>{draft.artPdfBase64 ? 'Temporary upload selected for this Approval only.' : 'The upload is temporary and never replaces a live server PDF.'}</small></span>
            </label>
          </section>

          <section className="creator-work-section">
            <header>
              <div><span className="creator-step">02</span><div><h4>Approval Information</h4><p>Complete the customer-facing production details shown at the top of the HCC form.</p></div></div>
              <span className={`creator-step-state${metadataReady ? ' is-complete' : ''}`}>{metadataReady ? 'Ready' : 'Required'}</span>
            </header>
            <div className="creator-fields">
              <label><span>Spec # {!draft.specificationNumber.trim() && <b className="approval-required-badge">! Required</b>}</span><input required onInput={(event) => update('specificationNumber', event.currentTarget.value)} value={draft.specificationNumber} /></label>
              <label><span>Design #</span><input onInput={(event) => update('designNumber', event.currentTarget.value)} value={draft.designNumber} /></label>
              <label><span>Flute / Test</span><input onInput={(event) => update('fluteTest', event.currentTarget.value)} value={draft.fluteTest} /></label>
              <label><span>Sales Rep</span><input onInput={(event) => update('salesRep', event.currentTarget.value)} value={draft.salesRep} /></label>
            </div>
          </section>

          <section className="creator-work-section">
            <header>
              <div><span className="creator-step">03</span><div><h4>Production Options</h4><p>Mark the applicable Digital and Label production methods.</p></div></div>
              <span className="creator-step-state is-complete">Optional</span>
            </header>
            <div className="approval-production-grid">
              <fieldset><legend>Digital</legend>
                <label><input checked={draft.digitalPrint} onChange={(event) => update('digitalPrint', event.target.checked)} type="checkbox" /><span>Digital Print</span></label>
                <label><input checked={draft.digitalCut} onChange={(event) => update('digitalCut', event.target.checked)} type="checkbox" /><span>Die Cut</span></label>
                <label><input checked={draft.digitalDieCut} onChange={(event) => update('digitalDieCut', event.target.checked)} type="checkbox" /><span>Die Cut Baysek</span></label>
              </fieldset>
              <fieldset><legend>Label</legend>
                <label><input checked={draft.labelDieCut} onChange={(event) => update('labelDieCut', event.target.checked)} type="checkbox" /><span>Die Cut</span></label>
                <label><input checked={draft.label4cProcess} onChange={(event) => update('label4cProcess', event.target.checked)} type="checkbox" /><span>4-C Process</span></label>
              </fieldset>
            </div>
          </section>

          <section className="creator-work-section">
            <header>
              <div><span className="creator-step">04</span><div><h4>Revision Entry</h4><p>This row becomes the current Approval revision in GraphicsFlow.</p></div></div>
              <span className={`creator-step-state${revisionReady ? ' is-complete' : ''}`}>{revisionReady ? 'Ready' : 'Required'}</span>
            </header>
            <div className="creator-fields approval-revision-fields">
              <label><span>Revision {!draft.revisionLabel.trim() && <b className="approval-required-badge">! Required</b>}</span><input required onInput={(event) => update('revisionLabel', event.currentTarget.value)} value={draft.revisionLabel} /></label>
              <label><span>Revision Date {!draft.revisionDate.trim() && <b className="approval-required-badge">! Required</b>}</span><input required onChange={(event) => update('revisionDate', event.target.value)} type="date" value={draft.revisionDate} /></label>
              <label className="creator-field-wide"><span>Description {!draft.description.trim() && <b className="approval-required-badge">! Required</b>}</span><input required onInput={(event) => update('description', event.currentTarget.value)} value={draft.description} /></label>
              <label><span>CSR {!draft.csr.trim() && <b className="approval-required-badge">! Required</b>}</span><input required onInput={(event) => update('csr', event.currentTarget.value)} value={draft.csr} /></label>
              <label><span>Designer {!draft.designer.trim() && <b className="approval-required-badge">! Required</b>}</span><input required onInput={(event) => update('designer', event.currentTarget.value)} value={draft.designer} /></label>
            </div>
          </section>

          {error && <div className="creator-error" role="alert">{error}</div>}
        </section>

        <aside className="creator-preview-panel approval-preview-panel">
          <div className="creator-preview-heading">
            <div><span className="creator-kicker">Approval Preview</span><h3>HCC Approval Form</h3></div>
            <span>Landscape PDF</span>
          </div>

          <button className="creator-thumbnail-button" disabled={!previewUrl || previewLoading} onClick={() => setPreviewOpen(true)} type="button" aria-label="Open Approval preview">
            <ShimmerPreview active={previewLoading} label="Rendering Approval…">
              <div className="approval-thumbnail-preview">
                {previewUrl ? <img alt={`${formatGNumber(record.gNumber)} Approval thumbnail`} src={previewUrl} /> : <div><strong>Preview not generated</strong><span>Complete the required steps and generate the Approval preview.</span></div>}
              </div>
            </ShimmerPreview>
            <span>{previewUrl ? 'Open Approval Preview' : 'Approval preview waiting'}</span>
          </button>

          <div className="creator-preview-summary">
            <strong>{artworkReady ? 'G# artwork connected' : 'Artwork waiting'}</strong>
            <span>{missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} remaining` : previewUrl ? 'Preview ready for final inspection' : 'Ready to generate preview'}</span>
          </div>

          <button className="open-production-preview" disabled={previewLoading || missing.length > 0} onClick={() => void generatePreview()} type="button">{previewLoading ? 'Rendering Approval Preview…' : previewUrl ? 'Regenerate Approval Preview' : 'Generate Approval Preview'}</button>
          <p>The preview uses the selected G# PDF and the exact HCC APPROVAL FORM-2026.pdf template. Live artwork files remain read-only.</p>

          <footer className="creator-actions creator-preview-actions">
            <button className="secondary" onClick={requestClose} type="button">Cancel</button>
            <button className="primary" disabled={!previewUrl || saving || previewLoading} onClick={saveApproval} type="button">{saving ? 'Saving Approval…' : 'Save Approval'}</button>
          </footer>
        </aside>

        {previewOpen && <div className="production-preview-workspace approval-preview-workspace" role="dialog" aria-modal="true" aria-label="Approval Preview">
          <header><div><span className="creator-kicker">Approval Preview</span><h2>{formatGNumber(record.gNumber)} · HCC Approval Form</h2></div><span className="print-card-preview-quality">Viewer Render</span></header>
          {previewUrl ? <DocumentCanvas ariaLabel="Approval preview controls" fitScale={0.9} isActive={previewOpen} onEscape={closePreview} toolbarEnd={<button className="close-preview" onClick={closePreview} type="button">Close</button>}>
            <div className="production-preview-card approval-full-preview"><img alt={`${formatGNumber(record.gNumber)} complete Approval preview`} draggable={false} src={previewUrl} /></div>
          </DocumentCanvas> : <LoadingIndicator size="viewer" title="Rendering Approval Preview" message="Placing the G# artwork and filling the HCC Approval template…" />}
        </div>}

        {savedApproval && <div className="approval-success-backdrop" role="presentation"><section aria-labelledby="approval-success-title" aria-modal="true" className="approval-success-dialog" role="dialog">
          <div className="approval-success-mark" aria-hidden="true">✓</div><p className="eyebrow">Approval saved</p><h3 id="approval-success-title">{formatGNumber(record.gNumber)} · Revision {savedApproval.revisionLabel}</h3>
          <p>The revision is saved in GraphicsFlow. Download the temporary finished PDF before closing. Printing alone does not complete this step.</p>
          <div className="approval-success-file"><span>Temporary PDF</span><strong>{savedApproval.fileName}</strong></div>
          <div className="approval-success-actions"><button className="approval-success-secondary" onClick={printApproval} type="button">Print</button><button className="approval-success-primary" onClick={downloadApproval} type="button">Download PDF</button></div>
          <button className="approval-success-done" disabled={!downloadCompleted} onClick={finish} type="button">{downloadCompleted ? 'Done' : 'Download PDF to continue'}</button>
        </section></div>}
      </form>
    </Modal>
  );
}
