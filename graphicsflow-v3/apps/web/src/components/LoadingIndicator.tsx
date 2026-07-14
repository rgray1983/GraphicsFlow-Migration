import type { ReactNode } from 'react';
import './LoadingIndicator.css';

type LoadingSize = 'inline' | 'panel' | 'viewer';

type LoadingIndicatorProps = {
  title?: string;
  message?: string;
  size?: LoadingSize;
  className?: string;
};

export function LoadingIndicator({ title, message, size = 'panel', className = '' }: LoadingIndicatorProps) {
  const classes = ['graphicsflow-loading', `is-${size}`, className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="status" aria-live="polite" aria-busy="true">
      <div className="graphicsflow-loading-bar" aria-hidden="true"><i /></div>
      {(title || message) && <div className="graphicsflow-loading-copy">
        {title && <strong>{title}</strong>}
        {message && <span>{message}</span>}
      </div>}
    </div>
  );
}

type LoadingOverlayProps = LoadingIndicatorProps & { children?: ReactNode };

export function LoadingOverlay({ children, ...props }: LoadingOverlayProps) {
  return <div className="graphicsflow-loading-overlay">{children}<LoadingIndicator {...props} /></div>;
}

type ShimmerPreviewProps = {
  label?: string;
  children?: ReactNode;
  active: boolean;
  className?: string;
};

export function ShimmerPreview({ active, children, label = 'Converting artwork…', className = '' }: ShimmerPreviewProps) {
  return (
    <div className={['graphicsflow-shimmer-preview', active ? 'is-loading' : '', className].filter(Boolean).join(' ')} aria-busy={active}>
      <div className="graphicsflow-shimmer-content">{children}</div>
      {active && <div className="graphicsflow-shimmer-layer" role="status" aria-live="polite"><span>{label}</span></div>}
    </div>
  );
}
