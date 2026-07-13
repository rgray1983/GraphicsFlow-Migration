import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { formatGNumber, type GraphicFileMatch, type GraphicRecord } from '@graphicsflow/shared';
import { Modal } from './Modal';

type ApprovalViewerProps = {
  approval: GraphicFileMatch | null;
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

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
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const imageUrl = `/api/previews/${record.id}/medium/image`;
  const pdfUrl = `/api/graphics/${record.id}/approval.pdf`;

  useEffect(() => {
    if (!isOpen) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setSpaceHeld(false);
    setDragging(false);
  }, [isOpen, record.id]);

  useEffect(() => {
    if (!isOpen) return;

    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest('input, textarea, select, button, a, [contenteditable="true"]'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
      setDragging(false);
      dragRef.current = null;
    };
    const handleBlur = () => {
      setSpaceHeld(false);
      setDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isOpen]);

  const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  const changeScale = (next: number) => {
    const clamped = clampScale(next);
    setScale(clamped);
    if (clamped <= 1) setOffset({ x: 0, y: 0 });
  };

  const fitApproval = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeScale(scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!spaceHeld || scale <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

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

  const canvasClassName = [
    'approval-canvas',
    scale > 1 ? 'is-zoomed' : '',
    spaceHeld ? 'is-hand-tool' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Approval`} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-toolbar" aria-label="Approval viewer controls">
          <div className="viewer-control-group">
            <button aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => changeScale(scale - SCALE_STEP)} type="button">−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => changeScale(scale + SCALE_STEP)} type="button">+</button>
            <button onClick={fitApproval} type="button">Fit</button>
          </div>
          <div className="viewer-control-group viewer-actions">
            <button onClick={printApproval} type="button">Print</button>
            <a download href={`${pdfUrl}?download=1`}>Download PDF</a>
          </div>
        </div>

        <div className="approval-viewer-layout">
          <div
            className={canvasClassName}
            onPointerCancel={stopDragging}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onWheel={handleWheel}
          >
            <img
              alt={`${formatGNumber(record.gNumber)} approval`}
              draggable={false}
              src={imageUrl}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            />
          </div>

          <aside className="approval-viewer-details">
            <p className="eyebrow">Approval details</p>
            <h3>{record.customerName || 'Customer not recorded'}</h3>
            <dl>
              <div><dt>G#</dt><dd>{formatGNumber(record.gNumber)}</dd></div>
              <div><dt>Customer #</dt><dd>{record.customerNumber || 'Not recorded'}</dd></div>
              <div><dt>Part Number</dt><dd>{record.partNumber || 'Not recorded'}</dd></div>
              <div><dt>File</dt><dd>{approval?.name ?? 'Not available'}</dd></div>
              <div><dt>Modified</dt><dd>{approval ? formatDate(approval.modifiedAt) : 'Not available'}</dd></div>
              <div><dt>File Size</dt><dd>{approval ? formatFileSize(approval.size) : 'Not available'}</dd></div>
            </dl>
            <p className="viewer-help">Hold Command or Control while scrolling to zoom. Hold Spacebar for the hand tool, then drag to pan while zoomed in.</p>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
