import { useCallback, useEffect, useRef, useState } from 'react';
import { formatGNumber, type GraphicFileMatch, type GraphicRecord } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';

type ApprovalViewerProps = { approval: GraphicFileMatch | null; isOpen: boolean; onClose: () => void; record: GraphicRecord };
type ApprovalHeaderMetadata = { specificationNumber?: string };

function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function formatFileSize(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function identifierValue(value: string): string { return value.trim().replace(/^[GSF]\s*#?\s*/i, '') || value.trim(); }

export function ApprovalViewer({ approval, isOpen, onClose, record }: ApprovalViewerProps) {
  const [highQuality, setHighQuality] = useState(false);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [approvalSpecNumber, setApprovalSpecNumber] = useState('');
  const imageRef = useRef<HTMLImageElement | null>(null);
  const variant = highQuality ? 'large' : 'medium';
  const imageUrl = `/api/previews/${record.id}/${variant}/image`;
  const pdfUrl = `/api/graphics/${record.id}/approval.pdf`;

  useEffect(() => {
    if (!isOpen) return;
    setHighQuality(false); setQualityLoading(true); setApprovalSpecNumber(record.specificationNumber.trim());
    const controller = new AbortController();
    void fetch(`/api/graphics/${record.id}/approval/metadata`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<ApprovalHeaderMetadata> : null)
      .then((metadata) => { const extracted = metadata?.specificationNumber?.trim(); if (extracted) setApprovalSpecNumber(extracted); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) return; });
    return () => controller.abort();
  }, [isOpen, record.id, record.specificationNumber]);

  useEffect(() => {
    if (!isOpen) return;
    setQualityLoading(true);
    const frame = window.requestAnimationFrame(() => { const image = imageRef.current; if (image?.complete && image.naturalWidth > 0) setQualityLoading(false); });
    return () => window.cancelAnimationFrame(frame);
  }, [imageUrl, isOpen]);

  const handleScaleChange = useCallback((scale: number) => {
    if (scale > 3 && !highQuality) { setQualityLoading(true); setHighQuality(true); }
  }, [highQuality]);

  const printApproval = () => { const iframe = document.createElement('iframe'); iframe.className = 'approval-print-frame'; iframe.setAttribute('aria-hidden', 'true'); iframe.src = pdfUrl; iframe.onload = () => window.setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }, 250); document.body.appendChild(iframe); window.setTimeout(() => iframe.remove(), 60_000); };
  const toggleHighQuality = () => { setQualityLoading(true); setHighQuality((current) => !current); };
  const gNumber = identifierValue(record.gNumber);
  const specNumber = approvalSpecNumber ? identifierValue(approvalSpecNumber) : 'NONE';
  const loadingOverlay = qualityLoading ? <LoadingIndicator message={`Preparing the ${highQuality ? '600 DPI' : '300 DPI'} Approval preview…`} size="viewer" title={highQuality ? 'Sharpening Preview' : 'Opening Approval'} /> : null;

  return <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Approval`} variant="viewer"><div className="approval-viewer"><div className="approval-viewer-layout"><div className="approval-document-canvas"><DocumentCanvas ariaLabel={`${formatGNumber(record.gNumber)} Approval viewer`} className="approval-document-stage" fitScale={1} isActive={isOpen} onEscape={onClose} onScaleChange={handleScaleChange} overlay={loadingOverlay} renderAtLayoutScale={false} toolbarEnd={<><label className="viewer-quality-toggle"><input checked={highQuality} onChange={toggleHighQuality} type="checkbox" /><span className="viewer-quality-track" aria-hidden="true"><span /></span><span className="viewer-quality-label">{highQuality ? '600 DPI' : '300 DPI · Auto at 300%'}</span></label><button onClick={printApproval} type="button">Print</button><a download href={`${pdfUrl}?download=1`}>Download PDF</a></>}><div className="approval-document-sheet"><img alt={`${formatGNumber(record.gNumber)} approval`} draggable={false} key={imageUrl} onError={() => { if (highQuality) setHighQuality(false); setQualityLoading(false); }} onLoad={() => setQualityLoading(false)} ref={imageRef} src={imageUrl} /></div></DocumentCanvas></div><aside className="approval-viewer-details"><p className="eyebrow">Approval details</p><h3>{record.customerName || 'Customer not recorded'}</h3><dl><div><dt>G#</dt><dd>{gNumber}</dd></div><div><dt>Customer #</dt><dd>{record.customerNumber || 'Not recorded'}</dd></div><div><dt>Spec #</dt><dd>{specNumber}</dd></div><div><dt>Part Number</dt><dd>{record.partNumber || 'Not recorded'}</dd></div><div><dt>File</dt><dd>{approval?.name ?? 'Not available'}</dd></div><div><dt>Modified</dt><dd>{approval ? formatDate(approval.modifiedAt) : 'Not available'}</dd></div><div><dt>File Size</dt><dd>{approval ? formatFileSize(approval.size) : 'Not available'}</dd></div></dl><section className="viewer-hotkeys" aria-labelledby="approval-viewer-help-title"><h4 id="approval-viewer-help-title">Viewer Controls</h4><div className="viewer-hotkey-row"><span className="viewer-hotkey-icon" aria-hidden="true">↕</span><div><strong>Scroll Zoom</strong><span>Automatically switches from 300 DPI to 600 DPI above 300%</span></div></div><div className="viewer-hotkey-row"><span className="viewer-hotkey-icon" aria-hidden="true">↔</span><div><strong>Click and drag</strong><span>Pan the document while zoomed</span></div></div><div className="viewer-hotkey-row"><kbd>Esc</kbd><div><strong>Close viewer</strong><span>Return to the current page</span></div></div></section></aside></div></div></Modal>;
}