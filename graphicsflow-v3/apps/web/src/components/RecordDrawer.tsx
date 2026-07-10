import type { ReactNode } from 'react';
import { useEffect } from 'react';

type RecordDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  contentKey: string | number;
  closeLabel: string;
  children: ReactNode;
};

export function RecordDrawer({
  isOpen,
  onClose,
  contentKey,
  closeLabel,
  children,
}: RecordDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <aside
      aria-hidden={!isOpen}
      aria-label={closeLabel}
      className={`record-drawer${isOpen ? ' is-open' : ''}`}
    >
      {isOpen && (
        <div className="record-drawer-content" key={contentKey}>
          {children}
        </div>
      )}
    </aside>
  );
}
