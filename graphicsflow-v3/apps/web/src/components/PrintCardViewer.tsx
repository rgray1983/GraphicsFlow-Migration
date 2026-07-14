import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import {
  formatGNumber,
  formatSpecNumber,
  type GraphicFileMatch,
  type GraphicRecord,
  type PrintCardDetailsResponse,
} from '@graphicsflow/shared';
import { Modal } from './Modal';

type Props = {
  file: GraphicFileMatch | null;
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
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function pointerDistance(first: ActivePointer, second: ActivePointer): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function PrintCardViewer({ file, isOpen, onClose, record }: Props) {
  const [cacheKey, setCacheKey] = useState(0);
  const [details, setDetails] = useState<PrintCardDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pointersRef = useRef(new Map<number, ActivePointer>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const imageUrl = `/api/graphics/${record.id}/print-card.jpg?v=${cacheKey}`;

  useEffect(() => {
    if (!isOpen) return;
    setCacheKey(Date.now());
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setSpaceHeld(false);
    setDragging(false);
    setDetailsLoading(true);
    dragRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
    void fetch(`/api/graphics/${record.id}/print-card/details`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Print Card details could not be loaded.');
        return response.json() as Promise<PrintCardDetailsResponse>;
      })
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setDetailsLoading(false));
  }, [isOpen, record.id]);

  useEffect(() => {
    if (!isOpen) return;
    const isEditableTarget = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest('input, textarea, select, button, a, [contenteditable="true"]'));
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

  const changeScale = (value: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    setScale(next);
    if (next <= 1) setOffset({ x: 0, y: 0 });
  };
  const fit = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeScale(scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
  };
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
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
      } else if (touches.length === 1 && scale > 1) beginDrag(event);
      return;
    }
    if (!spaceHeld || scale <= 1) return;
    event.preventDefault();
    beginDrag(event);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    const touches = [...pointersRef.current.values()].filter((pointer) => pointer.type === 'touch');
    if (touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      changeScale(pinchRef.current.scale * (pointerDistance(touches[0], touches[1]) / Math.max(1, pinchRef.current.distance)));
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
  };
  const stopPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if ([...pointersRef.current.values()].filter((pointer) => pointer.type === 'touch').length < 2) pinchRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

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

  const canvasClassName = ['approval-canvas', scale > 1 ? 'is-zoomed' : '', spaceHeld ? 'is-hand-tool' : '', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ');
  const revision = details?.revision;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${formatGNumber(record.gNumber)} Print Card`} variant="viewer">
      <div className="approval-viewer">
        <div className="approval-viewer-toolbar" aria-label="Print Card viewer controls">
          <div className="viewer-control-group">
            <button aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => changeScale(scale - SCALE_STEP)} type="button">−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => changeScale(scale + SCALE_STEP)} type="button">+</button>
            <button onClick={fit} type="button">Fit</button>
          </div>
          <div className="viewer-control-group viewer-actions">
            <button disabled title="Revision editing will be added in the Revisions workspace." type="button">Edit Print Card</button>
            <button onClick={printCard} type="button">Print</button>
            <a download={file?.name ?? `${record.gNumber}.jpg`} href={`${imageUrl}&download=1`}>Download JPG</a>
          </div>
        </div>
        <div className="approval-viewer-layout">
          <div className={canvasClassName} onPointerCancel={stopPointer} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopPointer} onWheel={handleWheel}>
            <img alt={`${formatGNumber(record.gNumber)} print card`} draggable={false} src={imageUrl} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
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
              <div><dt>File Size</dt><dd>{file ? formatFileSize(file.size) : 'Refreshing…'}</dd></div>
            </dl>
            {detailsLoading && <p className="muted">Loading structured Print Card data…</p>}
            <section className="viewer-hotkeys" aria-labelledby="print-card-hotkeys-title">
              <h4 id="print-card-hotkeys-title">Hot Keys</h4>
              <div className="viewer-hotkey-row"><span className="viewer-hotkey-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></svg></span><div><strong>Ctrl / Cmd + Scroll</strong><span>Zoom in or out</span></div></div>
              <div className="viewer-hotkey-row"><kbd>Spacebar</kbd><div><strong>Hold + click/drag</strong><span>Pan while zoomed</span></div></div>
              <div className="viewer-hotkey-row viewer-touch-help"><span className="viewer-hotkey-icon" aria-hidden="true">↔</span><div><strong>Pinch / one-finger drag</strong><span>Zoom and pan on tablets</span></div></div>
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
