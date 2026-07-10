import type { ReactNode } from 'react';
import { RecordDrawer } from './RecordDrawer';

export type InspectorSection = {
  title: string;
  content: ReactNode;
  badge?: ReactNode;
  className?: string;
};

type RecordInspectorProps = {
  isOpen: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  contentKey: string | number;
  sections: InspectorSection[];
  closeLabel?: string;
};

export function RecordInspector({
  isOpen,
  onClose,
  eyebrow,
  title,
  contentKey,
  sections,
  closeLabel = 'Close inspector',
}: RecordInspectorProps) {
  return (
    <RecordDrawer
      closeLabel={closeLabel}
      contentKey={contentKey}
      isOpen={isOpen}
      onClose={onClose}
    >
      <header className="drawer-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <button aria-label={closeLabel} className="icon-button" onClick={onClose} type="button">×</button>
      </header>

      {sections.map((section) => (
        <section
          className={`drawer-section${section.className ? ` ${section.className}` : ''}`}
          key={section.title}
        >
          <div className="drawer-section-heading">
            <h3 className="eyebrow">{section.title}</h3>
            {section.badge}
          </div>
          {section.content}
        </section>
      ))}
    </RecordDrawer>
  );
}
