import { useQuery } from '@tanstack/react-query';
import type { CompanySettings } from '@graphicsflow/shared';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import './DocumentStudioPage.css';

type DocumentKind = 'approval' | 'printCard';
type StartMode = 'recommended' | 'blank' | 'import' | 'duplicate';
type PreviewMode = 'template' | 'live';
type ThemeName = 'Corporate Blue' | 'Industrial Gray' | 'Minimal' | 'Dark' | 'Rounded' | 'Sharp';
type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type ModuleKind = 'title' | 'jobInfo' | 'customer' | 'artwork' | 'colors' | 'dimensions' | 'notes' | 'revision' | 'approval' | 'barcode' | 'qr' | 'signature' | 'table' | 'image';
type ModuleCategory = 'Artwork' | 'Job Info' | 'Customer' | 'Production' | 'Approval' | 'Tables' | 'Images' | 'QR' | 'Barcodes' | 'Signatures' | 'Notes' | 'Custom';

type ModuleOptions = {
  showLabels?: boolean;
  autoGrow?: boolean;
  labelPosition?: 'top' | 'bottom' | 'hidden';
  showAddress?: boolean;
  showContact?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  showBleed?: boolean;
  showTrim?: boolean;
  showDimensions?: boolean;
  showZoom?: boolean;
  showColorList?: boolean;
  showApprovalMarks?: boolean;
  showCropMarks?: boolean;
  artworkFit?: 'fit' | 'fill' | 'stretch';
};

type StudioModule = {
  id: string;
  kind: ModuleKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  options?: ModuleOptions;
};

type StudioTemplate = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  kind: DocumentKind | 'both';
  modules: StudioModule[];
};

type HistoryEntry = { id: string; label: string; time: string };
type WizardAnswers = {
  industry: string;
  fields: string[];
  signatures: boolean;
  revisionHistory: boolean;
  companyLogo: boolean;
  needsPrintCard: boolean;
};

const SAFE = 3;
const resizeDirections: ResizeDirection[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const cloneModules = (modules: StudioModule[]) => modules.map((module) => ({ ...module, id: `${module.kind}-${crypto.randomUUID()}`, options: { ...module.options } }));
const nowLabel = () => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date());

async function loadCompanySettings(): Promise<CompanySettings> {
  const response = await fetch('/api/settings/company');
  if (!response.ok) throw new Error('Company settings could not be loaded.');
  return response.json() as Promise<CompanySettings>;
}

const moduleCatalog: Array<{ category: ModuleCategory; kind: ModuleKind; title: string; description: string; width: number; height: number; options?: ModuleOptions }> = [
  { category: 'Artwork', kind: 'artwork', title: 'Artwork Preview', description: 'Smart artwork area with fit, crop, and production overlays.', width: 52, height: 46, options: { showTrim: true, showDimensions: true, artworkFit: 'fit' } },
  { category: 'Job Info', kind: 'jobInfo', title: 'Job Information', description: 'G#, specification, part number, designer, and dates.', width: 36, height: 24, options: { showLabels: true, autoGrow: true } },
  { category: 'Customer', kind: 'customer', title: 'Customer Information', description: 'Customer name with optional contact details.', width: 36, height: 22, options: { showLabels: true, autoGrow: true, labelPosition: 'top', showAddress: true, showContact: true, showEmail: true } },
  { category: 'Production', kind: 'colors', title: 'Color List', description: 'Ink, coating, plate, and color specification details.', width: 30, height: 22 },
  { category: 'Production', kind: 'dimensions', title: 'Dimensions', description: 'Finished size, board size, scale, and tolerances.', width: 30, height: 20 },
  { category: 'Approval', kind: 'approval', title: 'Approval Choices', description: 'Approve, approve with changes, or revise.', width: 42, height: 20 },
  { category: 'Approval', kind: 'revision', title: 'Revision History', description: 'Revision number, date, author, and change summary.', width: 44, height: 22 },
  { category: 'Tables', kind: 'table', title: 'Custom Table', description: 'Configurable rows and columns for structured data.', width: 44, height: 24 },
  { category: 'Images', kind: 'image', title: 'Company Logo', description: 'Uses the logo configured in Company Settings.', width: 22, height: 20 },
  { category: 'QR', kind: 'qr', title: 'QR Code', description: 'Scannable document, approval, or job reference.', width: 18, height: 18 },
  { category: 'Barcodes', kind: 'barcode', title: 'Barcode', description: 'Machine-readable specification or job identifier.', width: 28, height: 14 },
  { category: 'Signatures', kind: 'signature', title: 'Signature Block', description: 'Name, signature, title, and date fields.', width: 42, height: 18 },
  { category: 'Notes', kind: 'notes', title: 'Notes', description: 'Flexible instructions, disclaimers, and comments.', width: 42, height: 20, options: { showLabels: true, autoGrow: true } },
  { category: 'Custom', kind: 'title', title: 'Document Header', description: 'Logo, document title, and primary identifier.', width: 42, height: 13 },
];

