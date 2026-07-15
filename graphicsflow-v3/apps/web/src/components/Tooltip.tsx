import { useId, type ReactNode } from 'react';
import './Tooltip.css';

type TooltipProps = {
  content: ReactNode;
  label?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
};

export function Tooltip({ content, label = 'More information', position = 'top' }: TooltipProps) {
  const tooltipId = useId();

  return (
    <span className={`app-tooltip app-tooltip-${position}`}>
      <button
        aria-describedby={tooltipId}
        aria-label={label}
        className="app-tooltip-trigger"
        type="button"
      >
        ?
      </button>
      <span className="app-tooltip-content" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}
