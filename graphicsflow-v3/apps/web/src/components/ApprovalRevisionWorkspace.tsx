import type { PreviewResponse, RevisionJourneyEntry, RevisionLookupResponse } from '@graphicsflow/shared';
import { useEffect, useState } from 'react';
import { ApprovalRevisionEditModal } from './ApprovalRevisionEditModal';
import { ApprovalRevisionRegenerateModal } from './ApprovalRevisionRegenerateModal';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Toast } from './Toast';
import './ApprovalRevisionWorkspace.css';

export type ApprovalWorkspaceRecord = NonNullable<RevisionLookupResponse['record']>;

type SavedChangeType = 'information' | 'artwork';
type PendingRegeneration = { graphicId: number; revisionId: number; mode: SavedChangeType };

type ApprovalRevisionWorkspaceProps = {
  record: ApprovalWorkspaceRecord;
  selectedRevision: RevisionJourneyEntry | null;
  selectedRevisionIndex: number;
  viewerLoading: boolean;
  viewerError: string | null;
  onOpenCurrent: () => void;
  onRevisionSaved: () => void;
};

const pendingStorageKey = 'graphicsflow-approval-pending-regeneration';

function readPendingRegeneration(): PendingRegeneration | null {
  try {
    const raw = window.sessionStorage.getItem(pendingStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingRegeneration>;
    if (!Number.isInteger(parsed.graphicId) || !Number.isInteger(parsed.revisionId) || (parsed.mode !== 'information' && parsed.mode !== 'artwork')) return null;
    return parsed as PendingRegeneration;
  } catch {
    return null;
  }
}

function writePendingRegeneration(value: PendingRegeneration | null): void {
  try {
    if (value) window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(value));
    else window.sessionStorage.removeItem(pendingStorageKey);
  } catch {
    // The visible reminder still works even when session storage is unavailable.
  }
}

async function prepareApprovalPreview(graphicId: number, variant: 'medium' | 'large'): Promise<PreviewResponse> {
  const response = await fetch(`/api/previews/${graphicId}/${variant}`);
  if (!response.ok) throw new Error('The Approval preview could not be prepared.');
  return response.json() as Promise<PreviewResponse>;
}

