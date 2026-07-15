import type { PreviewResponse, RevisionJourneyEntry, RevisionLookupResponse } from '@graphicsflow/shared';
import { useEffect, useState } from 'react';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';

export type ApprovalWorkspaceRecord = NonNullable<RevisionLookupResponse['record']>;

type ApprovalRevisionWorkspaceProps = {
  record: ApprovalWorkspaceRecord;
  selectedRevision: RevisionJourneyEntry | null;
  selectedRevisionIndex: number;
  viewerLoading: boolean;
  viewerError: string | null;
  onOpenCurrent: () => void;
};

async function prepareApprovalPreview(graphicId: number, variant: 'medium' | 'large'): Promise<PreviewResponse> {
  const response = await fetch(`/api/previews/${graphicId}/${variant}`);
  if (!response.ok) throw new Error('The Approval preview could not be prepared.');
  return response.json() as Promise<PreviewResponse>;
}

export function ApprovalRevisionWorkspace({
  record,
  selectedRevision,
  selectedRevisionIndex,
  viewerLoading,
  viewerError,
  onOpenCurrent,
}: ApprovalRevisionWorkspaceProps) {
  const [highQuality, setHighQuality] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    setHighQuality(false);
    setPreviewError(null);
    setPreviewReady(false);
  }, [record.graphicId]);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewReady(false);
    void prepareApprovalPreview(record.graphicId, highQuality ? 'large' : 'medium')
      .then((preview) => {
        if (cancelled) return;
        if (preview.status !== 'ready') throw new Error(preview.message || 'The Approval preview is not available.');
        setPreviewReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setPreviewError(reason instanceof Error ? reason.message : 'The Approval preview could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [record.graphicId, highQuality, selectedRevisionIndex]);

  const imageUrl = `/api/previews/${record.graphicId}/${highQuality ? 'large' : 'medium'}/image`;
  const isHistorical = Boolean(selectedRevision && !selectedRevision.isCurrent);

  return (
    <aside className="revision-document-workspace approval-revision-workspace">
      <div className="revision-workspace-heading">
        <p className="eyebrow">Approval workspace</p>
        <h3>{selectedRevision ? `Revision ${selectedRevision.revisionLabel}` : 'Current Approval'}</h3>
        <p>{selectedRevision?.description || 'The selected Approval revision is shown below.'}</p>
        {isHistorical && <span className="revision-workspace-mode">Historical revision selected</span>}
      </div>

      <div className="revision-embedded-viewer">
        <DocumentCanvas
          ariaLabel="Selected Approval viewer"
          className="revision-document-stage"
          fitScale={1}
          isActive
          key={`approval-${record.graphicId}-${selectedRevisionIndex}-${highQuality ? 'large' : 'medium'}`}
          renderAtLayoutScale={false}
          toolbarEnd={<><label className="revision-quality-toggle"><input checked={highQuality} onChange={(event) => setHighQuality(event.target.checked)} type="checkbox" /><span>High Quality</span></label><button disabled={viewerLoading} onClick={onOpenCurrent} type="button">{viewerLoading ? 'Opening…' : 'Full Screen'}</button></>}
        >
          <div className="revision-document-sheet">
            {previewLoading && <LoadingIndicator message="Preparing selected Approval…" size="panel" title="Loading Preview" />}
            {!previewLoading && previewError && <div className="revision-preview-message"><strong>Preview unavailable</strong><span>{previewError}</span></div>}
            {!previewLoading && !previewError && previewReady && <img alt="Selected Approval" draggable={false} onError={() => setPreviewError('The selected Approval image could not be loaded.')} src={imageUrl} />}
          </div>
        </DocumentCanvas>
      </div>

      {isHistorical && <div className="revision-workspace-notice"><strong>Revision {selectedRevision?.revisionLabel} selected</strong><span>PR 011 will regenerate this revision from the metadata saved by Create Approval, including Design #, Flute / Test, Sales Rep, production options, revision entry, CSR, and Designer.</span></div>}
      {viewerError && <span className="revision-open-error">{viewerError}</span>}
      <div className="revision-primary-actions">
        <button className="primary" type="button">Create Revision</button>
        <button type="button">Edit Revision Information</button>
      </div>
    </aside>
  );
}
