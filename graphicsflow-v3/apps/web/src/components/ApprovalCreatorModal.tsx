import { useEffect, useState, type FormEvent } from 'react';
import { formatGNumber, type GraphicRecord } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
import { LoadingIndicator } from './LoadingIndicator';
import { Modal } from './Modal';
import './ApprovalCreatorModal.css';

type ApprovalDraft = {
  specificationNumber: string;
  designNumber: string;
  fluteTest: string;
  salesRep: string;
  revisionLabel: string;
  revisionDate: string;
  description: string;
  csr: string;
  designer: string;
};

type ApprovalCreatorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  record: GraphicRecord | null;
};

const emptyDraft = (record: GraphicRecord | null): ApprovalDraft => ({
  specificationNumber: record?.specificationNumber || '',
  designNumber: '',
  fluteTest: '',
  salesRep: '',
  revisionLabel: '0',
  revisionDate: new Date().toISOString().slice(0, 10),
  description: 'FOR APPROVAL',
  csr: '',
  designer: '',
});

export function ApprovalCreatorModal({ isOpen, onClose, record }: ApprovalCreatorModalProps) {
  const [draft, setDraft] = useState<ApprovalDraft>(() => emptyDraft(record));
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(emptyDraft(record));
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  }, [isOpen, record?.id]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const update = (key: keyof ApprovalDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreviewError(null);
  };

  const generatePreview = async (event: FormEvent) => {
    event.preventDefault();
    if (!record) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await fetch(`/api/graphics/${record.id}/approval/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'The Approval preview could not be generated.');
      }
      const nextUrl = URL.createObjectURL(await response.blob());
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'The Approval preview could not be generated.');
    } finally {
      setPreviewLoading(false);
    }
  };

  if (!record) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Create Approval · ${formatGNumber(record.gNumber)}`} variant="creator">
      <div className="approval-creator-modal">
        <header className="approval-creator-heading">
          <div><p className="eyebrow">Approval workspace</p><h3>Create Approval</h3><p>Create and preview an Approval without changing any live production file.</p></div>
          <span className="approval-save-policy">Manual save only</span>
        </header>

        <div className="approval-creator-grid">
          <form className="approval-creator-form" onSubmit={generatePreview}>
            <header><div><p className="eyebrow">Approval information</p><h3>{formatGNumber(record.gNumber)}</h3></div><button disabled={previewLoading} type="submit">{previewLoading ? 'Generating…' : 'Generate Preview'}</button></header>
            <div className="approval-record-summary"><strong>{record.customerName}</strong><span>{record.customerNumber} · {record.partNumber}</span></div>
            <div className="approval-field-grid">
              <label>Spec #<input onChange={(event) => update('specificationNumber', event.target.value)} value={draft.specificationNumber} /></label>
              <label>Design #<input onChange={(event) => update('designNumber', event.target.value)} value={draft.designNumber} /></label>
              <label>Flute / Test<input onChange={(event) => update('fluteTest', event.target.value)} value={draft.fluteTest} /></label>
              <label>Sales Rep<input onChange={(event) => update('salesRep', event.target.value)} value={draft.salesRep} /></label>
            </div>
            <section className="approval-revision-entry">
              <header><div><p className="eyebrow">Revision row</p><h4>Current Approval entry</h4></div></header>
              <div className="approval-revision-grid">
                <label>Rev<input required onChange={(event) => update('revisionLabel', event.target.value)} value={draft.revisionLabel} /></label>
                <label>Date<input required onChange={(event) => update('revisionDate', event.target.value)} type="date" value={draft.revisionDate} /></label>
                <label>Description<input required onChange={(event) => update('description', event.target.value)} value={draft.description} /></label>
                <label>CSR<input onChange={(event) => update('csr', event.target.value)} value={draft.csr} /></label>
                <label>Designer<input onChange={(event) => update('designer', event.target.value)} value={draft.designer} /></label>
              </div>
            </section>
            {previewError && <div className="approval-preview-error" role="alert">{previewError}</div>}
            <div className="approval-creator-policy"><strong>No automatic server writes</strong><span>Generate Preview creates a temporary image from the V3 HCC Approval template. Nothing is saved or published.</span></div>
          </form>

          <aside className="approval-creator-preview">
            <DocumentCanvas ariaLabel={`${formatGNumber(record.gNumber)} Approval preview`} fitScale={1} isActive={isOpen} key={`${record.id}-${previewUrl}`} renderAtLayoutScale={false} toolbarEnd={<button disabled={!previewUrl || previewLoading} type="button">Save Approval…</button>}>
              <div className="approval-sheet-preview">
                {previewLoading ? <LoadingIndicator message="Filling HCC APPROVAL FORM-2026.pdf and rendering a temporary preview…" size="viewer" title="Generating Approval Preview" /> : previewUrl ? <img alt={`${formatGNumber(record.gNumber)} HCC Approval preview`} className="approval-template-preview-image" draggable={false} src={previewUrl} /> : <div className="approval-preview-prompt"><strong>Preview not generated</strong><span>Complete the information and choose Generate Preview.</span></div>}
              </div>
            </DocumentCanvas>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
