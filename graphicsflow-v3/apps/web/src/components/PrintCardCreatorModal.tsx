import {
  formatGNumber,
  renderPrintCardSvg,
  type CreatePrintCardResponse,
  type GraphicRecord,
  type PrintCardDefaultsResponse,
  type PrintCardDraft,
} from '@graphicsflow/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import './PrintCardCreatorModal.css';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (result: CreatePrintCardResponse) => void | Promise<void>;
  record: GraphicRecord | null;
};

type PanPoint = { x: number; y: number };
type SourceKind = 'approval' | 'previous' | 'manual' | 'required' | 'system';

const emptyDraft: PrintCardDraft = {
  specificationNumber: '', designNumber: '', revisionLabel: '0', revisionDate: '', description: '',
  csr: '', designer: '', replaceExistingImage: false, artPdfName: '', artPdfBase64: '',
};

const requiredFields: Array<keyof Pick<PrintCardDraft, 'specificationNumber' | 'revisionLabel' | 'revisionDate' | 'description' | 'csr' | 'designer'>> = [
  'specificationNumber', 'revisionLabel', 'revisionDate', 'description', 'csr', 'designer',
];

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

function sourceKind(source: string, value: string): SourceKind {
  if (!value.trim() || /manual entry needed|required/i.test(source)) return 'required';
  if (/approval/i.test(source)) return 'approval';
  if (/print card|previous/i.test(source)) return 'previous';
  if (/today|initial|next|system|metadata/i.test(source)) return 'system';
  return 'manual';
}

function sourceLabel(kind: SourceKind, source: string): string {
  if (kind === 'approval') return `Approval · ${source.replace(/approval\s*/i, '').trim() || 'revision'}`;
  if (kind === 'previous') return 'Previous Print Card';
  if (kind === 'required') return 'Required';
  if (kind === 'system') return source || 'GraphicsFlow';
  return 'Manual';
}

