export type PrintCardTemplateRevision = {
  revisionLabel: string;
  revisionDate: string;
  description: string;
  csr: string;
  designer: string;
};

export type PrintCardTemplateData = {
  gNumber: string;
  customerNumber: string;
  customerName: string;
  partNumber: string;
  specificationNumber: string;
  designNumber: string;
  revisions: PrintCardTemplateRevision[];
};

const WIDTH = 3000;
const HEIGHT = 1200;

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fit(value: string, max = 44): string {
  const clean = value.trim().toUpperCase();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

function field(label: string, value: string, x: number, y: number, width: number, valueSize = 56): string {
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="150" rx="12" fill="#fff" stroke="#111" stroke-width="5"/>
    <text x="${x + 24}" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="2">${xml(label)}</text>
    <text x="${x + 24}" y="${y + 112}" font-family="Arial, Helvetica, sans-serif" font-size="${valueSize}" font-weight="700">${xml(fit(value, Math.floor(width / 34)))}</text>
  </g>`;
}

export function renderPrintCardSvg(data: PrintCardTemplateData): string {
  const revisions = [...data.revisions].slice(-4);
  while (revisions.length < 4) revisions.unshift({ revisionLabel: '', revisionDate: '', description: '', csr: '', designer: '' });

  const rows = revisions.map((revision, index) => {
    const y = 650 + index * 125;
    return `<g>
      <rect x="70" y="${y}" width="2860" height="125" fill="#fff" stroke="#111" stroke-width="4"/>
      <line x1="290" y1="${y}" x2="290" y2="${y + 125}" stroke="#111" stroke-width="4"/>
      <line x1="670" y1="${y}" x2="670" y2="${y + 125}" stroke="#111" stroke-width="4"/>
      <line x1="2260" y1="${y}" x2="2260" y2="${y + 125}" stroke="#111" stroke-width="4"/>
      <line x1="2580" y1="${y}" x2="2580" y2="${y + 125}" stroke="#111" stroke-width="4"/>
      <text x="180" y="${y + 80}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700">${xml(fit(revision.revisionLabel, 8))}</text>
      <text x="480" y="${y + 80}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="43" font-weight="700">${xml(fit(revision.revisionDate, 14))}</text>
      <text x="700" y="${y + 80}" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="600">${xml(fit(revision.description, 54))}</text>
      <text x="2420" y="${y + 80}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700">${xml(fit(revision.csr, 10))}</text>
      <text x="2755" y="${y + 80}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700">${xml(fit(revision.designer, 10))}</text>
    </g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>
  <rect x="35" y="35" width="2930" height="1130" rx="22" fill="#fff" stroke="#111" stroke-width="10"/>
  <text x="85" y="115" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="900" letter-spacing="4">PRINT CARD</text>
  <text x="2910" y="115" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="70" font-weight="900">${xml(fit(data.gNumber, 24))}</text>
  ${field('CUSTOMER #', data.customerNumber, 70, 165, 660, 52)}
  ${field('CUSTOMER', data.customerName, 755, 165, 1320, 50)}
  ${field('PART # / ITEM', data.partNumber, 2100, 165, 830, 44)}
  ${field('SPEC #', data.specificationNumber || 'NONE', 70, 340, 870, 58)}
  ${field('DESIGN #', data.designNumber || 'NONE', 965, 340, 870, 58)}
  ${field('CURRENT REV', revisions.at(-1)?.revisionLabel || '0', 1860, 340, 520, 62)}
  ${field('REV DATE', revisions.at(-1)?.revisionDate || '', 2405, 340, 525, 48)}
  <g>
    <rect x="70" y="585" width="2860" height="65" fill="#111"/>
    <text x="180" y="630" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800">REV</text>
    <text x="480" y="630" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800">DATE</text>
    <text x="700" y="630" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800">DESCRIPTION</text>
    <text x="2420" y="630" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800">CSR</text>
    <text x="2755" y="630" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800">DES</text>
  </g>
  ${rows}
</svg>`;
}
