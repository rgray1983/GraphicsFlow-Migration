import { formatGNumber, type GraphicRecord } from '@graphicsflow/shared';
import { useEffect, useId } from 'react';

type RecordDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord | null;
};

function formatCreatedAt(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
}

export function RecordDrawer({ isOpen, onClose, record }: RecordDrawerProps) {
  const titleId = useId();

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
      aria-labelledby={titleId}
      className={`record-drawer${isOpen ? ' is-open' : ''}`}
    >
      {record && (
        <div className="record-drawer-content" key={record.id}>
          <header className="drawer-header">
            <div>
              <p className="eyebrow">Graphics record</p>
              <h2 id={titleId}>{formatGNumber(record.gNumber)}</h2>
            </div>
            <button aria-label="Close record details" className="icon-button" onClick={onClose} type="button">×</button>
          </header>

          <section className="drawer-section approval-preview-section">
            <div className="drawer-section-heading">
              <div>
                <span className="section-kicker">Visual reference</span>
                <h3>Approval Preview</h3>
              </div>
              <span className="availability-badge">Not connected</span>
            </div>
            <div className="approval-preview-empty">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M7 3h7l4 4v14H7z" />
                <path d="M14 3v5h5M9.5 15l2-2 1.5 1.5 2.5-3 2 2.5" />
              </svg>
              <strong>No approval preview available</strong>
              <span>The approved artwork preview will appear here after the approval file service is connected.</span>
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-heading">
              <div>
                <span className="section-kicker">Record details</span>
                <h3>Information</h3>
              </div>
            </div>
            <dl className="record-detail-grid">
              <div><dt>Customer #</dt><dd>{record.customerNumber || 'Not recorded'}</dd></div>
              <div><dt>Customer</dt><dd>{record.customerName || 'Not recorded'}</dd></div>
              <div><dt>Part Number</dt><dd>{record.partNumber || 'Not recorded'}</dd></div>
              <div><dt>Created</dt><dd>{formatCreatedAt(record.createdAt)}</dd></div>
            </dl>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-heading">
              <div>
                <span className="section-kicker">Documents</span>
                <h3>Actions</h3>
              </div>
            </div>
            <div className="drawer-actions">
              <button disabled type="button">View Approval <span>Coming later</span></button>
              <button disabled type="button">View Print Card <span>Coming later</span></button>
            </div>
          </section>

          <section className="drawer-section drawer-history-placeholder">
            <div className="drawer-section-heading">
              <div>
                <span className="section-kicker">Record activity</span>
                <h3>History</h3>
              </div>
            </div>
            <p>Revision and document activity will appear here when the history service is added.</p>
          </section>
        </div>
      )}
    </aside>
  );
}
