import type { RevisionJourneyEntry, RevisionLookupResponse } from '@graphicsflow/shared';
import { useCallback, useEffect, useState } from 'react';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { PrintCardRevisionEditModal } from './PrintCardRevisionEditModal';
import { PrintCardRevisionRegenerateModal } from './PrintCardRevisionRegenerateModal';
import { Toast } from './Toast';
import './ApprovalRevisionWorkspace.css';

export type RevisionWorkspaceRecord = NonNullable<RevisionLookupResponse['record']>;
type SavedChangeType = 'information' | 'artwork';

type PrintCardRevisionWorkspaceProps = {
  record: RevisionWorkspaceRecord;
  selectedRevision: RevisionJourneyEntry | null;
  selectedRevisionIndex: number;
  viewerLoading: boolean;
  viewerError: string | null;
  onOpenCurrent: () => void;
  onRevisionSaved: () => void;
};

export function PrintCardRevisionWorkspace({ record, selectedRevision, selectedRevisionIndex, viewerLoading, viewerError, onOpenCurrent, onRevisionSaved }: PrintCardRevisionWorkspaceProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [pendingRevisionId, setPendingRevisionId] = useState<number | null>(null);
  const [savedChangeType, setSavedChangeType] = useState<SavedChangeType | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [adaptiveHighQuality, setAdaptiveHighQuality] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const selectedRevisionId = selectedRevision?.id ?? null;
  const printCardParams = new URLSearchParams({ specificationNumber: record.specificationNumber }).toString();
  const currentImageUrl = `/api/graphics/${record.graphicId}/print-card.jpg?${printCardParams}`;
  const imageUrl = adaptiveHighQuality && selectedRevisionId
    ? `/api/graphics/${record.graphicId}/print-card/revisions/${selectedRevisionId}.jpg?v=${selectedRevisionIndex}`
    : currentImageUrl;
  const isHistorical = Boolean(selectedRevision && !selectedRevision.isCurrent);
  const regenerationNeeded = Boolean(selectedRevisionId && pendingRevisionId === selectedRevisionId);

  useEffect(() => {
    setEditOpen(false); setRegenerateOpen(false); setPendingRevisionId(null); setSavedChangeType(null); setToastMessage(null);
  }, [record.graphicId]);

  useEffect(() => {
    setAdaptiveHighQuality(false);
    setImageLoading(true);
    setImageError(false);
  }, [record.graphicId, selectedRevisionId]);

  const handleScaleChange = useCallback((scale: number) => {
    if (scale > 3 && selectedRevisionId && !adaptiveHighQuality) {
      setImageLoading(true);
      setImageError(false);
      setAdaptiveHighQuality(true);
    }
  }, [adaptiveHighQuality, selectedRevisionId]);

  const handleSaved = (revisionId: number, mode: SavedChangeType) => {
    setPendingRevisionId(revisionId);
    setSavedChangeType(mode);
    setToastMessage(mode === 'artwork' ? 'Artwork change saved. Regenerate the Print Card to build a fresh JPG.' : 'Revision changes saved. Regenerate the Print Card to build a fresh JPG.');
    onRevisionSaved();
  };
  const cancelChanges = () => { setPendingRevisionId(null); setSavedChangeType(null); setToastMessage(null); };
  const openRegenerate = () => { setPendingRevisionId(null); setSavedChangeType(null); setToastMessage(null); setRegenerateOpen(true); };
  const viewerOverlay = imageLoading ? (
    <LoadingIndicator
      message={adaptiveHighQuality ? 'Rebuilding a sharper Print Card from the connected PDF…' : 'Loading the selected Print Card image…'}
      size="viewer"
      title={adaptiveHighQuality ? 'Sharpening Preview' : 'Opening Print Card'}
    />
  ) : imageError ? <div className="revision-open-error">The Print Card image could not be opened.</div> : null;

  return <>
    <aside className="revision-document-workspace print-card-revision-workspace approval-revision-workspace">
      <div className="revision-workspace-heading"><p className="eyebrow">Print Card workspace</p><h3>{selectedRevision ? `Revision ${selectedRevision.revisionLabel}` : 'Current document'}</h3><p>{selectedRevision?.description || 'The current Print Card is shown below.'}</p>{isHistorical && <span className="revision-workspace-mode">Historical revision selected</span>}</div>
      <div className="revision-embedded-viewer"><DocumentCanvas ariaLabel="Selected Print Card viewer" className="revision-document-stage" fitScale={1} isActive key={`printCard-${record.graphicId}-${selectedRevisionIndex}`} onScaleChange={handleScaleChange} overlay={viewerOverlay} renderAtLayoutScale={false} toolbarEnd={<><span className="viewer-quality-label">{adaptiveHighQuality ? 'PDF-rendered high quality' : selectedRevisionId ? '300 DPI · Auto sharpens above 300%' : 'Production JPG'}</span><button disabled={viewerLoading} onClick={onOpenCurrent} type="button">{viewerLoading ? 'Opening…' : 'Full Screen'}</button></>}><div className="revision-document-sheet"><img alt="Current Print Card" draggable={false} key={imageUrl} onError={() => { setImageError(true); setImageLoading(false); }} onLoad={() => setImageLoading(false)} src={imageUrl} /></div></DocumentCanvas></div>
      {isHistorical && <div className="revision-workspace-notice"><strong>Revision {selectedRevision?.revisionLabel} selected</strong><span>The selected revision information and connected artwork can be edited or regenerated without replacing the current managed Print Card.</span></div>}
      {regenerationNeeded && <div className="revision-workspace-notice is-regeneration-needed"><strong>{savedChangeType === 'artwork' ? 'Artwork change saved' : 'Revision changes saved'}</strong><span>Regenerate the Print Card to create a fresh temporary JPG with the saved changes.</span></div>}
      {viewerError && <span className="revision-open-error">{viewerError}</span>}
      <div className="revision-primary-actions"><button className="primary" disabled={!selectedRevisionId} onClick={() => setEditOpen(true)} type="button">Edit Revision</button><button aria-label={regenerationNeeded ? 'Regenerate Print Card — changes are waiting' : 'Regenerate Print Card'} className={regenerationNeeded ? 'needs-attention' : ''} disabled={!selectedRevisionId} onClick={openRegenerate} type="button">{regenerationNeeded && <span aria-hidden="true" className="regenerate-attention-dot" />}<span>{regenerationNeeded ? 'Regenerate Print Card — Changes Ready' : 'Regenerate Print Card'}</span></button>{regenerationNeeded && <button className="cancel-pending-regeneration" onClick={cancelChanges} type="button">Cancel Changes</button>}</div>
    </aside>
    <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} tone="success" />
    <PrintCardRevisionEditModal graphicId={record.graphicId} isOpen={editOpen} onClose={() => setEditOpen(false)} onSaved={handleSaved} revisionId={selectedRevisionId} />
    <PrintCardRevisionRegenerateModal graphicId={record.graphicId} isOpen={regenerateOpen} onClose={() => setRegenerateOpen(false)} revisionId={selectedRevisionId} revisionLabel={selectedRevision?.revisionLabel ?? ''} />
  </>;
}
