import { NavLink, Route, Routes } from 'react-router-dom';
import { GraphicsPage } from './pages/GraphicsPage';

const navigation = [
  ['/', 'Dashboard'],
  ['/graphics', 'Graphics'],
  ['/approvals', 'Approvals'],
  ['/vendor-art', 'Vendor Art'],
  ['/print-cards', 'Print Cards'],
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
        <article className="stat-card" key={label}>
          <span>{label}</span>
          <strong>Ready</strong>
        </article>
      ))}
    </div>
  );
}

export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">GF</div>
        <div>
          <p className="brand-name">GraphicsFlow</p>
          <p className="brand-version">Version 3</p>
        </div>
        <nav>
          {navigation.map(([to, label]) => (
            <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} end={to === '/'} key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">Hood Container · Sumter</p>
            <h1>Good morning, Richie</h1>
          </div>
          <div className="status-pill"><span /> Foundation connected</div>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/graphics" element={<GraphicsPage />} />
          {navigation.slice(2).map(([path, title]) => (
            <Route key={path} path={path} element={<PlaceholderPage title={title} />} />
          ))}
        </Routes>
      </main>
    </div>
  );
}
