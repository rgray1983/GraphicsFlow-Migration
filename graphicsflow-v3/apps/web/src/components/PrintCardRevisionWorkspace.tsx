import type { RevisionLookupResponse } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';

export type RevisionWorkspaceRecord = NonNullable<RevisionLookupResponse['record']>;

type PrintCardRevisionWorkspaceProps = {
  record: RevisionWorkspaceRecord;
  viewerLoading: boolean;
  viewerError: string | null;
  onOpenCurrent: () => void;
};

export function PrintCardRevisionWorkspace({
  record,
  viewerLoading,
  viewerError,
  onOpenCurrent,
}: PrintCardRevisionWorkspaceProps) {
  const printCardParams = new URLSearchParams({ specificationNumber: record.specificationNumber }).toString();
  const imageUrl = `/api/graphics/${record.graphicId}/print-card.jpg?${printCardParams}`;

  return (
    <aside className="revision-document-workspace print-card-revision-workspace">
      <div className="revision-workspace-heading">
        <p className="eyebrow">Print Card workspace</p>
        <h3>{record.currentRevision ? `Revision ${record.currentRevision.revisionLabel}` : 'Current document'}</h3>
        <p>{record.currentRevision?.description || 'The current Print Card is shown below.'}</p>
      </div>

      <div className="revision-embedded-viewer">
        <DocumentCanvas
          ariaLabel="Current Print Card viewer"
          className="revision-document-stage"
          fitScale={1}
          isActive
          key={`printCard-${record.graphicId}`}
          renderAtLayoutScale={false}
          toolbarEnd={<button disabled={viewerLoading} onClick={onOpenCurrent} type="button">{viewerLoading ? 'Opening…' : 'Full Screen'}</button>}
        >
          <div className="revision-document-sheet">
            <img alt="Current Print Card" draggable={false} src={imageUrl} />
          </div>
        </DocumentCanvas>
      </div>

      {viewerError && <span className="revision-open-error">{viewerError}</span>}
      <div className="revision-primary-actions">
        <button className="primary" type="button">Create Revision</button>
        <button type="button">Edit Information</button>
      </div>
    </aside>
  );
}
