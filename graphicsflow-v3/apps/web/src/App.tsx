import { NavLink, Route, Routes } from 'react-router-dom';
import type { FormEvent } from 'react';
import { GraphicsPage } from './pages/GraphicsPage';
import { RevisionsPage } from './pages/RevisionsPage';
import { SettingsPage } from './pages/SettingsPage';

const navigation = [
  ['/', 'Dashboard'],
  ['/graphics', 'Graphics'],
  ['/vendor-art', 'Vendor Art'],
  ['/revisions', 'Revisions'],
  ['/reports', 'Reports'],
  ['/settings', 'Company Settings'],
] as const;

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="page-card">
      <p className="eyebrow">GraphicsFlow V3</p>
      <h2>{title}</h2>
      <p>This module is ready for its feature rebuild.</p>
    </section>
  );
}

function Dashboard() {
  return (
    <div className="dashboard-grid">
      <section className="hero-card">
        <p className="eyebrow">Foundation milestone</p>
        <h2>Graphics Manager, rebuilt for what comes next.</h2>
        <p>The React application shell and TypeScript API are now separated and ready for the G# workflow.</p>
      </section>
      {['Graphics', 'Approvals', 'Vendor Art', 'Print Cards'].map((label) => (
        <article className="stat-card" key={label}><span>{label}</span><strong>Ready</strong></article>
      ))}
    </div>
  );
}

function isNoteField(element: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (element.dataset.noteField === 'true') return true;
  const identity = [
    element.name,
    element.id,
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('placeholder') ?? '',
  ].join(' ').toLowerCase();
  return /(^|\s|[-_])(note|notes)(\s|$|[-_])/.test(identity);
}

function enforceUppercaseText(event: FormEvent<HTMLDivElement>) {
  const element = event.target;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
  if (isNoteField(element)) return;
  if (element instanceof HTMLInputElement && !['text', 'search', 'url', 'tel'].includes(element.type)) return;

  const uppercased = element.value.toUpperCase();
  if (uppercased === element.value) return;
  const selectionStart = element.selectionStart;
  const selectionEnd = element.selectionEnd;
  element.value = uppercased;
  if (selectionStart !== null && selectionEnd !== null) {
    element.setSelectionRange(selectionStart, selectionEnd);
  }
}

export function App() {
  return (
    <div className="app-shell" onInputCapture={enforceUppercaseText}>
      <aside className="sidebar">
        <div className="brand-mark">GF</div>
        <div><p className="brand-name">GraphicsFlow</p><p className="brand-version">Version 3</p></div>
        <nav>
          {navigation.map(([to, label]) => (
            <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} end={to === '/'} key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div><p className="eyebrow">Hood Container · Sumter</p><h1>Good morning, Richie</h1></div>
          <div className="status-pill"><span /> Foundation connected</div>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/graphics" element={<GraphicsPage />} />
          <Route path="/revisions" element={<RevisionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {navigation.filter(([path]) => ['/vendor-art', '/reports'].includes(path)).map(([path, title]) => (
            <Route key={path} path={path} element={<PlaceholderPage title={title} />} />
          ))}
        </Routes>
      </main>
    </div>
  );
}
