import {
  formatGNumber,
  renderPrintCardSvg,
  type CreatePrintCardResponse,
  type GraphicRecord,
  type PrintCardDefaultsResponse,
  type PrintCardDraft,
} from '@graphicsflow/shared';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import './PrintCardCreatorModal.css';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (result: CreatePrintCardResponse) => void | Promise<void>;
  record: GraphicRecord | null;
};

const emptyDraft: PrintCardDraft = {
  specificationNumber: '', designNumber: '', revisionLabel: '0', revisionDate: '', description: '',
  csr: '', designer: '', replaceExistingImage: false, artPdfName: '', artPdfBase64: '',
};

async function readError(response: Response, fallback: string): Promise<string> {
  try { const body = await response.json() as { error?: string }; return body.error || fallback; }
  catch { return fallback; }
}

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

export function PrintCardCreatorModal({ isOpen, onClose, onCreated, record }: Props) {
  const [defaults, setDefaults] = useState<PrintCardDefaultsResponse | null>(null);
  const [draft, setDraft] = useState<PrintCardDraft>(emptyDraft);
  const [initialDraft, setInitialDraft] = useState<PrintCardDraft>(emptyDraft);
  const [artPreviewUrl, setArtPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !record) return;
    let cancelled = false;
    setLoading(true); setError(null); setArtPreviewUrl('');
    void fetch(`/api/graphics/${record.id}/print-card/defaults`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, 'Print Card defaults could not be loaded.'));
        return response.json() as Promise<PrintCardDefaultsResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        const prepared = { ...data.draft, artPdfName: '', artPdfBase64: '' } as PrintCardDraft;
        setDefaults(data); setDraft(prepared); setInitialDraft(prepared);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Print Card defaults could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, record]);

  useEffect(() => () => { if (artPreviewUrl) URL.revokeObjectURL(artPreviewUrl); }, [artPreviewUrl]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const close = () => {
    if (saving || readingFile) return;
    if (dirty && !window.confirm('Discard the Print Card changes?')) return;
    onClose();
  };

  const infoSvg = useMemo(() => {
    if (!record) return '';
    return renderPrintCardSvg({
      gNumber: record.gNumber, customerNumber: record.customerNumber, customerName: record.customerName,
      partNumber: record.partNumber, specificationNumber: draft.specificationNumber, designNumber: draft.designNumber,
      revisions: [
        ...(defaults?.history ?? []).map((row) => ({ revisionLabel: row.revisionLabel, revisionDate: row.revisionDate, description: row.description, csr: row.csr, designer: row.designer })),
        { revisionLabel: draft.revisionLabel, revisionDate: draft.revisionDate, description: draft.description, csr: draft.csr, designer: draft.designer },
      ].slice(-4),
    });
  }, [defaults?.history, draft, record]);

  const update = <K extends keyof PrintCardDraft>(key: K, value: PrintCardDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const chooseArtwork = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Print Card artwork must be a PDF.'); return; }
    setReadingFile(true); setError(null);
    try {
      const base64 = await fileToBase64(file);
      if (artPreviewUrl) URL.revokeObjectURL(artPreviewUrl);
      setArtPreviewUrl(URL.createObjectURL(file));
      setDraft((current) => ({ ...current, artPdfName: file.name, artPdfBase64: base64 }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The artwork PDF could not be read.');
    } finally { setReadingFile(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!record || saving) return;
    if (!draft.artPdfBase64 && !draft.replaceExistingImage) { setError('Upload the 9 × 4 inch artwork PDF before generating the Print Card.'); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/graphics/${record.id}/print-card`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(await readError(response, 'The Print Card could not be created.'));
      const result = await response.json() as CreatePrintCardResponse;
      setInitialDraft(draft); await onCreated(result); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The Print Card could not be created.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={record ? `Create Print Card · ${formatGNumber(record.gNumber)}` : 'Create Print Card'} variant="creator">
      {loading && <div className="creator-loading">Reading GraphicsFlow metadata and approval fields…</div>}
      {!loading && record && defaults && (
        <form className="print-card-creator" onSubmit={submit}>
          <section className="creator-editor">
            <div className="creator-intro">
              <div><span className="creator-kicker">Graphics Document Creator</span><h3>Print Card</h3></div>
              <div className={`autofill-status${defaults.autoFill.approvalFound ? ' is-ready' : ''}`}><strong>{defaults.autoFill.approvalFound ? 'Approval connected' : 'No approval connected'}</strong><span>{defaults.autoFill.message}</span></div>
            </div>
            <div className="creator-record-summary"><div><span>Customer #</span><strong>{record.customerNumber}</strong></div><div><span>Customer</span><strong>{record.customerName}</strong></div><div><span>Part #</span><strong>{record.partNumber}</strong></div></div>

            <label className="creator-artwork-upload">
              <span>9 × 4 in Artwork PDF</span>
              <input accept="application/pdf,.pdf" onChange={(event) => void chooseArtwork(event.target.files?.[0])} type="file" />
              <small>{readingFile ? 'Reading PDF…' : draft.artPdfName || 'Required for a new Print Card. The PDF becomes the left 9 inches of the production JPG.'}</small>
            </label>

            <div className="creator-fields">
              <label><span>Spec # <small>{defaults.autoFill.sources.specificationNumber}</small></span><input autoFocus required value={draft.specificationNumber} onChange={(event) => update('specificationNumber', event.target.value.toUpperCase())} /></label>
              <label><span>Design # <small>{defaults.autoFill.sources.designNumber}</small></span><input value={draft.designNumber} onChange={(event) => update('designNumber', event.target.value.toUpperCase())} /></label>
              <label><span>Revision <small>{defaults.autoFill.sources.revisionLabel}</small></span><input required value={draft.revisionLabel} onChange={(event) => update('revisionLabel', event.target.value.toUpperCase())} /></label>
              <label><span>Revision Date <small>{defaults.autoFill.sources.revisionDate}</small></span><input required value={draft.revisionDate} onChange={(event) => update('revisionDate', event.target.value.toUpperCase())} /></label>
              <label className="creator-field-wide"><span>Description <small>{defaults.autoFill.sources.description}</small></span><input required value={draft.description} onChange={(event) => update('description', event.target.value.toUpperCase())} /></label>
              <label><span>CSR <small>{defaults.autoFill.sources.csr}</small></span><input required value={draft.csr} onChange={(event) => update('csr', event.target.value.toUpperCase())} /></label>
              <label><span>Designer <small>{defaults.autoFill.sources.designer}</small></span><input required value={draft.designer} onChange={(event) => update('designer', event.target.value.toUpperCase())} /></label>
            </div>
            <label className="replace-option"><input checked={draft.replaceExistingImage} onChange={(event) => update('replaceExistingImage', event.target.checked)} type="checkbox" /><span><strong>Replace Existing Image</strong><small>Without a new PDF, GraphicsFlow preserves the existing 9-inch artwork and rebuilds only the information panel.</small></span></label>
            {defaults.history.length > 0 && <section className="creator-history"><div><span className="creator-kicker">Existing Data</span><h4>Recent Print Card Revisions</h4></div><ol>{defaults.history.slice(-4).reverse().map((row, index) => <li key={`${row.id ?? 'legacy'}-${index}`}><strong>Rev {row.revisionLabel || '0'}</strong><span>{row.revisionDate || 'No date'} · {row.description || 'No description'}</span><small>{row.source === 'legacy-import' ? 'Legacy import' : 'GraphicsFlow'}</small></li>)}</ol></section>}
            {error && <div className="creator-error" role="alert">{error}</div>}
            <footer className="creator-actions"><button className="secondary" onClick={close} type="button">Cancel</button><button className="primary" disabled={saving || readingFile} type="submit">{saving ? 'Generating Print Card…' : 'Generate Print Card'}</button></footer>
          </section>

          <aside className="creator-preview-panel">
            <div className="creator-preview-heading"><div><span className="creator-kicker">Production Layout</span><h3>10 × 4 in · 300 DPI</h3></div><span>9 in art + 1 in info</span></div>
            <div className="print-card-production-preview">
              <div className="print-card-art-preview">{artPreviewUrl ? <object aria-label="Artwork PDF preview" data={artPreviewUrl} type="application/pdf" /> : <span>Upload the 9 × 4 artwork PDF</span>}</div>
              <div className="print-card-info-preview" dangerouslySetInnerHTML={{ __html: infoSvg }} />
            </div>
            <p>The production JPG uses the uploaded PDF at 9 × 4 inches and the PHP-matched revision panel at 1 × 4 inches.</p>
          </aside>
        </form>
      )}
      {!loading && error && !defaults && <div className="creator-loading creator-loading-error"><strong>Print Card Creator could not open.</strong><span>{error}</span></div>}
    </Modal>
  );
}
