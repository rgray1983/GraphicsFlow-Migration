import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import './DocumentCanvas.css';

type ActivePointer = { x: number; y: number; type: string };

type DocumentCanvasProps = {
  ariaLabel: string;
  children: ReactNode;
  isActive?: boolean;
  fitScale?: number;
  className?: string;
  toolbarEnd?: ReactNode;
  onEscape?: () => void;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

function pointerDistance(first: ActivePointer, second: ActivePointer): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function DocumentCanvas({
  ariaLabel,
  children,
  isActive = true,
  fitScale = 1,
  className = '',
  toolbarEnd,
  onEscape,
}: DocumentCanvasProps) {
  const [scale, setScale] = useState(fitScale);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pointersRef = useRef(new Map<number, ActivePointer>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);

  const reset = () => {
    setScale(fitScale);
    setOffset({ x: 0, y: 0 });
    setSpaceHeld(false);
    setDragging(false);
    dragRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
  };

  useEffect(() => {
    if (isActive) reset();
  }, [isActive, fitScale]);

  useEffect(() => {
    if (!isActive) return;
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest('input, textarea, select, button, a, [contenteditable="true"]'));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
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
    const handleBlur = () => reset();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isActive, onEscape, fitScale]);

  const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  const changeScale = (next: number) => {
    const clamped = clampScale(next);
    setScale(clamped);
    if (clamped <= fitScale) setOffset({ x: 0, y: 0 });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
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
      } else if (touches.length === 1 && scale > fitScale) {
        beginDrag(event);
      }
      return;
    }
    if (!spaceHeld || scale <= fitScale) return;
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
    if ([...pointersRef.current.values()].filter((pointer) => pointer.type === 'touch').length < 2) pinchRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  const canvasClassName = [
    'document-canvas-stage',
    scale > fitScale ? 'is-zoomed' : '',
    spaceHeld && scale > fitScale ? 'is-hand-tool' : '',
    dragging ? 'is-dragging' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className="document-canvas" aria-label={ariaLabel}>
      <div className="document-canvas-toolbar">
        <div className="document-canvas-controls">
          <button aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => changeScale(scale - SCALE_STEP)} type="button">−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => changeScale(scale + SCALE_STEP)} type="button">+</button>
          <button onClick={reset} type="button">Fit</button>
        </div>
        {toolbarEnd && <div className="document-canvas-actions">{toolbarEnd}</div>}
      </div>
      <div
        className={canvasClassName}
        onPointerCancel={stopPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPointer}
        onWheel={handleWheel}
      >
        <div className="document-canvas-content" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
          {children}
        </div>
      </div>
      <div className="document-canvas-help">
        <span>Scroll to zoom</span>
        <span>Spacebar + drag to pan</span>
        <span>Pinch or one-finger drag on touch</span>
      </div>
    </div>
  );
}
