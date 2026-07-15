import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatGNumber,
  formatSpecNumber,
  type GraphicFileMatch,
  type GraphicFilesResponse,
  type GraphicRecord,
  type PreviewResponse,
  type RevisionDocumentType,
  type RevisionLookupResponse,
} from '@graphicsflow/shared';
import { ApprovalViewer } from '../components/ApprovalViewer';
import { DocumentCanvas } from '../components/DocumentCanvas';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { PrintCardViewer } from '../components/PrintCardViewer';
import { UnregisteredPrintCardOnboarding } from '../components/UnregisteredPrintCardOnboarding';
import './RevisionsPage.css';
import './RevisionRecordHero.css';

async function lookup(type: RevisionDocumentType, identifier: string): Promise<RevisionLookupResponse> {
  const params = new URLSearchParams({ type, identifier });
  const response = await fetch(`/api/revisions/lookup?${params.toString()}`);
  if (!response.ok) throw new Error('Revision history could not be searched.');
  return response.json() as Promise<RevisionLookupResponse>;
}
async function loadFiles(graphicId: number): Promise<GraphicFilesResponse> {
  const response = await fetch(`/api/graphics/${graphicId}/files`);
  if (!response.ok) throw new Error('Current document files could not be loaded.');
  return response.json() as Promise<GraphicFilesResponse>;
}
async function prepareApprovalPreview(graphicId: number, variant: 'medium' | 'large'): Promise<PreviewResponse> {
  const response = await fetch(`/api/previews/${graphicId}/${variant}`);
  if (!response.ok) throw new Error('The Approval preview could not be prepared.');
  return response.json() as Promise<PreviewResponse>;
}
function displayDate(value: string | null): string {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function RevisionsPage() {
  const [type, setType] = useState<RevisionDocumentType>('approval');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [viewerType, setViewerType] = useState<RevisionDocumentType | null>(null);
  const [viewerFile, setViewerFile] = useState<GraphicFileMatch | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [highQuality, setHighQuality] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [approvalPreviewReady, setApprovalPreviewReady] = useState(false);
  const query = useQuery({
    queryKey: ['revision-lookup', type, search],
    queryFn: () => lookup(type, search),
    enabled: Boolean(search),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const record = query.data?.record ?? null;
  const unregisteredPrintCard = query.data?.unregisteredPrintCard ?? null;
  const submit = (event: FormEvent) => { event.preventDefault(); const next = input.trim(); if (next) setSearch(next); };
  const changeType = (next: RevisionDocumentType) => { setType(next); setInput(''); setSearch(''); setViewerType(null); setViewerError(null); setPreviewError(null); };

  const viewerRecord: GraphicRecord | null = record ? {
    id: record.graphicId, gNumber: record.gNumber, customerNumber: record.customerNumber, customerName: record.customerName,
    specificationNumber: record.specificationNumber, partNumber: record.partNumber, previewImage: null, createdAt: null,
    source: 'graphicsflow', canDelete: false,
  } : null;

  useEffect(() => { setHighQuality(false); setPreviewError(null); setApprovalPreviewReady(false); }, [record?.graphicId, record?.documentType]);
  useEffect(() => {
    if (!record || record.documentType !== 'approval') return;
    let cancelled = false; setPreviewLoading(true); setPreviewError(null); setApprovalPreviewReady(false);
    void prepareApprovalPreview(record.graphicId, highQuality ? 'large' : 'medium')
      .then((preview) => { if (cancelled) return; if (preview.status !== 'ready') throw new Error(preview.message || 'The Approval preview is not available.'); setApprovalPreviewReady(true); })
      .catch((reason) => { if (!cancelled) setPreviewError(reason instanceof Error ? reason.message : 'The Approval preview could not be loaded.'); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [record?.graphicId, record?.documentType, highQuality]);

  const openCurrent = async () => {
    if (!record || viewerLoading) return; setViewerLoading(true); setViewerError(null);
    try { const files = await loadFiles(record.graphicId); setViewerFile(record.documentType === 'approval' ? files.approval.latest : files.printCard.latest); setViewerType(record.documentType); }
    catch (reason) { setViewerError(reason instanceof Error ? reason.message : 'The current document could not be opened.'); }
    finally { setViewerLoading(false); }
  };

  const printCardParams = record?.documentType === 'printCard' ? new URLSearchParams({ specificationNumber: record.specificationNumber }).toString() : '';
  const embeddedImageUrl = record?.documentType === 'approval'
    ? `/api/previews/${record.graphicId}/${highQuality ? 'large' : 'medium'}/image`
    : record ? `/api/graphics/${record.graphicId}/print-card.jpg?${printCardParams}` : '';

  return (
    <section className="revisions-page">
      <header className="revisions-heading"><div><p className="eyebrow">Document history</p><h2>Revisions</h2><p>Follow the complete journey of an Approval or Print Card without browsing a database list.</p></div><span className="revision-framework-badge">One history workspace</span></header>
      <form className={`revision-search${record || unregisteredPrintCard ? ' has-result' : ''}`} onSubmit={submit}>
        <label className="revision-type"><span className="sr-only">Document type</span><select aria-label="Document type" onChange={(event) => changeType(event.target.value as RevisionDocumentType)} value={type}><option value="approval">Approval</option><option value="printCard">Print Card</option></select></label>
        <label className="revision-search-input"><span className="sr-only">{type === 'approval' ? 'Search by G#' : 'Search by Spec#'}</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg><input autoComplete="off" onChange={(event) => setInput(event.target.value)} placeholder={type === 'approval' ? 'Search by G#…' : 'Search by Spec#…'} value={input} /></label>
        <button disabled={!input.trim() || query.isFetching} type="submit">{query.isFetching ? 'Searching…' : 'Search History'}</button>
      </form>

      {!search && <section className="revision-empty-state"><div className="revision-empty-mark"><span>↺</span></div><p className="eyebrow">Nothing to browse</p><h3>Search only when history matters.</h3><p>Choose the document type, then enter a {type === 'approval' ? 'G#' : 'Spec#'}.</p></section>}
      {query.isFetching && <LoadingIndicator message="Collecting the current document and its revision journey…" size="panel" title="Searching Revision History" />}
      {query.isError && <section className="revision-message is-error"><strong>Revision search failed.</strong><span>Confirm the server is running, then try the search again.</span></section>}
      {!query.isFetching && query.data && !record && !unregisteredPrintCard && <section className="revision-message"><strong>No history found.</strong><span>{query.data.message}</span></section>}
      {!query.isFetching && unregisteredPrintCard && <UnregisteredPrintCardOnboarding printCard={unregisteredPrintCard} onCreated={() => void query.refetch()} />}

      {record && !query.isFetching && <div className="revision-workspace"><div className="revision-main-grid">
        <div className="revision-history-column">
          <section className="revision-record-hero"><div><span className="revision-document-label">{record.documentType === 'approval' ? 'Approval' : 'Print Card'}</span><div className="revision-record-identifiers"><h3>{record.documentType === 'approval' ? formatGNumber(record.gNumber) : formatSpecNumber(record.specificationNumber)}</h3>{record.documentType === 'printCard' && <span className="revision-linked-g-number">{formatGNumber(record.gNumber)}</span>}</div><p><strong>{record.customerName}</strong><span aria-hidden="true"> · </span><span>{record.partNumber}</span></p></div><div className="revision-current-summary"><span>Current revision</span><strong>{record.currentRevision?.revisionLabel || '—'}</strong><small>{record.currentRevision ? displayDate(record.currentRevision.revisionDate || record.currentRevision.createdAt) : 'Not recorded'}</small></div></section>
          <section className="revision-journey"><header><div><p className="eyebrow">Revision journey</p><h3>The life of this {record.documentType === 'approval' ? 'Approval' : 'Print Card'}</h3></div><span>{record.journey.length} revision{record.journey.length === 1 ? '' : 's'}</span></header>
            {record.journey.length === 0 ? <div className="revision-journey-empty">No structured revisions have been recorded.</div> : <ol>{record.journey.map((revision, index) => <li className={revision.isCurrent ? 'is-current' : ''} key={`${revision.id ?? 'legacy'}-${index}`}><div className="revision-node"><span>{revision.revisionLabel || index}</span></div><article><header><div><strong>Revision {revision.revisionLabel || index}</strong>{revision.isCurrent && <em>Current</em>}</div><time>{displayDate(revision.revisionDate || revision.createdAt)}</time></header><p>{revision.description || 'No change description was recorded.'}</p><footer><span>{revision.source === 'legacy-import' ? 'Legacy history' : 'GraphicsFlow'}</span><span>{[revision.csr, revision.designer].filter(Boolean).join(' · ') || 'Author not recorded'}</span><button type="button">View Revision</button></footer></article></li>)}</ol>}
          </section>
        </div>
        <aside className="revision-document-workspace"><div className="revision-workspace-heading"><p className="eyebrow">Document workspace</p><h3>{record.currentRevision ? `Revision ${record.currentRevision.revisionLabel}` : 'Current document'}</h3><p>{record.currentRevision?.description || 'The current document is shown below.'}</p></div>
          <div className="revision-embedded-viewer"><DocumentCanvas ariaLabel={`Current ${record.documentType === 'approval' ? 'Approval' : 'Print Card'} viewer`} className="revision-document-stage" fitScale={1} isActive key={`${record.documentType}-${record.graphicId}-${highQuality ? 'large' : 'medium'}`} renderAtLayoutScale={false} toolbarEnd={<>{record.documentType === 'approval' && <label className="revision-quality-toggle"><input checked={highQuality} onChange={(event) => setHighQuality(event.target.checked)} type="checkbox" /><span>High Quality</span></label>}<button disabled={viewerLoading} onClick={() => void openCurrent()} type="button">{viewerLoading ? 'Opening…' : 'Full Screen'}</button></>}><div className="revision-document-sheet">{previewLoading && <LoadingIndicator message="Preparing current document…" size="panel" title="Loading Preview" />}{!previewLoading && previewError && <div className="revision-preview-message"><strong>Preview unavailable</strong><span>{previewError}</span></div>}{!previewLoading && !previewError && (record.documentType === 'printCard' || approvalPreviewReady) && <img alt={`Current ${record.documentType === 'approval' ? 'Approval' : 'Print Card'}`} draggable={false} onError={() => setPreviewError('The current document image could not be loaded.')} src={embeddedImageUrl} />}</div></DocumentCanvas></div>
          {viewerError && <span className="revision-open-error">{viewerError}</span>}<div className="revision-primary-actions"><button className="primary" type="button">Create Revision</button><button type="button">Edit Information</button></div>
        </aside>
      </div></div>}
      {viewerRecord && <ApprovalViewer approval={viewerFile} isOpen={viewerType === 'approval'} onClose={() => setViewerType(null)} record={viewerRecord} />}
      {viewerRecord && <PrintCardViewer file={viewerFile} isOpen={viewerType === 'printCard'} onClose={() => setViewerType(null)} record={viewerRecord} />}
    </section>
  );
}
