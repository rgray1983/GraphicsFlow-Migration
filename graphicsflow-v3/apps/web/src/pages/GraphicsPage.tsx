import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatGNumber,
  type CreateGraphicResponse,
  type DeleteGraphicResponse,
  type GraphicRecord,
  type GraphicsListResponse,
  type GraphicsSortField,
  type SortDirection,
} from '@graphicsflow/shared';
import { useEffect, useState } from 'react';
import { CreateGraphicModal } from '../components/CreateGraphicModal';
import { GraphicsRecordInspector } from '../components/GraphicsRecordInspector';
import { Toast } from '../components/Toast';
import './GraphicsPage.css';

async function fetchGraphics(search: string, sortBy: GraphicsSortField, sortDirection: SortDirection): Promise<GraphicsListResponse> {
  const params = new URLSearchParams({ sortBy, sortDirection });
  if (search) params.set('search', search);
  const response = await fetch(`/api/graphics?${params.toString()}`);
  if (!response.ok) throw new Error('The graphics list could not be loaded.');
  return response.json() as Promise<GraphicsListResponse>;
}

function formatCreatedAt(value: string | null): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

type SortableHeaderProps = { activeSort: GraphicsSortField; direction: SortDirection; field: GraphicsSortField; label: string; onSort: (field: GraphicsSortField) => void };
function SortableHeader({ activeSort, direction, field, label, onSort }: SortableHeaderProps) {
  const active = activeSort === field;
  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return <th aria-sort={ariaSort} scope="col"><button className={`sort-header${active ? ' is-active' : ''}`} onClick={() => onSort(field)} type="button"><span>{label}</span><span aria-hidden="true" className="sort-arrow">{active ? (direction === 'asc' ? '↑' : '↓') : ''}</span></button></th>;
}

export function GraphicsPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<GraphicsSortField>('gNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedRecord, setSelectedRecord] = useState<GraphicRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<number | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250); return () => window.clearTimeout(timer); }, [searchInput]);
  useEffect(() => { if (!newlyCreatedId) return; const timer = window.setTimeout(() => setNewlyCreatedId(null), 1400); return () => window.clearTimeout(timer); }, [newlyCreatedId]);

  const graphicsQuery = useQuery({ queryKey: ['graphics', search, sortBy, sortDirection], queryFn: () => fetchGraphics(search, sortBy, sortDirection) });
  const records = graphicsQuery.data?.items ?? [];
  const total = graphicsQuery.data?.total ?? 0;
  const drawerOpen = selectedRecord !== null;

  const handleSort = (field: GraphicsSortField) => {
    if (field === sortBy) { setSortDirection((current) => current === 'asc' ? 'desc' : 'asc'); return; }
    setSortBy(field);
    setSortDirection(field === 'gNumber' || field === 'createdAt' ? 'desc' : 'asc');
  };

  const handleCreated = async ({ graphic }: CreateGraphicResponse) => {
    setCreateOpen(false);
    setSearchInput('');
    setSearch('');
    setSortBy('gNumber');
    setSortDirection('desc');
    setSelectedRecord(graphic);
    setNewlyCreatedId(graphic.id);
    setNotification(`${formatGNumber(graphic.gNumber)} created successfully.`);
    await queryClient.invalidateQueries({ queryKey: ['graphics'] });
  };

  const handleDeleted = async ({ deletedGNumber }: DeleteGraphicResponse) => {
    setSelectedRecord(null);
    setNewlyCreatedId(null);
    setNotification(`${formatGNumber(deletedGNumber)} was deleted from the V3 database.`);
    await queryClient.invalidateQueries({ queryKey: ['graphics'] });
  };

  return (
    <section className={`graphics-page${drawerOpen ? ' has-drawer' : ''}`}>
      <Toast message={notification} onDismiss={() => setNotification(null)} />
      <div className="page-heading-row"><div><p className="eyebrow">Graphics database</p><h2>Graphics</h2><p className="page-description">Find a G# and keep its connected information in one workspace.</p></div><div className="record-count" aria-live="polite"><strong>{graphicsQuery.isPending ? '—' : total.toLocaleString()}</strong><span>{search ? 'matching records' : 'total records'}</span></div></div>
      <div className="graphics-toolbar"><label className="search-field"><span className="sr-only">Search graphics records</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg><input autoComplete="off" onChange={(event) => setSearchInput(event.target.value)} placeholder="Search G#, customer number, customer name, or part number…" type="search" value={searchInput} />{searchInput && <button aria-label="Clear search" onClick={() => setSearchInput('')} type="button">Clear</button>}</label><button className="create-graphic-button" onClick={() => setCreateOpen(true)} type="button"><span aria-hidden="true">＋</span>Create G#</button></div>
      <div className="graphics-workspace"><div className="graphics-table-card">
        {graphicsQuery.isPending && <div className="table-state">Loading graphics records…</div>}
        {graphicsQuery.isError && <div className="table-state table-state-error"><strong>Graphics could not be loaded.</strong><span>Confirm that the V3 database is available, then try again.</span><button onClick={() => graphicsQuery.refetch()} type="button">Try again</button></div>}
        {!graphicsQuery.isPending && !graphicsQuery.isError && records.length === 0 && <div className="table-state"><strong>No graphics records found.</strong><span>{search ? `Nothing matched “${search}”.` : 'The graphics database is empty.'}</span></div>}
        {!graphicsQuery.isPending && !graphicsQuery.isError && records.length > 0 && <div className="table-scroll"><table className="graphics-table"><thead><tr><SortableHeader activeSort={sortBy} direction={sortDirection} field="gNumber" label="G#" onSort={handleSort} /><SortableHeader activeSort={sortBy} direction={sortDirection} field="customerNumber" label="Customer #" onSort={handleSort} /><SortableHeader activeSort={sortBy} direction={sortDirection} field="customerName" label="Customer" onSort={handleSort} /><SortableHeader activeSort={sortBy} direction={sortDirection} field="partNumber" label="Part #" onSort={handleSort} /><SortableHeader activeSort={sortBy} direction={sortDirection} field="createdAt" label="Created" onSort={handleSort} /></tr></thead><tbody>{records.map((record) => { const selected = selectedRecord?.id === record.id; const newlyCreated = newlyCreatedId === record.id; const rowClassName = [selected ? 'is-selected' : '', newlyCreated ? 'is-newly-created' : ''].filter(Boolean).join(' ') || undefined; return <tr aria-selected={selected} className={rowClassName} key={record.id} onClick={() => setSelectedRecord(record)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedRecord(record); } }} tabIndex={0}><td><span className="g-number">{formatGNumber(record.gNumber)}</span></td><td>{record.customerNumber || '—'}</td><td className="customer-name">{record.customerName || '—'}</td><td>{record.partNumber || '—'}</td><td className="created-date">{formatCreatedAt(record.createdAt)}</td></tr>; })}</tbody></table></div>}
      </div><GraphicsRecordInspector isOpen={drawerOpen} onClose={() => setSelectedRecord(null)} onDeleted={handleDeleted} record={selectedRecord} /></div>
      {!graphicsQuery.isPending && !graphicsQuery.isError && records.length < total && <p className="result-note">Showing the first {records.length.toLocaleString()} of {total.toLocaleString()} records in the selected sort order.</p>}
      <CreateGraphicModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </section>
  );
}