function SourceBadge({ source, value }: { source: string; value: string }) {
  const kind = sourceKind(source, value);
  const icon = kind === 'approval' ? '✓' : kind === 'previous' ? '↺' : kind === 'required' ? '!' : kind === 'system' ? '◆' : '✎';
  return <span className={`creator-source-badge is-${kind}`} title={source}><b>{icon}</b>{sourceLabel(kind, source)}</span>;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanPoint>({ x: 0, y: 0 });
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    if (!isOpen || !record) return;
    let cancelled = false;
    setLoading(true); setError(null); setPreviewOpen(false);
    setArtPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
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

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
      if (event.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(4, value + .25));
      if (event.key === '-') setZoom((value) => Math.max(.5, value - .25));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const close = () => {
    if (saving || readingFile) return;
    if (dirty && !window.confirm('Discard the Print Card changes?')) return;
    onClose();
  };

  const revisions = useMemo(() => [
    ...(defaults?.history ?? []).map((row) => ({ revisionLabel: row.revisionLabel, revisionDate: row.revisionDate, description: row.description, csr: row.csr, designer: row.designer })),
    { revisionLabel: draft.revisionLabel, revisionDate: draft.revisionDate, description: draft.description, csr: draft.csr, designer: draft.designer },
  ].slice(-4), [defaults?.history, draft]);

  const infoSvg = useMemo(() => {
    if (!record) return '';
    return renderPrintCardSvg({
      gNumber: record.gNumber, customerNumber: record.customerNumber, customerName: record.customerName,
      partNumber: record.partNumber, specificationNumber: draft.specificationNumber, designNumber: draft.designNumber,
      revisions,
    });
  }, [draft.designNumber, draft.specificationNumber, record, revisions]);

  const missing = useMemo(() => {
    const fields = requiredFields.filter((field) => !String(draft[field] ?? '').trim()).map((field) => ({
      specificationNumber: 'Spec #', revisionLabel: 'Revision', revisionDate: 'Revision Date', description: 'Description', csr: 'CSR', designer: 'Designer',
    }[field]));
    if (!draft.artPdfBase64 && !draft.replaceExistingImage) fields.unshift('Artwork PDF');
    return fields;
  }, [draft]);

  const readinessTotal = requiredFields.length + 1;
  const readinessComplete = readinessTotal - missing.length;
  const readinessPercent = Math.max(0, Math.round((readinessComplete / readinessTotal) * 100));
  const update = <K extends keyof PrintCardDraft>(key: K, value: PrintCardDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const chooseArtwork = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Print Card artwork must be a PDF.'); return; }
    setReadingFile(true); setError(null);
    try {
      const base64 = await fileToBase64(file);
      const previewResponse = await fetch('/api/print-card/artwork-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artPdfBase64: base64 }),
      });
      if (!previewResponse.ok) throw new Error(await readError(previewResponse, 'The artwork preview could not be generated.'));
      const previewBlob = await previewResponse.blob();
      const nextPreviewUrl = URL.createObjectURL(previewBlob);
      setArtPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return nextPreviewUrl; });
      setDraft((current) => ({ ...current, artPdfName: file.name, artPdfBase64: base64 }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The artwork PDF could not be read.');
    } finally { setReadingFile(false); }
  };

  const openPreview = () => { setZoom(1); setPan({ x: 0, y: 0 }); setPreviewOpen(true); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!record || saving) return;
    if (missing.length) { setError(`Complete the required Print Card information: ${missing.join(', ')}.`); return; }
    if (draft.replaceExistingImage) {
      const confirmed = window.confirm('Replace the existing Print Card image?\n\nThis preserves the existing 9-inch artwork when no new PDF is selected, rebuilds the information panel, and does not create a new revision.');
      if (!confirmed) return;
    }
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

  const previewCard = (
    <div className="print-card-production-preview">
      <div className="print-card-art-preview">{artPreviewUrl ? <img alt="Converted artwork preview" src={artPreviewUrl} /> : <span>{readingFile ? 'Converting artwork…' : 'Upload the 9 × 4 artwork PDF'}</span>}</div>
      <div className="print-card-info-preview" dangerouslySetInnerHTML={{ __html: infoSvg }} />
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={close} title={record ? `Print Card Workspace · ${formatGNumber(record.gNumber)}` : 'Print Card Workspace'} variant="creator">
      {loading && <div className="creator-loading">Reading GraphicsFlow metadata and approval fields…</div>}
      {!loading && record && defaults && (
        <form className="print-card-creator" onSubmit={submit}>
          <section className="creator-editor">
            <div className="creator-intro">
              <div><span className="creator-kicker">Document Workspace</span><h3>Create Print Card</h3><p>Prepare production artwork, verify imported metadata, and generate the 300 DPI card.</p></div>
              <div className={`creator-readiness${missing.length === 0 ? ' is-ready' : ''}`}>
                <div><span>Production Ready</span><strong>{readinessPercent}%</strong></div>
                <div className="creator-readiness-track"><i style={{ width: `${readinessPercent}%` }} /></div>
                <small>{missing.length ? `Missing: ${missing.join(', ')}` : 'All required production information is complete.'}</small>
              </div>
            </div>
            <div className="creator-record-summary"><div><span>Customer #</span><strong>{record.customerNumber}</strong></div><div><span>Customer</span><strong>{record.customerName}</strong></div><div><span>Part #</span><strong>{record.partNumber}</strong></div></div>
            <section className="creator-work-section">
              <header><div><span className="creator-step">01</span><div><h4>Artwork</h4><p>Converted server-side at 300 DPI for preview and production.</p></div></div><span className={`creator-step-state${artPreviewUrl || draft.replaceExistingImage ? ' is-complete' : ''}`}>{artPreviewUrl || draft.replaceExistingImage ? 'Ready' : 'Required'}</span></header>
              <label className="creator-artwork-upload"><input accept="application/pdf,.pdf" onChange={(event) => void chooseArtwork(event.target.files?.[0])} type="file" /><span><strong>{readingFile ? 'Converting PDF…' : draft.artPdfName || 'Choose 9 × 4 in artwork PDF'}</strong><small>{draft.artPdfName ? 'Artwork is ready for inspection.' : 'The PDF becomes the left 9 inches of the production JPG.'}</small></span></label>
            </section>
            <section className="creator-work-section">
              <header><div><span className="creator-step">02</span><div><h4>Production Metadata</h4><p>Each badge shows where GraphicsFlow obtained the value.</p></div></div></header>
              <div className="creator-fields">
                <label><span>Spec # <SourceBadge source={defaults.autoFill.sources.specificationNumber} value={draft.specificationNumber} /></span><input autoFocus required value={draft.specificationNumber} onChange={(event) => update('specificationNumber', event.target.value.toUpperCase())} /></label>
                <label><span>Design # <SourceBadge source={defaults.autoFill.sources.designNumber} value={draft.designNumber} /></span><input value={draft.designNumber} onChange={(event) => update('designNumber', event.target.value.toUpperCase())} /></label>
                <label><span>Revision <SourceBadge source={defaults.autoFill.sources.revisionLabel} value={draft.revisionLabel} /></span><input required value={draft.revisionLabel} onChange={(event) => update('revisionLabel', event.target.value.toUpperCase())} /></label>
                <label><span>Revision Date <SourceBadge source={defaults.autoFill.sources.revisionDate} value={draft.revisionDate} /></span><input required value={draft.revisionDate} onChange={(event) => update('revisionDate', event.target.value.toUpperCase())} /></label>
                <label className="creator-field-wide"><span>Description <SourceBadge source={defaults.autoFill.sources.description} value={draft.description} /></span><input required value={draft.description} onChange={(event) => update('description', event.target.value.toUpperCase())} /></label>
                <label><span>CSR <SourceBadge source={defaults.autoFill.sources.csr} value={draft.csr} /></span><input required value={draft.csr} onChange={(event) => update('csr', event.target.value.toUpperCase())} /></label>
                <label><span>Designer <SourceBadge source={defaults.autoFill.sources.designer} value={draft.designer} /></span><input required value={draft.designer} onChange={(event) => update('designer', event.target.value.toUpperCase())} /></label>
              </div>
            </section>
            <label className="replace-option"><input checked={draft.replaceExistingImage} onChange={(event) => update('replaceExistingImage', event.target.checked)} type="checkbox" /><span><strong>Replace Existing Image</strong><small>Without a new PDF, preserve the existing 9-inch artwork and rebuild only the information panel. No new revision is created.</small></span></label>
            {defaults.history.length > 0 && <section className="creator-history"><div><span className="creator-kicker">Existing Data</span><h4>Recent Print Card Revisions</h4></div><ol>{defaults.history.slice(-4).reverse().map((row, index) => <li key={`${row.id ?? 'legacy'}-${index}`}><strong>Rev {row.revisionLabel || '0'}</strong><span>{row.revisionDate || 'No date'} · {row.description || 'No description'}</span><small>{row.source === 'legacy-import' ? 'Legacy import' : 'GraphicsFlow'}</small></li>)}</ol></section>}
            {error && <div className="creator-error" role="alert">{error}</div>}
            <footer className="creator-actions"><button className="secondary" onClick={close} type="button">Cancel</button><button className="primary" disabled={saving || readingFile || missing.length > 0} type="submit">{saving ? 'Generating Print Card…' : 'Generate Print Card'}</button></footer>
          </section>
          <aside className="creator-preview-panel">
            <div className="creator-preview-heading"><div><span className="creator-kicker">Production Thumbnail</span><h3>10 × 4 in · 300 DPI</h3></div><span>9 in art + 1 in info</span></div>
            <button className="creator-thumbnail-button" onClick={openPreview} type="button" aria-label="Open large production preview">{previewCard}<span>Open Production Preview</span></button>
            <div className="creator-preview-summary"><strong>{artPreviewUrl ? 'Artwork converted' : 'Artwork waiting'}</strong><span>{missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} remaining` : 'Ready for final inspection'}</span></div>
            <button className="open-production-preview" onClick={openPreview} type="button">Open Production Preview</button>
            <p>The large preview uses the converted artwork and the same structured revision data used by the production renderer.</p>
          </aside>
          {previewOpen && (
            <div className="production-preview-workspace" role="dialog" aria-modal="true" aria-label="Production Print Card Preview">
              <header><div><span className="creator-kicker">Production Preview</span><h2>{formatGNumber(record.gNumber)} · 10 × 4 in</h2></div><div className="production-preview-controls"><button onClick={() => { setZoom(.75); setPan({ x: 0, y: 0 }); }} type="button">Fit</button>{[1, 2, 4].map((value) => <button className={zoom === value ? 'is-active' : ''} key={value} onClick={() => { setZoom(value); setPan({ x: 0, y: 0 }); }} type="button">{value * 100}%</button>)}<button className="close-preview" onClick={() => setPreviewOpen(false)} type="button">Close</button></div></header>
              <div className="production-preview-stage" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(4, Math.max(.5, value + (event.deltaY < 0 ? .25 : -.25)))); }} onPointerDown={(event) => { dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragOrigin.current) return; setPan({ x: dragOrigin.current.panX + event.clientX - dragOrigin.current.pointerX, y: dragOrigin.current.panY + event.clientY - dragOrigin.current.pointerY }); }} onPointerUp={(event) => { dragOrigin.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}><div className="production-preview-card" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{previewCard}</div></div>
              <footer><span>Scroll to zoom · drag to pan · Esc to close</span><strong>{Math.round(zoom * 100)}%</strong></footer>
            </div>
          )}
        </form>
      )}
      {!loading && error && !defaults && <div className="creator-loading creator-loading-error"><strong>Print Card Creator could not open.</strong><span>{error}</span></div>}
    </Modal>
  );
}