const makeTemplate = (id: string, name: string, description: string, bestFor: string, kind: StudioTemplate['kind'], modules: StudioModule[]): StudioTemplate => ({ id, name, description, bestFor, kind, modules });
const starterTemplates: StudioTemplate[] = [
  makeTemplate('classic-production', 'Classic Production', 'Structured production form with familiar boxed sections.', 'Production teams moving from legacy forms', 'both', [
    { id: 'h', kind: 'title', title: 'Document Header', x: 4, y: 4, width: 92, height: 11 }, { id: 'j', kind: 'jobInfo', title: 'Job Information', x: 4, y: 18, width: 44, height: 20 }, { id: 'c', kind: 'customer', title: 'Customer Information', x: 51, y: 18, width: 45, height: 20 }, { id: 'a', kind: 'artwork', title: 'Artwork Preview', x: 4, y: 41, width: 58, height: 44 }, { id: 'd', kind: 'dimensions', title: 'Dimensions', x: 65, y: 41, width: 31, height: 20 }, { id: 'n', kind: 'notes', title: 'Notes', x: 65, y: 64, width: 31, height: 21 },
  ]),
  makeTemplate('modern-minimal', 'Modern Minimal', 'Clean visual hierarchy with generous whitespace.', 'Customer-facing approvals', 'approval', [
    { id: 'h', kind: 'title', title: 'Artwork Approval', x: 4, y: 4, width: 92, height: 11 }, { id: 'a', kind: 'artwork', title: 'Artwork Preview', x: 4, y: 18, width: 61, height: 52 }, { id: 'j', kind: 'jobInfo', title: 'Job Information', x: 68, y: 18, width: 28, height: 23 }, { id: 'c', kind: 'customer', title: 'Customer', x: 68, y: 44, width: 28, height: 26 }, { id: 's', kind: 'signature', title: 'Approval & Signature', x: 4, y: 73, width: 92, height: 14 },
  ]),
  makeTemplate('customer-friendly', 'Customer Friendly', 'Plain-language approval choices and prominent artwork.', 'Non-technical customer reviewers', 'approval', [
    { id: 'h', kind: 'title', title: 'Please Review Your Artwork', x: 4, y: 4, width: 92, height: 12 }, { id: 'a', kind: 'artwork', title: 'Your Artwork', x: 4, y: 19, width: 64, height: 48 }, { id: 'c', kind: 'customer', title: 'Customer Details', x: 71, y: 19, width: 25, height: 22 }, { id: 'n', kind: 'notes', title: 'What to Check', x: 71, y: 44, width: 25, height: 23 }, { id: 'p', kind: 'approval', title: 'Choose an Approval Option', x: 4, y: 70, width: 58, height: 17 }, { id: 's', kind: 'signature', title: 'Signature', x: 65, y: 70, width: 31, height: 17 },
  ]),
  makeTemplate('corrugated', 'Corrugated', 'Built around board, dimensions, print, and converting data.', 'Corrugated packaging workflows', 'printCard', [
    { id: 'h', kind: 'title', title: 'Corrugated Print Card', x: 4, y: 4, width: 92, height: 11 }, { id: 'a', kind: 'artwork', title: 'Print Layout', x: 4, y: 18, width: 52, height: 50 }, { id: 'j', kind: 'jobInfo', title: 'Job & Board Information', x: 59, y: 18, width: 37, height: 23 }, { id: 'd', kind: 'dimensions', title: 'Dimensions & Scores', x: 59, y: 44, width: 37, height: 24 }, { id: 'co', kind: 'colors', title: 'Ink & Coating', x: 4, y: 71, width: 42, height: 16 }, { id: 'n', kind: 'notes', title: 'Production Notes', x: 49, y: 71, width: 47, height: 16 },
  ]),
  makeTemplate('label', 'Label', 'Compact layout for labels, colors, substrates, and finishing.', 'Label and narrow-web production', 'both', [
    { id: 'h', kind: 'title', title: 'Label Approval', x: 4, y: 4, width: 92, height: 11 }, { id: 'a', kind: 'artwork', title: 'Label Artwork', x: 4, y: 18, width: 56, height: 52 }, { id: 'j', kind: 'jobInfo', title: 'Job Information', x: 63, y: 18, width: 33, height: 20 }, { id: 'd', kind: 'dimensions', title: 'Size & Material', x: 63, y: 41, width: 33, height: 16 }, { id: 'co', kind: 'colors', title: 'Color & Finish', x: 63, y: 60, width: 33, height: 18 }, { id: 's', kind: 'signature', title: 'Approval', x: 4, y: 73, width: 56, height: 14 },
  ]),
  makeTemplate('packaging', 'Packaging', 'Balanced packaging layout with artwork and specification detail.', 'Folding carton and flexible packaging', 'both', [
    { id: 'h', kind: 'title', title: 'Packaging Document', x: 4, y: 4, width: 92, height: 11 }, { id: 'j', kind: 'jobInfo', title: 'Project Information', x: 4, y: 18, width: 33, height: 22 }, { id: 'c', kind: 'customer', title: 'Customer', x: 4, y: 43, width: 33, height: 20 }, { id: 'a', kind: 'artwork', title: 'Package Artwork', x: 40, y: 18, width: 56, height: 45 }, { id: 'co', kind: 'colors', title: 'Print Specifications', x: 4, y: 66, width: 44, height: 21 }, { id: 'n', kind: 'notes', title: 'Special Instructions', x: 51, y: 66, width: 45, height: 21 },
  ]),
  makeTemplate('industrial', 'Industrial', 'Dense, sharp-edged layout designed for production floors.', 'High-information manufacturing documents', 'printCard', [
    { id: 'h', kind: 'title', title: 'Production Specification', x: 4, y: 4, width: 92, height: 10 }, { id: 'j', kind: 'jobInfo', title: 'Identifiers', x: 4, y: 17, width: 28, height: 24 }, { id: 'd', kind: 'dimensions', title: 'Dimensions', x: 4, y: 44, width: 28, height: 20 }, { id: 'co', kind: 'colors', title: 'Production Data', x: 4, y: 67, width: 28, height: 20 }, { id: 'a', kind: 'artwork', title: 'Artwork / Die Layout', x: 35, y: 17, width: 61, height: 47 }, { id: 't', kind: 'table', title: 'Process Checklist', x: 35, y: 67, width: 61, height: 20 },
  ]),
  makeTemplate('photo-focus', 'Photo Focus', 'Large visual presentation with minimal supporting information.', 'Artwork-heavy presentations and mockups', 'approval', [
    { id: 'h', kind: 'title', title: 'Artwork Presentation', x: 4, y: 4, width: 92, height: 10 }, { id: 'a', kind: 'artwork', title: 'Artwork Preview', x: 4, y: 17, width: 70, height: 60 }, { id: 'j', kind: 'jobInfo', title: 'Project', x: 77, y: 17, width: 19, height: 23 }, { id: 'c', kind: 'customer', title: 'Customer', x: 77, y: 43, width: 19, height: 20 }, { id: 's', kind: 'signature', title: 'Approval', x: 4, y: 80, width: 92, height: 9 },
  ]),
];

