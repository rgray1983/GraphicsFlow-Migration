import { useEffect, useState } from 'react';
import { formatGNumber, type GraphicFileMatch, type GraphicRecord } from '@graphicsflow/shared';
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
  const imageUrl = `/api/graphics/${record.id}/print-card.jpg?v=${cacheKey}`;

  useEffect(() => {
    if (isOpen) setCacheKey(Date.now());
  }, [isOpen, record.id]);

  const printCard = () => {
    const popup = window.open(imageUrl, '_blank', 'noopener,noreferrer');
    popup?.addEventListener('load', () => popup.print(), { once: true });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Print Card`} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-toolbar">
          <div className="viewer-control-group"><span>Production JPG · 10 × 4 in · 300 DPI</span></div>
          <div className="viewer-control-group viewer-actions">
            <button onClick={printCard} type="button">Print</button>
            <a download={file?.name ?? `${record.gNumber}.jpg`} href={imageUrl}>Download JPG</a>
          </div>
        </div>
        <div className="approval-viewer-layout">
          <div className="approval-canvas"><img alt={`${formatGNumber(record.gNumber)} print card`} draggable={false} src={imageUrl} /></div>
          <aside className="approval-viewer-details">
            <p className="eyebrow">Print Card details</p>
            <h3>{record.customerName || 'Customer not recorded'}</h3>
            <dl>
              <div><dt>G#</dt><dd>{formatGNumber(record.gNumber)}</dd></div>
              <div><dt>Customer #</dt><dd>{record.customerNumber || 'Not recorded'}</dd></div>
              <div><dt>Part Number</dt><dd>{record.partNumber || 'Not recorded'}</dd></div>
              <div><dt>File</dt><dd>{file?.name ?? 'GraphicsFlow production JPG'}</dd></div>
              <div><dt>Modified</dt><dd>{file ? formatDate(file.modifiedAt) : 'Just generated'}</dd></div>
              <div><dt>File Size</dt><dd>{file ? formatFileSize(file.size) : 'Refreshing…'}</dd></div>
            </dl>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
