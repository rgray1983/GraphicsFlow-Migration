import type { RevisionJourneyEntry, RevisionLookupResponse } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';

export type RevisionWorkspaceRecord = NonNullable<RevisionLookupResponse['record']>;

type PrintCardRevisionWorkspaceProps = {
  record: RevisionWorkspaceRecord;
  selectedRevision: RevisionJourneyEntry | null;
  selectedRevisionIndex: number;
  viewerLoading: boolean;
  viewerError: string | null;
  onOpenCurrent: () => void;
};

export function PrintCardRevisionWorkspace({
  record,
  selectedRevision,
  selectedRevisionIndex,
  viewerLoading,
  viewerError,
  onOpenCurrent,
}: PrintCardRevisionWorkspaceProps) {
  const printCardParams = new URLSearchParams({ specificationNumber: record.specificationNumber }).toString();
  const imageUrl = `/api/graphics/${record.graphicId}/print-card.jpg?${printCardParams}`;
  const isHistorical = Boolean(selectedRevision && !selectedRevision.isCurrent);

  return (
    <aside className="revision-document-workspace print-card-revision-workspace">
      <div className="revision-workspace-heading">
        <p className="eyebrow">Print Card workspace</p>
        <h3>{selectedRevision ? `Revision ${selectedRevision.revisionLabel}` : 'Current document'}</h3>
        <p>{selectedRevision?.description || 'The current Print Card is shown below.'}</p>
        {isHistorical && <span className="revision-workspace-mode">Historical revision selected</span>}
      </div>

      <div className="revision-embedded-viewer">
        <DocumentCanvas
          ariaLabel="Selected Print Card viewer"
          className="revision-document-stage"
          fitScale={1}
          isActive
          key={`printCard-${record.graphicId}-${selectedRevisionIndex}`}
          renderAtLayoutScale={false}
          toolbarEnd={<button disabled={viewerLoading} onClick={onOpenCurrent} type="button">{viewerLoading ? 'Opening…' : 'Full Screen'}</button>}
        >
          <div className="revision-document-sheet">
            <img alt="Current Print Card" draggable={false} src={imageUrl} />
          </div>
        </DocumentCanvas>
      </div>

      {isHistorical && <div className="revision-workspace-notice"><strong>Revision {selectedRevision?.revisionLabel} selected</strong><span>The historical revision metadata is selected. Revision-specific Print Card image regeneration will be connected as that workflow is added.</span></div>}
      {viewerError && <span className="revision-open-error">{viewerError}</span>}
      <div className="revision-primary-actions">
        <button className="primary" type="button">Create Revision</button>
        <button type="button">Edit Information</button>
      </div>
    </aside>
  );
}