const initialAnswers: WizardAnswers = { industry: 'Packaging', fields: ['Customer', 'Artwork', 'Job Information'], signatures: true, revisionHistory: true, companyLogo: true, needsPrintCard: false };
const industryOptions = ['Packaging', 'Labels', 'Commercial', 'Flexo', 'Digital', 'Other'];
const fieldOptions = ['Customer', 'Artwork', 'Job Information', 'Dimensions', 'Colors', 'Notes', 'Approval Choices'];

export function DocumentStudioPage() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const companySettingsQuery = useQuery({ queryKey: ['company-settings'], queryFn: loadCompanySettings, staleTime: 60_000 });
  const companyLogoPath = companySettingsQuery.data?.company.logoPath.trim() ?? '';
  const companyName = companySettingsQuery.data?.company.name.trim() || 'Company';
  const [documentKind, setDocumentKind] = useState<DocumentKind>('approval');
  const [modules, setModules] = useState<StudioModule[]>(() => cloneModules(starterTemplates[1].modules));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ModuleCategory>('Artwork');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('template');
  const [theme, setTheme] = useState<ThemeName>('Corporate Blue');
  const [zoom, setZoom] = useState(82);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('modern-minimal');
  const [savedMessage, setSavedMessage] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([{ id: crypto.randomUUID(), label: 'Opened Document Studio', time: nowLabel() }]);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [wizardOpen, setWizardOpen] = useState(true);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardKind, setWizardKind] = useState<DocumentKind>('approval');
  const [startMode, setStartMode] = useState<StartMode>('recommended');
  const [wizardTemplateId, setWizardTemplateId] = useState('modern-minimal');
  const [wizardAnswers, setWizardAnswers] = useState<WizardAnswers>(initialAnswers);

  const selectedModule = modules.find((module) => module.id === selectedId) ?? null;
  const categoryModules = useMemo(() => moduleCatalog.filter((module) => module.category === activeCategory), [activeCategory]);
  const visibleTemplates = useMemo(() => starterTemplates.filter((template) => template.kind === 'both' || template.kind === documentKind), [documentKind]);
  const wizardTemplates = useMemo(() => starterTemplates.filter((template) => template.kind === 'both' || template.kind === wizardKind), [wizardKind]);
  const addHistory = (label: string) => setHistory((current) => [{ id: crypto.randomUUID(), label, time: nowLabel() }, ...current].slice(0, 12));

  const addModuleToList = (list: StudioModule[], kind: ModuleKind) => {
    const definition = moduleCatalog.find((item) => item.kind === kind);
    if (!definition) return;
    list.push({ id: `${kind}-${crypto.randomUUID()}`, kind, title: definition.title, x: 6, y: Math.min(78, 8 + list.length * 5), width: definition.width, height: definition.height, options: { ...definition.options } });
  };

  const addModule = (kind: ModuleKind) => {
    const next: StudioModule[] = [];
    addModuleToList(next, kind);
    if (!next[0]) return;
    setModules((current) => [...current, next[0]]);
    setSelectedId(next[0].id);
    addHistory(`Inserted ${next[0].title}`);
  };

  const updateSelected = (patch: Partial<StudioModule>) => selectedId && setModules((current) => current.map((module) => module.id === selectedId ? { ...module, ...patch } : module));
  const updateSelectedOptions = (patch: Partial<ModuleOptions>) => selectedId && setModules((current) => current.map((module) => module.id === selectedId ? { ...module, options: { ...module.options, ...patch } } : module));
  const removeSelected = () => {
    if (!selectedModule) return;
    setModules((current) => current.filter((module) => module.id !== selectedModule.id));
    addHistory(`Removed ${selectedModule.title}`);
    setSelectedId(null);
  };

  const applyTemplate = (templateId = selectedTemplateId) => {
    const template = starterTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setModules(cloneModules(template.modules)); setSelectedTemplateId(template.id); setSelectedId(null); setTemplateOpen(false); addHistory(`Applied ${template.name}`);
  };

  const finishWizard = () => {
    setDocumentKind(wizardKind);
    if (startMode === 'blank') setModules([]);
    else if (startMode === 'duplicate') {
      const saved = localStorage.getItem(`graphicsflow-document-studio-${wizardKind}`);
      try { setModules(saved ? cloneModules((JSON.parse(saved) as { modules?: StudioModule[] }).modules ?? []) : []); } catch { setModules([]); }
    } else {
      const template = starterTemplates.find((item) => item.id === wizardTemplateId) ?? wizardTemplates[0];
      const nextModules = template ? cloneModules(template.modules) : [];
      if (wizardAnswers.signatures && !nextModules.some((module) => module.kind === 'signature')) addModuleToList(nextModules, 'signature');
      if (wizardAnswers.revisionHistory && !nextModules.some((module) => module.kind === 'revision')) addModuleToList(nextModules, 'revision');
      if (wizardAnswers.companyLogo && !nextModules.some((module) => module.kind === 'image')) addModuleToList(nextModules, 'image');
      setModules(nextModules);
      if (template) setSelectedTemplateId(template.id);
    }
    setWizardOpen(false); setWizardStep(1); setSelectedId(null); addHistory('Built document from Setup Wizard');
  };

  const saveLayout = () => {
    localStorage.setItem(`graphicsflow-document-studio-${documentKind}`, JSON.stringify({ documentKind, modules, theme, savedAt: new Date().toISOString() }));
    setSavedMessage(`${documentKind === 'approval' ? 'Approval' : 'Print Card'} layout saved to Custom Templates.`); addHistory('Saved custom template'); window.setTimeout(() => setSavedMessage(''), 3000);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, module: StudioModule) => {
    if (!canvasRef.current || (event.target as HTMLElement).closest('.studio-resize-handle')) return;
    event.preventDefault(); setSelectedId(module.id);
    const canvas = canvasRef.current.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY; const originX = module.x; const originY = module.y;
    const move = (moveEvent: globalThis.PointerEvent) => {
      let nextX = clamp(originX + ((moveEvent.clientX - startX) / canvas.width) * 100, SAFE, 100 - SAFE - module.width);
      let nextY = clamp(originY + ((moveEvent.clientY - startY) / canvas.height) * 100, SAFE, 100 - SAFE - module.height);
      const threshold = 1.4; const anchorsX = [SAFE, 50 - module.width / 2, 100 - SAFE - module.width]; const anchorsY = [SAFE, 50 - module.height / 2, 100 - SAFE - module.height];
      modules.filter((item) => item.id !== module.id).forEach((item) => { anchorsX.push(item.x, item.x + item.width, item.x - module.width, item.x + item.width - module.width); anchorsY.push(item.y, item.y + item.height, item.y - module.height, item.y + item.height - module.height); });
      const snapX = anchorsX.find((anchor) => Math.abs(anchor - nextX) <= threshold); const snapY = anchorsY.find((anchor) => Math.abs(anchor - nextY) <= threshold);
      if (snapX !== undefined) nextX = snapX; if (snapY !== undefined) nextY = snapY;
      setGuides({ x: snapX, y: snapY }); setModules((current) => current.map((item) => item.id === module.id ? { ...item, x: Math.round(nextX * 2) / 2, y: Math.round(nextY * 2) / 2 } : item));
    };
    const stop = () => { setGuides({}); addHistory(`Moved ${module.title}`); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };

  const startResize = (event: PointerEvent<HTMLSpanElement>, module: StudioModule, direction: ResizeDirection) => {
    if (!canvasRef.current) return;
    event.preventDefault(); event.stopPropagation(); setSelectedId(module.id);
    const canvas = canvasRef.current.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY; const origin = { x: module.x, y: module.y, width: module.width, height: module.height };
    const move = (moveEvent: globalThis.PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / canvas.width) * 100; const dy = ((moveEvent.clientY - startY) / canvas.height) * 100; let { x, y, width, height } = origin;
      if (direction.includes('e')) width = clamp(origin.width + dx, 12, 100 - SAFE - origin.x); if (direction.includes('s')) height = clamp(origin.height + dy, 8, 100 - SAFE - origin.y);
      if (direction.includes('w')) { x = clamp(origin.x + dx, SAFE, origin.x + origin.width - 12); width = origin.width + (origin.x - x); } if (direction.includes('n')) { y = clamp(origin.y + dy, SAFE, origin.y + origin.height - 8); height = origin.height + (origin.y - y); }
      setModules((current) => current.map((item) => item.id === module.id ? { ...item, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, width: Math.round(width * 2) / 2, height: Math.round(height * 2) / 2 } : item));
    };
    const stop = () => { addHistory(`Resized ${module.title}`); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };

  const modulePreview = (module: StudioModule) => {
    if (module.kind === 'artwork') return <><div className="artwork-placeholder">ARTWORK</div><span>{previewMode === 'live' ? 'Live artwork preview' : 'Fit artwork to module'}</span></>;
    if (module.kind === 'title') return <><strong>{documentKind === 'approval' ? 'ARTWORK APPROVAL' : 'PRODUCTION PRINT CARD'}</strong><span>{previewMode === 'live' ? 'G123456 · ACME PACKAGING' : 'G000000 · CUSTOMER NAME'}</span></>;
    if (module.kind === 'customer') return <><strong>{previewMode === 'live' ? 'ACME PACKAGING' : 'Customer Name'}</strong><span>{module.options?.showContact ? 'Contact Name' : 'Smart customer fields'}</span></>;
    if (module.kind === 'image') return companyLogoPath ? <><img alt={`${companyName} logo`} src={companyLogoPath} style={{ maxHeight: '70%', maxWidth: '90%', objectFit: 'contain' }} /><span>{companyName}</span></> : <><strong>Company Logo</strong><span>Configure logo in Company Settings</span></>;
    return <><strong>{module.title}</strong><span>{previewMode === 'live' ? 'Live record data' : 'Smart fields populate from the selected record.'}</span></>;
  };

  return (
    <section className="document-studio-page">
      <header className="studio-heading"><div><p className="eyebrow">Design without the struggle</p><h2>Document Studio</h2><p>Build professional Approvals and Print Cards with guided setup, smart modules, magnetic alignment, and reusable templates.</p></div><div className="studio-heading-actions"><button className="studio-secondary-button" onClick={() => setWizardOpen(true)} type="button">New Document</button><button className="studio-secondary-button" onClick={() => setTemplateOpen(true)} type="button">Choose a Template</button><button className="studio-primary-button" onClick={saveLayout} type="button">Save {documentKind === 'approval' ? 'Approval' : 'Print Card'} Layout</button></div></header>
      <div className="studio-command-bar"><div className="document-kind-switch"><button className={documentKind === 'approval' ? 'is-active' : ''} onClick={() => setDocumentKind('approval')} type="button">Approval</button><button className={documentKind === 'printCard' ? 'is-active' : ''} onClick={() => setDocumentKind('printCard')} type="button">Print Card</button></div><div className="document-kind-switch"><button className={previewMode === 'template' ? 'is-active' : ''} onClick={() => setPreviewMode('template')} type="button">Template Mode</button><button className={previewMode === 'live' ? 'is-active' : ''} onClick={() => setPreviewMode('live')} type="button">Live Preview</button></div><label className="studio-theme-control">Style<select value={theme} onChange={(event) => setTheme(event.target.value as ThemeName)}>{(['Corporate Blue', 'Industrial Gray', 'Minimal', 'Dark', 'Rounded', 'Sharp'] as ThemeName[]).map((name) => <option key={name}>{name}</option>)}</select></label><div className="studio-zoom-control"><span>{zoom}%</span><input aria-label="Canvas zoom" max="100" min="55" onChange={(event) => setZoom(Number(event.target.value))} type="range" value={zoom} /></div></div>
      <div className={`studio-workspace has-library${selectedModule ? ' has-inspector' : ''}`}>
        <aside className="studio-module-library"><header><p className="eyebrow">Module library</p><h3>Add what you need</h3></header><div className="module-categories">{(['Artwork', 'Job Info', 'Customer', 'Production', 'Approval', 'Tables', 'Images', 'QR', 'Barcodes', 'Signatures', 'Notes', 'Custom'] as ModuleCategory[]).map((category) => <button className={activeCategory === category ? 'is-active' : ''} key={category} onClick={() => setActiveCategory(category)} type="button">{category}</button>)}</div><div className="module-results">{categoryModules.map((module) => <button key={`${module.category}-${module.kind}`} onClick={() => addModule(module.kind)} type="button"><span>＋</span><div><strong>{module.title}</strong><small>{module.description}</small></div></button>)}</div><section className="history-panel"><header><strong>History</strong><span>{history.length}</span></header>{history.map((entry) => <div key={entry.id}><time>{entry.time}</time><span>{entry.label}</span></div>)}</section></aside>
        <div className="studio-canvas-stage"><div className="studio-canvas-scale" style={{ width: `${zoom}%` }}><div className={`studio-canvas theme-${theme.toLowerCase().replaceAll(' ', '-')}`} ref={canvasRef}><div className="studio-safe-area" aria-hidden="true" />{guides.x !== undefined && <span className="alignment-guide is-vertical" style={{ left: `${guides.x}%` }} />}{guides.y !== undefined && <span className="alignment-guide is-horizontal" style={{ top: `${guides.y}%` }} />}{modules.map((module) => <div className={`studio-module studio-module-${module.kind}${selectedId === module.id ? ' is-selected' : ''}`} key={module.id} onPointerDown={(event) => startDrag(event, module)} style={{ left: `${module.x}%`, top: `${module.y}%`, width: `${module.width}%`, height: `${module.height}%` }}><div className="studio-module-handle"><span>•••</span><small>{module.title}</small></div><div className="studio-module-preview">{modulePreview(module)}</div>{selectedId === module.id && resizeDirections.map((direction) => <span className={`studio-resize-handle is-${direction}`} key={direction} onPointerDown={(event) => startResize(event, module, direction)} />)}</div>)}</div></div><div className="studio-canvas-tip"><span>✦</span> Modules snap to safe margins, page center, edges, and neighboring modules. Blue guides show alignment.</div></div>
        {selectedModule && <aside className="studio-inspector"><header><div><p className="eyebrow">Smart module</p><h3>{selectedModule.title}</h3></div><button aria-label="Close module settings" onClick={() => setSelectedId(null)} type="button">×</button></header><label>Module title<input onChange={(event) => updateSelected({ title: event.target.value })} value={selectedModule.title} /></label><div className="inspector-grid"><label>Width<input max="94" min="12" onChange={(event) => updateSelected({ width: Number(event.target.value) })} type="number" value={Math.round(selectedModule.width)} /></label><label>Height<input max="90" min="8" onChange={(event) => updateSelected({ height: Number(event.target.value) })} type="number" value={Math.round(selectedModule.height)} /></label></div>{selectedModule.kind === 'image' && <section className="inspector-options"><h4>Company logo source</h4>{companyLogoPath ? <><span>{companyName}</span><small>{companyLogoPath}</small></> : <><span>No company logo is configured.</span><a href="/settings">Configure logo in Company Settings</a></>}</section>}{selectedModule.kind === 'customer' && <section className="inspector-options"><h4>Customer fields</h4><label><input checked={selectedModule.options?.showAddress ?? false} onChange={(event) => updateSelectedOptions({ showAddress: event.target.checked })} type="checkbox" /> Address</label><label><input checked={selectedModule.options?.showContact ?? false} onChange={(event) => updateSelectedOptions({ showContact: event.target.checked })} type="checkbox" /> Contact</label><label><input checked={selectedModule.options?.showPhone ?? false} onChange={(event) => updateSelectedOptions({ showPhone: event.target.checked })} type="checkbox" /> Phone</label><label><input checked={selectedModule.options?.showEmail ?? false} onChange={(event) => updateSelectedOptions({ showEmail: event.target.checked })} type="checkbox" /> Email</label></section>}<button className="studio-delete-button" onClick={removeSelected} type="button">Remove Module</button></aside>}
      </div>
      {savedMessage && <div className="studio-toast" role="status">✓ {savedMessage}</div>}
      {templateOpen && <div className="studio-modal-backdrop"><section className="studio-template-modal"><header><div><p className="eyebrow">Choose a starting point</p><h2>Template Gallery</h2><p>Select a layout that already feels close, then make it yours.</p></div><button onClick={() => setTemplateOpen(false)} type="button">×</button></header><div className="template-gallery">{visibleTemplates.map((template) => <button className={selectedTemplateId === template.id ? 'is-selected' : ''} key={template.id} onClick={() => setSelectedTemplateId(template.id)} type="button"><div className="template-thumbnail">{template.modules.map((module) => <span key={module.id} style={{ left: `${module.x}%`, top: `${module.y}%`, width: `${module.width}%`, height: `${module.height}%` }} />)}</div><strong>{template.name}</strong><small>{template.description}</small><em>Best for: {template.bestFor}</em><span>{template.modules.length} modules included</span></button>)}</div><footer><span>Compare the layouts, then open the closest fit.</span><button className="studio-primary-button" onClick={() => applyTemplate()} type="button">Use This Template</button></footer></section></div>}
      {wizardOpen && <div className="studio-modal-backdrop"><section className="studio-wizard"><header><div><p className="eyebrow">Welcome to GraphicsFlow</p><h2>Let’s build your first document.</h2><p>Answer a few questions and GraphicsFlow will create a professional starting point for you.</p></div><button onClick={() => setWizardOpen(false)} type="button">×</button></header><div className="wizard-progress">{['Document', 'Starting point', 'Industry', 'Information', 'Features', 'Template'].map((label, index) => <span className={wizardStep >= index + 1 ? 'is-active' : ''} key={label}><i>{index + 1}</i>{label}</span>)}</div><div className="wizard-body">{wizardStep === 1 && <div className="wizard-step"><p className="wizard-kicker">What are you creating?</p><h3>Choose your document type.</h3><div className="wizard-choice-grid"><button className={wizardKind === 'approval' ? 'is-selected' : ''} onClick={() => { setWizardKind('approval'); setWizardTemplateId('modern-minimal'); }} type="button"><strong>New Approval</strong><span>Customer-facing artwork review and sign-off.</span></button><button className={wizardKind === 'printCard' ? 'is-selected' : ''} onClick={() => { setWizardKind('printCard'); setWizardTemplateId('corrugated'); }} type="button"><strong>New Print Card</strong><span>Production-focused specifications and job details.</span></button></div></div>}{wizardStep === 2 && <div className="wizard-step"><p className="wizard-kicker">How would you like to start?</p><h3>Choose the path that feels easiest.</h3><div className="wizard-choice-grid four">{([['recommended', 'Recommended Template', 'Answer a few questions and start 90% finished.'], ['blank', 'Blank Layout', 'Start fresh with an empty printable canvas.'], ['import', 'Import Existing Template', 'Bring in a previously exported GraphicsFlow template.'], ['duplicate', 'Duplicate My Template', 'Use your most recently saved custom layout.']] as Array<[StartMode, string, string]>).map(([mode, title, text]) => <button className={startMode === mode ? 'is-selected' : ''} key={mode} onClick={() => setStartMode(mode)} type="button"><strong>{title}</strong><span>{text}</span></button>)}</div></div>}{wizardStep === 3 && <div className="wizard-step"><p className="wizard-kicker">Tell us about your work.</p><h3>What industry best matches your workflow?</h3><div className="wizard-pill-grid">{industryOptions.map((industry) => <button className={wizardAnswers.industry === industry ? 'is-selected' : ''} key={industry} onClick={() => setWizardAnswers((current) => ({ ...current, industry }))} type="button">{industry}</button>)}</div></div>}{wizardStep === 4 && <div className="wizard-step"><p className="wizard-kicker">What information matters?</p><h3>Select what you normally include.</h3><div className="wizard-check-grid">{fieldOptions.map((field) => <label key={field}><input checked={wizardAnswers.fields.includes(field)} onChange={(event) => setWizardAnswers((current) => ({ ...current, fields: event.target.checked ? [...current.fields, field] : current.fields.filter((item) => item !== field) }))} type="checkbox" /><span>{field}</span></label>)}</div></div>}{wizardStep === 5 && <div className="wizard-step"><p className="wizard-kicker">Finish the setup.</p><h3>Which smart features should we include?</h3><div className="wizard-toggle-list"><label><span><strong>Signatures</strong><small>Add customer sign-off fields.</small></span><input checked={wizardAnswers.signatures} onChange={(event) => setWizardAnswers((current) => ({ ...current, signatures: event.target.checked }))} type="checkbox" /></label><label><span><strong>Revision History</strong><small>Track revision number, date, and changes.</small></span><input checked={wizardAnswers.revisionHistory} onChange={(event) => setWizardAnswers((current) => ({ ...current, revisionHistory: event.target.checked }))} type="checkbox" /></label><label><span><strong>Company Logo</strong><small>{companyLogoPath ? `Use ${companyName}'s logo from Company Settings.` : 'Add the logo configured in Company Settings.'}</small></span><input checked={wizardAnswers.companyLogo} onChange={(event) => setWizardAnswers((current) => ({ ...current, companyLogo: event.target.checked }))} type="checkbox" /></label><label><span><strong>Print Card Workflow</strong><small>Prepare this setup for linked Print Cards.</small></span><input checked={wizardAnswers.needsPrintCard} onChange={(event) => setWizardAnswers((current) => ({ ...current, needsPrintCard: event.target.checked }))} type="checkbox" /></label></div></div>}{wizardStep === 6 && <div className="wizard-step"><p className="wizard-kicker">Your recommended starting points</p><h3>Pick the one that feels most like you.</h3><div className="wizard-template-grid">{wizardTemplates.map((template) => <button className={wizardTemplateId === template.id ? 'is-selected' : ''} key={template.id} onClick={() => setWizardTemplateId(template.id)} type="button"><div className="template-thumbnail">{template.modules.map((module) => <span key={module.id} style={{ left: `${module.x}%`, top: `${module.y}%`, width: `${module.width}%`, height: `${module.height}%` }} />)}</div><strong>{template.name}</strong><small>{template.description}</small><em>{template.bestFor}</em></button>)}</div></div>}</div><footer><button className="studio-secondary-button" disabled={wizardStep === 1} onClick={() => setWizardStep((step) => Math.max(1, step - 1))} type="button">Back</button><span>Step {wizardStep} of 6</span>{wizardStep < 6 ? <button className="studio-primary-button" onClick={() => { if (wizardStep === 2 && startMode !== 'recommended') setWizardStep(6); else setWizardStep((step) => Math.min(6, step + 1)); }} type="button">Continue</button> : <button className="studio-primary-button" onClick={finishWizard} type="button">Build My Document</button>}</footer></section></div>}
    </section>
  );
}
