import { useEffect, useState } from 'react';
import {
  formatGNumber,
  formatSpecNumber,
  type GraphicFileMatch,
  type GraphicRecord,
  type PrintCardDetailsResponse,
} from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';

type Props = {
  file: GraphicFileMatch | null;
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord;
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

export function PrintCardViewer({ file, isOpen, onClose, record }: Props) {
  const [cacheKey, setCacheKey] = useState(0);
  const [details, setDetails] = useState<PrintCardDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
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
    setDetailsLoading(true);
    void fetch(`/api/graphics/${record.id}/print-card/details`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Print Card details could not be loaded.');
        return response.json() as Promise<PrintCardDetailsResponse>;
      })
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setDetailsLoading(false));
  }, [isOpen, record.id]);

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

  const revision = details?.revision;
  const downloadParams = new URLSearchParams(params);
  downloadParams.set('download', '1');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Print Card`} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-layout">
          <div className="approval-document-canvas">
            <DocumentCanvas
              ariaLabel={`${formatGNumber(record.gNumber)} Print Card viewer`}
              className="approval-document-stage"
              fitScale={1}
              isActive={isOpen}
              onEscape={onClose}
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
                {imageLoading && <div className="approval-quality-loading">
                  <LoadingIndicator message="Loading the selected Print Card image…" size="viewer" title="Opening Print Card" />
                </div>}
                {imageError && <div className="approval-quality-loading">
                  <div className="revision-open-error">The Print Card image could not be opened.</div>
                </div>}
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
              <div><dt>Modified</dt><dd>{file ? formatDate(file.modifiedAt) : 'Just generated'}</dd></div>
              <div><dt>File Size</dt><dd>{file ? formatFileSize(file.size) : 'Not available'}</dd></div>
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