export function ApprovalRevisionWorkspace({ record, selectedRevision, selectedRevisionIndex, viewerLoading, viewerError, onOpenCurrent, onRevisionSaved }: ApprovalRevisionWorkspaceProps) {
  const [highQuality, setHighQuality] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [pendingRegeneration, setPendingRegeneration] = useState<PendingRegeneration | null>(() => readPendingRegeneration());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    setHighQuality(false); setPreviewError(null); setPreviewReady(false); setEditOpen(false); setRegenerateOpen(false);
    const saved = readPendingRegeneration();
    setPendingRegeneration(saved?.graphicId === record.graphicId ? saved : null);
    setToastMessage(null);
  }, [record.graphicId]);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true); setPreviewError(null); setPreviewReady(false);
    void prepareApprovalPreview(record.graphicId, highQuality ? 'large' : 'medium')
      .then((preview) => {
        if (cancelled) return;
        if (preview.status !== 'ready') throw new Error(preview.message || 'The Approval preview is not available.');
        setPreviewReady(true);
      })
      .catch((reason: unknown) => { if (!cancelled) setPreviewError(reason instanceof Error ? reason.message : 'The Approval preview could not be loaded.'); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [record.graphicId, highQuality, selectedRevisionIndex]);

  const imageUrl = `/api/previews/${record.graphicId}/${highQuality ? 'large' : 'medium'}/image`;
  const isHistorical = Boolean(selectedRevision && !selectedRevision.isCurrent);
  const selectedRevisionId = selectedRevision?.id ?? null;
  const regenerationNeeded = Boolean(selectedRevisionId && pendingRegeneration?.graphicId === record.graphicId && pendingRegeneration.revisionId === selectedRevisionId);
  const savedChangeType = regenerationNeeded ? pendingRegeneration?.mode ?? null : null;

  const handleRevisionSaved = (savedRevisionId: number, mode: SavedChangeType) => {
    const pending = { graphicId: record.graphicId, revisionId: savedRevisionId, mode } satisfies PendingRegeneration;
    writePendingRegeneration(pending);
    setPendingRegeneration(pending);
    setToastMessage(mode === 'artwork'
      ? 'Artwork change saved. Regenerate the Approval to build a fresh PDF.'
      : 'Revision changes saved. Regenerate the Approval to build a fresh PDF.');
    onRevisionSaved();
  };

  const openRegenerate = () => {
    writePendingRegeneration(null);
    setPendingRegeneration(null);
    setToastMessage(null);
    setRegenerateOpen(true);
  };

  return (
    <>
      <aside className="revision-document-workspace approval-revision-workspace">
        <div className="revision-workspace-heading">
          <p className="eyebrow">Approval workspace</p>
          <h3>{selectedRevision ? `Revision ${selectedRevision.revisionLabel}` : 'Current Approval'}</h3>
          <p>{selectedRevision?.description || 'The selected Approval revision is shown below.'}</p>
          {isHistorical && <span className="revision-workspace-mode">Historical revision selected</span>}
        </div>
        <div className="revision-embedded-viewer">
          <DocumentCanvas ariaLabel="Selected Approval viewer" className="revision-document-stage" fitScale={1} isActive key={`approval-${record.graphicId}-${selectedRevisionIndex}-${highQuality ? 'large' : 'medium'}`} renderAtLayoutScale={false} toolbarEnd={<><label className="revision-quality-toggle"><input checked={highQuality} onChange={(event) => setHighQuality(event.target.checked)} type="checkbox" /><span>High Quality</span></label><button disabled={viewerLoading} onClick={onOpenCurrent} type="button">{viewerLoading ? 'Opening…' : 'Full Screen'}</button></>}>
            <div className="revision-document-sheet">
              {previewLoading && <LoadingIndicator message="Preparing selected Approval…" size="panel" title="Loading Preview" />}
              {!previewLoading && previewError && <div className="revision-preview-message"><strong>Preview unavailable</strong><span>{previewError}</span></div>}
              {!previewLoading && !previewError && previewReady && <img alt="Selected Approval" draggable={false} onError={() => setPreviewError('The selected Approval image could not be loaded.')} src={imageUrl} />}
            </div>
          </DocumentCanvas>
        </div>
        {isHistorical && <div className="revision-workspace-notice"><strong>Revision {selectedRevision?.revisionLabel} selected</strong><span>This revision is stored in V3. Edit its metadata or regenerate a fresh temporary PDF without changing the PHP database or live Approval server.</span></div>}
        {regenerationNeeded && <div className="revision-workspace-notice is-regeneration-needed"><strong>{savedChangeType === 'artwork' ? 'Artwork change saved' : 'Revision changes saved'}</strong><span>Regenerate the Approval to create a fresh PDF with the updated information or artwork.</span></div>}
        {viewerError && <span className="revision-open-error">{viewerError}</span>}
        <div className="revision-primary-actions">
          <button className="primary" disabled={!selectedRevisionId} onClick={() => setEditOpen(true)} type="button">Edit Revision</button>
          <button aria-label={regenerationNeeded ? 'Regenerate Approval — changes are waiting' : 'Regenerate Approval'} className={regenerationNeeded ? 'needs-attention' : ''} disabled={!selectedRevisionId} onClick={openRegenerate} type="button">{regenerationNeeded && <span aria-hidden="true" className="regenerate-attention-dot" />}<span>{regenerationNeeded ? 'Regenerate Approval — Changes Ready' : 'Regenerate Approval'}</span></button>
        </div>
      </aside>
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} tone="success" />
      <ApprovalRevisionEditModal graphicId={record.graphicId} isOpen={editOpen} onClose={() => setEditOpen(false)} onSaved={handleRevisionSaved} revisionId={selectedRevisionId} />
      <ApprovalRevisionRegenerateModal graphicId={record.graphicId} isOpen={regenerateOpen} onClose={() => setRegenerateOpen(false)} revisionId={selectedRevisionId} revisionLabel={selectedRevision?.revisionLabel ?? ''} />
    </>
  );
}
