import { useEffect, useState } from 'react';
import {
  formatGNumber,
  formatSpecNumber,
  type GraphicFileMatch,
  type GraphicRecord,
  type PrintCardDetailsResponse,
  type RevisionJourneyEntry,
} from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';

type Props = {
  file: GraphicFileMatch | null;
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord;
  selectedRevision?: RevisionJourneyEntry | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function PrintCardViewer({ file, isOpen, onClose, record, selectedRevision = null }: Props) {
  const [cacheKey, setCacheKey] = useState(0);
  const [details, setDetails] = useState<PrintCardDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [resolvedFileSize, setResolvedFileSize] = useState<number | null>(null);
  const params = new URLSearchParams({
    v: String(cacheKey),
    specificationNumber: record.specificationNumber,
  });
  const imageUrl = `/api/graphics/${record.id}/print-card.jpg?${params.toString()}`;

  useEffect(() => {
    if (!isOpen) return;
    setCacheKey(Date.now());
    setImageLoading(true);
    setImageError(false);
    setResolvedFileSize(file?.size ?? null);
    setDetailsLoading(!selectedRevision);
    if (selectedRevision) {
      setDetails(null);
      return;
    }
    void fetch(`/api/graphics/${record.id}/print-card/details`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Print Card details could not be loaded.');
        return response.json() as Promise<PrintCardDetailsResponse>;
      })
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setDetailsLoading(false));
  }, [file?.size, isOpen, record.id, selectedRevision]);

  useEffect(() => {
    if (!isOpen || resolvedFileSize !== null) return;
    const controller = new AbortController();
    void fetch(imageUrl, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const contentLength = Number(response.headers.get('Content-Length'));
        if (Number.isFinite(contentLength) && contentLength > 0) return contentLength;
        const fallback = await fetch(imageUrl, { cache: 'no-store', signal: controller.signal });
        if (!fallback.ok) return null;
        return (await fallback.blob()).size;
      })
      .then((size) => { if (size) setResolvedFileSize(size); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [imageUrl, isOpen, resolvedFileSize]);

  const printCard = () => {
    const iframe = document.createElement('iframe');
    iframe.className = 'approval-print-frame';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = imageUrl;
    iframe.onload = () => {
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      }, 250);
    };
    document.body.appendChild(iframe);
    window.setTimeout(() => iframe.remove(), 60_000);
  };

  const storedRevision = details?.revision;
  const revision = selectedRevision ? {
    specificationNumber: record.specificationNumber,
    designNumber: storedRevision?.designNumber ?? '',
    revisionLabel: selectedRevision.revisionLabel,
    revisionDate: selectedRevision.revisionDate,
    description: selectedRevision.description,
    csr: selectedRevision.csr,
    designer: selectedRevision.designer,
  } : storedRevision;
  const downloadParams = new URLSearchParams(params);
  downloadParams.set('download', '1');
  const viewerOverlay = imageLoading ? (
    <LoadingIndicator message="Loading the selected Print Card image…" size="viewer" title="Opening Print Card" />
  ) : imageError ? (
    <div className="revision-open-error">The Print Card image could not be opened.</div>
  ) : null;
  const selectedLabel = selectedRevision?.revisionLabel?.trim();
  const title = selectedLabel ? `${formatGNumber(record.gNumber)} Print Card · Revision ${selectedLabel}` : `${formatGNumber(record.gNumber)} Print Card`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-layout">
          <div className="approval-document-canvas">
            <DocumentCanvas
              ariaLabel={`${formatGNumber(record.gNumber)} Print Card viewer`}
              className="approval-document-stage"
              fitScale={1}
              isActive={isOpen}
              onEscape={onClose}
              overlay={viewerOverlay}
              renderAtLayoutScale={false}
              toolbarEnd={<>
                <button onClick={printCard} type="button">Print</button>
                <a download={file?.name ?? `${record.gNumber}.jpg`} href={`/api/graphics/${record.id}/print-card.jpg?${downloadParams.toString()}`}>Download JPG</a>
              </>}
            >
              <div className="approval-document-sheet">
                <img
                  alt={`${formatGNumber(record.gNumber)} print card`}
                  draggable={false}
                  key={imageUrl}
                  onError={() => { setImageError(true); setImageLoading(false); }}
                  onLoad={() => setImageLoading(false)}
                  src={imageUrl}
                />
              </div>
            </DocumentCanvas>
          </div>

          <aside className="approval-viewer-details">
            <p className="eyebrow">Print Card details</p>
            <h3>{record.customerName || 'Customer not recorded'}</h3>
            <dl>
              <div><dt>G#</dt><dd>{formatGNumber(record.gNumber)}</dd></div>
              <div><dt>Customer #</dt><dd>{record.customerNumber || 'Not recorded'}</dd></div>
              <div><dt>Spec #</dt><dd>{revision?.specificationNumber ? formatSpecNumber(revision.specificationNumber) : record.specificationNumber ? formatSpecNumber(record.specificationNumber) : 'NONE'}</dd></div>
              <div><dt>Design #</dt><dd>{revision?.designNumber || 'NONE'}</dd></div>
              <div><dt>Revision</dt><dd>{revision?.revisionLabel || 'Not recorded'}</dd></div>
              <div><dt>Revision Date</dt><dd>{revision?.revisionDate || 'Not recorded'}</dd></div>
              <div><dt>Description</dt><dd>{revision?.description || 'Not recorded'}</dd></div>
              <div><dt>CSR</dt><dd>{revision?.csr || 'Not recorded'}</dd></div>
              <div><dt>Designer</dt><dd>{revision?.designer || 'Not recorded'}</dd></div>
              <div><dt>Part Number</dt><dd>{record.partNumber || 'Not recorded'}</dd></div>
              <div><dt>File</dt><dd>{file?.name ?? 'GraphicsFlow production JPG'}</dd></div>
              <div><dt>Modified</dt><dd>{file ? formatDate(file.modifiedAt) : selectedRevision?.createdAt ? formatDate(selectedRevision.createdAt) : 'Just generated'}</dd></div>
              <div><dt>File Size</dt><dd>{resolvedFileSize !== null ? formatFileSize(resolvedFileSize) : 'Calculating…'}</dd></div>
            </dl>
            {detailsLoading && <p className="muted">Loading structured Print Card data…</p>}

            <section className="viewer-hotkeys" aria-labelledby="print-card-viewer-help-title">
              <h4 id="print-card-viewer-help-title">Viewer Controls</h4>
              <div className="viewer-hotkey-row"><span className="viewer-hotkey-icon" aria-hidden="true">↕</span><div><strong>Scroll Zoom</strong><span>Zoom toward the pointer anywhere over the document</span></div></div>
              <div className="viewer-hotkey-row"><span className="viewer-hotkey-icon" aria-hidden="true">↔</span><div><strong>Click and drag</strong><span>Pan the document while zoomed</span></div></div>
              <div className="viewer-hotkey-row viewer-touch-help"><span className="viewer-hotkey-icon" aria-hidden="true">◎</span><div><strong>Pinch or one-finger drag</strong><span>Zoom and pan on touch screens</span></div></div>
              <div className="viewer-hotkey-row"><kbd>Esc</kbd><div><strong>Close viewer</strong><span>Return to the Revisions workspace</span></div></div>
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
