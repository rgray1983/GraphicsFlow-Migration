import { formatGNumber, type GraphicRecord } from '@graphicsflow/shared';
import { useRef } from 'react';
import { RecordInspector, type InspectorSection } from './RecordInspector';

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

type GraphicsRecordInspectorProps = {
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord | null;
};

export function GraphicsRecordInspector({ isOpen, onClose, record }: GraphicsRecordInspectorProps) {
  const lastRecordRef = useRef<GraphicRecord | null>(record);
  if (record) lastRecordRef.current = record;

  const visibleRecord = record ?? lastRecordRef.current;
  if (!visibleRecord) return null;

  const sections: InspectorSection[] = [
    {
      title: 'Approval Preview',
      badge: <span className="availability-badge">Not connected</span>,
      className: 'approval-preview-section',
      content: (
        <div className="approval-preview-empty">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 3h7l4 4v14H7z" />
            <path d="M14 3v5h5M9.5 15l2-2 1.5 1.5 2.5-3 2 2.5" />
          </svg>
          <strong>No approval preview available</strong>
          <span>The approved artwork preview will appear here after the approval file service is connected.</span>
        </div>
      ),
    },
    {
      title: 'Details',
      content: (
        <dl className="record-detail-grid">
          <div><dt>Customer #</dt><dd>{visibleRecord.customerNumber || 'Not recorded'}</dd></div>
          <div><dt>Customer</dt><dd>{visibleRecord.customerName || 'Not recorded'}</dd></div>
          <div><dt>Part Number</dt><dd>{visibleRecord.partNumber || 'Not recorded'}</dd></div>
          <div><dt>Created</dt><dd>{formatCreatedAt(visibleRecord.createdAt)}</dd></div>
        </dl>
      ),
    },
    {
      title: 'Documents',
      content: (
        <div className="drawer-actions">
          <button disabled type="button">View Approval <span>Coming later</span></button>
          <button disabled type="button">View Print Card <span>Coming later</span></button>
        </div>
      ),
    },
    {
      title: 'Timeline',
      className: 'drawer-history-placeholder',
      content: <p>Revision and document activity will appear here when the history service is added.</p>,
    },
  ];

  return (
    <RecordInspector
      closeLabel="Close graphics record inspector"
      contentKey={visibleRecord.id}
      eyebrow="Graphics Record"
      isOpen={isOpen}
      onClose={onClose}
      sections={sections}
      title={formatGNumber(visibleRecord.gNumber)}
    />
  );
}
