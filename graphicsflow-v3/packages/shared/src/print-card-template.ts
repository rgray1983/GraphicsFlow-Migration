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

const WIDTH = 300;
const HEIGHT = 1200;

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function clean(value: string): string {
  return value.trim().toUpperCase();
}

function fit(value: string, max: number): string {
  const normalized = clean(value);
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function revisionedGNumber(gNumber: string, revision: string): string {
  const base = clean(gNumber).replace(/^G#?/, '').replace(/[^A-Z0-9_-]/g, '');
  const rev = clean(revision);
  if (!base) return '';
  if (!rev || rev === '0' || base.endsWith(`-${rev}`)) return `G#${base}`;
  return `G#${base}-${rev}`;
}

export function renderPrintCardSvg(data: PrintCardTemplateData): string {
  const populatedRevisions = [...data.revisions].slice(-4);
  const revisions = [...populatedRevisions];
  while (revisions.length < 4) revisions.push({ revisionLabel: '', revisionDate: '', description: '', csr: '', designer: '' });

  const tableX = 22;
  const tableY = 210;
  const tableW = 256;
  const tableH = 810;
  const sourceW = 980;
  const sourceH = 234;
  const scaleX = tableH / sourceW;
  const scaleY = tableW / sourceH;
  const columns = [0, 75, 230, 730, 855, 980];
  const headerH = 42;
  const rowH = 48;

  const verticalLines = columns.slice(1, -1).map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${sourceH}"/>`).join('');
  const horizontalLines = [headerH, ...Array.from({ length: 4 }, (_, index) => headerH + rowH * (index + 1))]
    .map((y) => `<line x1="0" y1="${y}" x2="${sourceW}" y2="${y}"/>`).join('');

  const rowMarkup = revisions.map((revision, index) => {
    const baseline = headerH + rowH * index + 32;
    return `<g font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="400">
      <text x="28" y="${baseline}">${xml(fit(revision.revisionLabel, 7))}</text>
      <text x="90" y="${baseline}">${xml(fit(revision.revisionDate, 12))}</text>
      <text x="242" y="${baseline}">${xml(fit(revision.description, 42))}</text>
      <text x="772" y="${baseline}">${xml(fit(revision.csr, 8))}</text>
      <text x="897" y="${baseline}">${xml(fit(revision.designer, 8))}</text>
    </g>`;
  }).join('');

  const latest = populatedRevisions.at(-1);
  const displayG = revisionedGNumber(data.gNumber, latest?.revisionLabel ?? '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>
  <g transform="translate(${tableX + tableW} ${tableY}) rotate(90) scale(${scaleX} ${scaleY})" fill="none" stroke="#000" stroke-width="2">
    <rect x="0" y="0" width="${sourceW}" height="${sourceH}"/>
    ${verticalLines}
    ${horizontalLines}
    <g fill="#000" stroke="none" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">
      <text x="16" y="29">REV</text>
      <text x="103" y="29">DATE</text>
      <text x="410" y="29">DESCRIPTION</text>
      <text x="768" y="29">CSR</text>
      <text x="893" y="29">DES</text>
    </g>
    <g fill="#000" stroke="none">${rowMarkup}</g>
  </g>
  <g fill="#000" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="400">
    <text x="28" y="1045">F#${xml(clean(data.specificationNumber))}</text>
    <text x="28" y="1085">D#${xml(clean(data.designNumber))}</text>
    <text x="28" y="1125">${xml(displayG)}</text>
  </g>
</svg>`;
}
