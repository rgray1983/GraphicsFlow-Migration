import { useEffect, useState } from 'react';
import { formatGNumber, formatSpecNumber, type GraphicFileMatch, type GraphicRecord } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';

type ApprovalViewerProps = {
  approval: GraphicFileMatch | null;
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord;
};

type ApprovalHeaderMetadata = { specificationNumber?: string };

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function ApprovalViewer({ approval, isOpen, onClose, record }: ApprovalViewerProps) {
  const [highQuality, setHighQuality] = useState(false);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [approvalSpecNumber, setApprovalSpecNumber] = useState('');
  const variant = highQuality ? 'large' : 'medium';
  const imageUrl = `/api/previews/${record.id}/${variant}/image`;
  const pdfUrl = `/api/graphics/${record.id}/approval.pdf`;

  useEffect(() => {
    if (!isOpen) return;
    setHighQuality(false);
    setQualityLoading(false);
    setApprovalSpecNumber(record.specificationNumber.trim());

    const controller = new AbortController();
    void fetch(`/api/graphics/${record.id}/approval/metadata`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<ApprovalHeaderMetadata>;
      })
      .then((metadata) => {
        const extracted = metadata?.specificationNumber?.trim();
        if (extracted) setApprovalSpecNumber(extracted);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [isOpen, record.id, record.specificationNumber]);

  const printApproval = () => {
    const iframe = document.createElement('iframe');
    iframe.className = 'approval-print-frame';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = pdfUrl;
    iframe.onload = () => {
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      }, 250);
    };
    document.body.appendChild(iframe);
    window.setTimeout(() => iframe.remove(), 60_000);
  };

  const toggleHighQuality = () => {
    setQualityLoading(true);
    setHighQuality((current) => !current);
  };

  const specNumber = approvalSpecNumber
    ? formatSpecNumber(approvalSpecNumber)
    : 'NONE';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Approval`} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-layout">
          <div className="approval-document-canvas">
            <DocumentCanvas
              ariaLabel={`${formatGNumber(record.gNumber)} Approval viewer`}
              className="approval-document-stage"
              fitScale={1}
              isActive={isOpen}
              onEscape={onClose}
              renderAtLayoutScale={false}
              toolbarEnd={<>
                <label className="viewer-quality-toggle">
                  <input checked={highQuality} onChange={toggleHighQuality} type="checkbox" />
                  <span className="viewer-quality-track" aria-hidden="true"><span /></span>
                  <span className="viewer-quality-label">High Quality</span>
                </label>
                <button onClick={printApproval} type="button">Print</button>
                <a download href={`${pdfUrl}?download=1`}>Download PDF</a>
              </>}
            >
              <div className="approval-document-sheet">
                <img
                  alt={`${formatGNumber(record.gNumber)} approval`}
                  draggable={false}
                  key={imageUrl}
                  onError={() => {
                    if (highQuality) setHighQuality(false);
                    setQualityLoading(false);
                  }}
                  onLoad={() => setQualityLoading(false)}
                  src={imageUrl}
                />
                {qualityLoading && <div className="approval-quality-loading">
                  <LoadingIndicator
                    message={`Preparing the ${highQuality ? 'high-quality' : 'standard'} Approval preview…`}
                    size="viewer"
                    title="Updating Preview"
                  />
                </div>}
              </div>
            </DocumentCanvas>
          </div>

          <aside className="approval-viewer-details">
            <p className="eyebrow">Approval details</p>
            <h3>{record.customerName || 'Customer not recorded'}</h3>
            <dl>
              <div><dt>G#</dt><dd>{formatGNumber(record.gNumber)}</dd></div>
              <div><dt>Customer #</dt><dd>{record.customerNumber || 'Not recorded'}</dd></div>
              <div><dt>Spec #</dt><dd>{specNumber}</dd></div>
              <div><dt>Part Number</dt><dd>{record.partNumber || 'Not recorded'}</dd></div>
              <div><dt>File</dt><dd>{approval?.name ?? 'Not available'}</dd></div>
              <div><dt>Modified</dt><dd>{approval ? formatDate(approval.modifiedAt) : 'Not available'}</dd></div>
              <div><dt>File Size</dt><dd>{approval ? formatFileSize(approval.size) : 'Not available'}</dd></div>
            </dl>

            <section className="viewer-hotkeys" aria-labelledby="approval-viewer-help-title">
              <h4 id="approval-viewer-help-title">Viewer Controls</h4>
              <div className="viewer-hotkey-row">
                <span className="viewer-hotkey-icon" aria-hidden="true">↕</span>
                <div><strong>Scroll Zoom</strong><span>Zoom toward the pointer anywhere over the document</span></div>
              </div>
              <div className="viewer-hotkey-row">
                <span className="viewer-hotkey-icon" aria-hidden="true">↔</span>
                <div><strong>Click and drag</strong><span>Pan the document while zoomed</span></div>
              </div>
              <div className="viewer-hotkey-row viewer-touch-help">
                <span className="viewer-hotkey-icon" aria-hidden="true">◎</span>
                <div><strong>Pinch or one-finger drag</strong><span>Zoom and pan on touch screens</span></div>
              </div>
              <div className="viewer-hotkey-row">
                <kbd>Esc</kbd>
                <div><strong>Close viewer</strong><span>Return to the current page</span></div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
