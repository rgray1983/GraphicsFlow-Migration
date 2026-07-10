import { useQuery } from '@tanstack/react-query';
import {
  formatGNumber,
  type GraphicFileMatch,
  type GraphicFilesResponse,
  type GraphicRecord,
} from '@graphicsflow/shared';
import { useRef } from 'react';
import { RecordInspector, type InspectorSection } from './RecordInspector';

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function fetchGraphicFiles(id: number): Promise<GraphicFilesResponse> {
  const response = await fetch(`/api/graphics/${id}/files`);
  if (!response.ok) throw new Error('Live files could not be checked.');
  return response.json() as Promise<GraphicFilesResponse>;
}

function FileSummary({ file, emptyMessage }: { file: GraphicFileMatch | null; emptyMessage: string }) {
  if (!file) return <p className="live-file-empty">{emptyMessage}</p>;

  return (
    <div className="live-file-summary">
      <strong>{file.name}</strong>
      <span>{formatFileSize(file.size)} · Modified {formatDate(file.modifiedAt)}</span>
      <small title={file.relativePath}>{file.relativePath}</small>
    </div>
  );
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
  const filesQuery = useQuery({
    queryKey: ['graphic-files', visibleRecord?.id],
    queryFn: () => fetchGraphicFiles(visibleRecord!.id),
    enabled: isOpen && Boolean(visibleRecord),
    staleTime: 60_000,
  });

  if (!visibleRecord) return null;

  const approval = filesQuery.data?.approval.latest ?? null;
  const printCard = filesQuery.data?.printCard.latest ?? null;
  const approvalCount = filesQuery.data?.approval.matches.length ?? 0;
  const printCardCount = filesQuery.data?.printCard.matches.length ?? 0;

  const sections: InspectorSection[] = [
    {
      title: 'Approval Preview',
      badge: (
        <span className={`availability-badge${approval ? ' is-connected' : ''}`}>
          {filesQuery.isPending ? 'Checking…' : approval ? 'Live file found' : 'Not found'}
        </span>
      ),
      className: 'approval-preview-section',
      content: filesQuery.isError ? (
        <div className="approval-preview-empty"><strong>Could not check approvals</strong><span>Confirm the Approvals folder in Company Settings is mounted and readable.</span></div>
      ) : approval ? (
        <div className="approval-preview-empty live-file-found">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
          <strong>Live approval connected</strong>
          <span>{approval.name}</span>
        </div>
      ) : (
        <div className="approval-preview-empty">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5M9.5 15l2-2 1.5 1.5 2.5-3 2 2.5" /></svg>
          <strong>{filesQuery.isPending ? 'Checking live approval folder…' : 'No approval found'}</strong>
          <span>The configured Approvals folder was searched for this G#.</span>
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
          <div><dt>Created</dt><dd>{formatDate(visibleRecord.createdAt)}</dd></div>
        </dl>
      ),
    },
    {
      title: 'Documents',
      content: (
        <div className="live-document-list">
          <article>
            <div className="live-document-heading"><span>Approval</span><small>{approvalCount ? `${approvalCount} match${approvalCount === 1 ? '' : 'es'}` : 'No matches'}</small></div>
            <FileSummary file={approval} emptyMessage={filesQuery.isPending ? 'Checking configured folder…' : 'No matching approval file found.'} />
            <button disabled={!approval} type="button">View Approval <span>{approval ? 'Viewer next' : 'Unavailable'}</span></button>
          </article>
          <article>
            <div className="live-document-heading"><span>Print Card</span><small>{printCardCount ? `${printCardCount} match${printCardCount === 1 ? '' : 'es'}` : 'No matches'}</small></div>
            <FileSummary file={printCard} emptyMessage={filesQuery.isPending ? 'Checking configured folder…' : 'No matching print card found.'} />
            <button disabled={!printCard} type="button">View Print Card <span>{printCard ? 'Viewer next' : 'Unavailable'}</span></button>
          </article>
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
