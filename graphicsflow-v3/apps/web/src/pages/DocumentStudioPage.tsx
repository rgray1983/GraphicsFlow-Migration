import { useMemo, useRef, useState, type PointerEvent } from 'react';
import './DocumentStudioPage.css';

type DocumentKind = 'approval' | 'printCard';
type ModuleKind = 'title' | 'jobInfo' | 'customer' | 'artwork' | 'colors' | 'dimensions' | 'notes' | 'revision' | 'approval' | 'barcode';

type StudioModule = {
  id: string;
  kind: ModuleKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type StudioTemplate = {
  id: string;
  name: string;
  description: string;
  kind: DocumentKind | 'both';
  modules: StudioModule[];
};

const moduleCatalog: Array<{ kind: ModuleKind; title: string; description: string; width: number; height: number }> = [
  { kind: 'title', title: 'Document Header', description: 'Logo, document title, and primary identifier.', width: 42, height: 13 },
  { kind: 'jobInfo', title: 'Job Information', description: 'G#, specification, part number, designer, and dates.', width: 36, height: 24 },
  { kind: 'customer', title: 'Customer Information', description: 'Customer name, contact, address, phone, and email.', width: 36, height: 22 },
  { kind: 'artwork', title: 'Artwork Preview', description: 'A smart artwork area with fit, crop, and caption options.', width: 52, height: 46 },
  { kind: 'colors', title: 'Color List', description: 'Ink, coating, plate, and color specification details.', width: 30, height: 22 },
  { kind: 'dimensions', title: 'Dimensions', description: 'Finished size, board dimensions, scale, and tolerances.', width: 30, height: 20 },
  { kind: 'notes', title: 'Notes', description: 'Flexible instructions, disclaimers, and production notes.', width: 42, height: 20 },
  { kind: 'revision', title: 'Revision History', description: 'Revision number, date, author, and change summary.', width: 44, height: 22 },
  { kind: 'approval', title: 'Approval & Signatures', description: 'Approval choice, signatures, dates, and customer comments.', width: 44, height: 22 },
  { kind: 'barcode', title: 'Barcode / QR', description: 'A compact machine-readable document reference.', width: 18, height: 18 },
];

const starterTemplates: StudioTemplate[] = [
  {
    id: 'modern-approval',
    name: 'Modern Approval',
    description: 'Artwork-first layout with clear customer approval controls.',
    kind: 'approval',
    modules: [
      { id: 'header', kind: 'title', title: 'Document Header', x: 4, y: 4, width: 92, height: 12 },
      { id: 'job', kind: 'jobInfo', title: 'Job Information', x: 4, y: 19, width: 30, height: 22 },
      { id: 'customer', kind: 'customer', title: 'Customer Information', x: 4, y: 44, width: 30, height: 22 },
      { id: 'artwork', kind: 'artwork', title: 'Artwork Preview', x: 37, y: 19, width: 59, height: 47 },
      { id: 'notes', kind: 'notes', title: 'Notes', x: 4, y: 69, width: 45, height: 18 },
      { id: 'approval', kind: 'approval', title: 'Approval & Signatures', x: 52, y: 69, width: 44, height: 18 },
    ],
  },
  {
    id: 'production-card',
    name: 'Production Print Card',
    description: 'Dense, readable production layout with artwork and manufacturing data.',
    kind: 'printCard',
    modules: [
      { id: 'header', kind: 'title', title: 'Document Header', x: 4, y: 4, width: 92, height: 12 },
      { id: 'artwork', kind: 'artwork', title: 'Artwork Preview', x: 4, y: 19, width: 54, height: 52 },
      { id: 'job', kind: 'jobInfo', title: 'Job Information', x: 61, y: 19, width: 35, height: 23 },
      { id: 'dimensions', kind: 'dimensions', title: 'Dimensions', x: 61, y: 45, width: 35, height: 26 },
      { id: 'colors', kind: 'colors', title: 'Color List', x: 4, y: 74, width: 36, height: 14 },
      { id: 'notes', kind: 'notes', title: 'Production Notes', x: 43, y: 74, width: 53, height: 14 },
    ],
  },
  {
    id: 'clean-minimal',
    name: 'Clean Minimal',
    description: 'A flexible starter with generous whitespace and simple hierarchy.',
    kind: 'both',
    modules: [
      { id: 'header', kind: 'title', title: 'Document Header', x: 4, y: 4, width: 92, height: 12 },
      { id: 'artwork', kind: 'artwork', title: 'Artwork Preview', x: 4, y: 20, width: 58, height: 50 },
      { id: 'job', kind: 'jobInfo', title: 'Document Details', x: 65, y: 20, width: 31, height: 23 },
      { id: 'notes', kind: 'notes', title: 'Notes', x: 65, y: 46, width: 31, height: 24 },
      { id: 'approval', kind: 'approval', title: 'Sign-Off', x: 4, y: 74, width: 92, height: 14 },
    ],
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const cloneModules = (modules: StudioModule[]) => modules.map((module) => ({ ...module, id: `${module.kind}-${crypto.randomUUID()}` }));

export function DocumentStudioPage() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [documentKind, setDocumentKind] = useState<DocumentKind>('approval');
  const [modules, setModules] = useState<StudioModule[]>(() => cloneModules(starterTemplates[0].modules));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('modern-approval');
  const [modulePicker, setModulePicker] = useState<ModuleKind | ''>('');
  const [savedMessage, setSavedMessage] = useState('');
  const [zoom, setZoom] = useState(82);

  const visibleTemplates = useMemo(
    () => starterTemplates.filter((template) => template.kind === 'both' || template.kind === documentKind),
    [documentKind],
  );
  const selectedModule = modules.find((module) => module.id === selectedId) ?? null;

  const chooseDocumentKind = (kind: DocumentKind) => {
    setDocumentKind(kind);
    const recommended = starterTemplates.find((template) => template.kind === kind) ?? starterTemplates[0];
    setSelectedTemplateId(recommended.id);
    setModules(cloneModules(recommended.modules));
    setSelectedId(null);
  };

  const addModule = () => {
    if (!modulePicker) return;
    const definition = moduleCatalog.find((item) => item.kind === modulePicker);
    if (!definition) return;
    const offset = modules.length % 6;
    const module: StudioModule = {
      id: `${definition.kind}-${crypto.randomUUID()}`,
      kind: definition.kind,
      title: definition.title,
      x: 6 + offset * 3,
      y: 8 + offset * 4,
      width: definition.width,
      height: definition.height,
    };
    setModules((current) => [...current, module]);
    setSelectedId(module.id);
    setModulePicker('');
  };

  const applyTemplate = () => {
    const template = starterTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    setModules(cloneModules(template.modules));
    setSelectedId(null);
    setTemplateOpen(false);
  };

  const saveLayout = () => {
    const key = `graphicsflow-document-studio-${documentKind}`;
    localStorage.setItem(key, JSON.stringify({ documentKind, modules, savedAt: new Date().toISOString() }));
    setSavedMessage(`${documentKind === 'approval' ? 'Approval' : 'Print Card'} layout saved to Custom Templates.`);
    window.setTimeout(() => setSavedMessage(''), 3200);
  };

  const updateSelected = (patch: Partial<StudioModule>) => {
    if (!selectedId) return;
    setModules((current) => current.map((module) => (module.id === selectedId ? { ...module, ...patch } : module)));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setModules((current) => current.filter((module) => module.id !== selectedId));
    setSelectedId(null);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, module: StudioModule) => {
    if (!canvasRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(module.id);
    const canvas = canvasRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = module.x;
    const originY = module.y;

    const move = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = ((moveEvent.clientX - startX) / canvas.width) * 100;
      const deltaY = ((moveEvent.clientY - startY) / canvas.height) * 100;
      let nextX = clamp(originX + deltaX, 3, 97 - module.width);
      let nextY = clamp(originY + deltaY, 3, 97 - module.height);
      const threshold = 1.4;
      const anchorsX = [3, 50 - module.width / 2, 97 - module.width];
      const anchorsY = [3, 50 - module.height / 2, 97 - module.height];

      modules.filter((item) => item.id !== module.id).forEach((item) => {
        anchorsX.push(item.x, item.x + item.width, item.x - module.width, item.x + item.width - module.width);
        anchorsY.push(item.y, item.y + item.height, item.y - module.height, item.y + item.height - module.height);
      });

      const snapX = anchorsX.find((anchor) => Math.abs(anchor - nextX) <= threshold);
      const snapY = anchorsY.find((anchor) => Math.abs(anchor - nextY) <= threshold);
      nextX = snapX ?? Math.round(nextX * 2) / 2;
      nextY = snapY ?? Math.round(nextY * 2) / 2;
      setModules((current) => current.map((item) => (item.id === module.id ? { ...item, x: nextX, y: nextY } : item)));
    };

    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  return (
    <section className="document-studio-page">
      <header className="studio-heading">
        <div>
          <p className="eyebrow">Design without the struggle</p>
          <h2>Document Studio</h2>
          <p>Build professional Approvals and Print Cards with smart modules, magnetic alignment, and reusable templates.</p>
        </div>
        <div className="studio-heading-actions">
          <button className="studio-secondary-button" onClick={() => setTemplateOpen(true)} type="button">Choose a Template</button>
          <button className="studio-primary-button" onClick={saveLayout} type="button">Save {documentKind === 'approval' ? 'Approval' : 'Print Card'} Layout</button>
        </div>
      </header>

      <div className="studio-command-bar">
        <div className="document-kind-switch" aria-label="Document type">
          <button className={documentKind === 'approval' ? 'is-active' : ''} onClick={() => chooseDocumentKind('approval')} type="button">Approval</button>
          <button className={documentKind === 'printCard' ? 'is-active' : ''} onClick={() => chooseDocumentKind('printCard')} type="button">Print Card</button>
        </div>
        <div className="module-add-control">
          <label htmlFor="module-picker">Add a module</label>
          <select id="module-picker" onChange={(event) => setModulePicker(event.target.value as ModuleKind | '')} value={modulePicker}>
            <option value="">Select module…</option>
            {moduleCatalog.map((module) => <option key={module.kind} value={module.kind}>{module.title}</option>)}
          </select>
          <button disabled={!modulePicker} onClick={addModule} type="button">Add to Canvas</button>
        </div>
        <div className="studio-zoom-control">
          <span>{zoom}%</span>
          <input aria-label="Canvas zoom" max="100" min="55" onChange={(event) => setZoom(Number(event.target.value))} type="range" value={zoom} />
        </div>
      </div>

      <div className={`studio-workspace${selectedModule ? ' has-inspector' : ''}`}>
        <div className="studio-canvas-stage">
          <div className="studio-canvas-scale" style={{ width: `${zoom}%` }}>
            <div className="studio-canvas" ref={canvasRef}>
              <div className="studio-safe-area" aria-hidden="true" />
              {modules.map((module) => (
                <div
                  className={`studio-module studio-module-${module.kind}${selectedId === module.id ? ' is-selected' : ''}`}
                  key={module.id}
                  onPointerDown={(event) => startDrag(event, module)}
                  style={{ left: `${module.x}%`, top: `${module.y}%`, width: `${module.width}%`, height: `${module.height}%` }}
                >
                  <div className="studio-module-handle"><span>•••</span><small>{module.title}</small></div>
                  <div className="studio-module-preview">
                    {module.kind === 'artwork' ? <><div className="artwork-placeholder">ARTWORK</div><span>Fit artwork to module</span></> : null}
                    {module.kind === 'title' ? <><strong>{documentKind === 'approval' ? 'ARTWORK APPROVAL' : 'PRODUCTION PRINT CARD'}</strong><span>G000000 · CUSTOMER NAME</span></> : null}
                    {!['artwork', 'title'].includes(module.kind) ? <><strong>{module.title}</strong><span>Smart fields will populate from the selected record.</span></> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="studio-canvas-tip"><span>✦</span> Drag modules near an edge or another module to snap them into alignment.</div>
        </div>

        {selectedModule && (
          <aside className="studio-inspector">
            <header><div><p className="eyebrow">Module settings</p><h3>{selectedModule.title}</h3></div><button aria-label="Close module settings" onClick={() => setSelectedId(null)} type="button">×</button></header>
            <label>Module title<input onChange={(event) => updateSelected({ title: event.target.value })} value={selectedModule.title} /></label>
            <div className="inspector-grid">
              <label>Width<input max="94" min="12" onChange={(event) => updateSelected({ width: Number(event.target.value) })} type="number" value={Math.round(selectedModule.width)} /></label>
              <label>Height<input max="90" min="8" onChange={(event) => updateSelected({ height: Number(event.target.value) })} type="number" value={Math.round(selectedModule.height)} /></label>
            </div>
            <section className="inspector-options">
              <h4>Smart behavior</h4>
              <label><input defaultChecked type="checkbox" /> Show field labels</label>
              <label><input defaultChecked type="checkbox" /> Grow for long content</label>
              <label><input defaultChecked type="checkbox" /> Use document theme</label>
            </section>
            <button className="studio-delete-button" onClick={removeSelected} type="button">Remove Module</button>
          </aside>
        )}
      </div>

      {savedMessage && <div className="studio-toast" role="status">✓ {savedMessage}</div>}

      {templateOpen && (
        <div className="studio-modal-backdrop" role="presentation">
          <section aria-labelledby="template-gallery-title" aria-modal="true" className="studio-template-modal" role="dialog">
            <header><div><p className="eyebrow">Make it yours</p><h2 id="template-gallery-title">Choose a starting point</h2><p>Pick a layout, then move, add, remove, and customize anything you like.</p></div><button aria-label="Close template gallery" onClick={() => setTemplateOpen(false)} type="button">×</button></header>
            <div className="template-gallery">
              {visibleTemplates.map((template) => (
                <button className={selectedTemplateId === template.id ? 'is-selected' : ''} key={template.id} onClick={() => setSelectedTemplateId(template.id)} type="button">
                  <div className="template-thumbnail">{template.modules.map((module) => <span key={module.id} style={{ left: `${module.x}%`, top: `${module.y}%`, width: `${module.width}%`, height: `${module.height}%` }} />)}</div>
                  <strong>{template.name}</strong><small>{template.description}</small>
                </button>
              ))}
            </div>
            <footer><span>You can customize every module after the template loads.</span><button className="studio-primary-button" onClick={applyTemplate} type="button">Use This Template</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}
