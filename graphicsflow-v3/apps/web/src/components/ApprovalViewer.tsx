import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { formatGNumber, formatSpecNumber, type GraphicFileMatch, type GraphicRecord } from '@graphicsflow/shared';
import { Modal } from './Modal';

type ApprovalViewerProps = {
  approval: GraphicFileMatch | null;
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord;
};

type ActivePointer = { x: number; y: number; type: string };

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

function pointerDistance(first: ActivePointer, second: ActivePointer): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function ApprovalViewer({ approval, isOpen, onClose, record }: ApprovalViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [highQuality, setHighQuality] = useState(false);
  const [qualityLoading, setQualityLoading] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pointersRef = useRef(new Map<number, ActivePointer>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const variant = highQuality ? 'large' : 'medium';
  const imageUrl = `/api/previews/${record.id}/${variant}/image`;
  const pdfUrl = `/api/graphics/${record.id}/approval.pdf`;

  useEffect(() => {
    if (!isOpen) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setSpaceHeld(false);
    setDragging(false);
    setHighQuality(false);
    setQualityLoading(false);
    dragRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
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
      pointersRef.current.clear();
      pinchRef.current = null;
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

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });

    if (event.pointerType === 'touch') {
      event.preventDefault();
      const touches = [...pointersRef.current.values()].filter((pointer) => pointer.type === 'touch');
      if (touches.length === 2) {
        pinchRef.current = { distance: pointerDistance(touches[0], touches[1]), scale };
        dragRef.current = null;
        setDragging(false);
      } else if (touches.length === 1 && scale > 1) {
        beginDrag(event);
      }
      return;
    }

    if (!spaceHeld || scale <= 1) return;
    event.preventDefault();
    beginDrag(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    }

    const touches = [...pointersRef.current.values()].filter((pointer) => pointer.type === 'touch');
    if (touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const distance = pointerDistance(touches[0], touches[1]);
      changeScale(pinchRef.current.scale * (distance / Math.max(1, pinchRef.current.distance)));
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const stopPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    const remainingTouches = [...pointersRef.current.values()].filter((pointer) => pointer.type === 'touch');
    if (remainingTouches.length < 2) pinchRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
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

  const toggleHighQuality = () => {
    setQualityLoading(true);
    setHighQuality((current) => !current);
  };

  const canvasClassName = [
    'approval-canvas',
    scale > 1 ? 'is-zoomed' : '',
    spaceHeld ? 'is-hand-tool' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  const specNumber = record.specificationNumber.trim()
    ? formatSpecNumber(record.specificationNumber)
    : 'NONE';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Approval`} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-toolbar" aria-label="Approval viewer controls">
          <div className="viewer-control-group">
            <button aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => changeScale(scale - SCALE_STEP)} type="button">−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => changeScale(scale + SCALE_STEP)} type="button">+</button>
            <button onClick={fitApproval} type="button">Fit</button>
            <label className="viewer-quality-toggle">
              <input checked={highQuality} onChange={toggleHighQuality} type="checkbox" />
              <span className="viewer-quality-track" aria-hidden="true"><span /></span>
              <span className="viewer-quality-label">High Quality</span>
            </label>
          </div>
          <div className="viewer-control-group viewer-actions">
            <button onClick={printApproval} type="button">Print</button>
            <a download href={`${pdfUrl}?download=1`}>Download PDF</a>
          </div>
        </div>

        <div className="approval-viewer-layout">
          <div
            className={canvasClassName}
            onPointerCancel={stopPointer}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopPointer}
            onWheel={handleWheel}
          >
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
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            />
            {qualityLoading && <div className="viewer-quality-loading">Loading {highQuality ? 'high quality' : 'standard'} preview…</div>}
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

            <section className="viewer-hotkeys" aria-labelledby="approval-hotkeys-title">
              <h4 id="approval-hotkeys-title">Hot Keys</h4>
              <div className="viewer-hotkey-row">
                <span className="viewer-hotkey-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></svg>
                </span>
                <div><strong>Ctrl / Cmd + Scroll</strong><span>Zoom in or out</span></div>
              </div>
              <div className="viewer-hotkey-row">
                <kbd>Spacebar</kbd>
                <div><strong>Hold + click/drag</strong><span>Pan while zoomed</span></div>
              </div>
              <div className="viewer-hotkey-row viewer-touch-help">
                <span className="viewer-hotkey-icon" aria-hidden="true">↔</span>
                <div><strong>Pinch / one-finger drag</strong><span>Zoom and pan on tablets</span></div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}