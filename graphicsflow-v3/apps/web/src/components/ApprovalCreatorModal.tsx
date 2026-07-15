import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatGNumber, type GraphicRecord } from '@graphicsflow/shared';
import { DocumentCanvas } from './DocumentCanvas';
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
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(emptyDraft(record));
    setPreviewReady(false);
  }, [isOpen, record?.id]);

  const displayDate = useMemo(() => {
    if (!draft.revisionDate) return '';
    const parsed = new Date(`${draft.revisionDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? draft.revisionDate : parsed.toLocaleDateString('en-US');
  }, [draft.revisionDate]);

  const update = (key: keyof ApprovalDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreviewReady(false);
  };

  const generatePreview = (event: FormEvent) => {
    event.preventDefault();
    setPreviewReady(true);
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
            <header><div><p className="eyebrow">Approval information</p><h3>{formatGNumber(record.gNumber)}</h3></div><button type="submit">Generate Preview</button></header>
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
            <div className="approval-creator-policy"><strong>No automatic server writes</strong><span>Generate Preview only updates this workspace. Saving and publishing remain separate, deliberate actions.</span></div>
          </form>

          <aside className="approval-creator-preview">
            <DocumentCanvas ariaLabel={`${formatGNumber(record.gNumber)} Approval preview`} fitScale={1} isActive={isOpen} key={`${record.id}-${previewReady}`} renderAtLayoutScale={false} toolbarEnd={<button disabled={!previewReady} type="button">Save Approval…</button>}>
              <div className="approval-sheet-preview">
                {!previewReady ? <div className="approval-preview-prompt"><strong>Preview not generated</strong><span>Complete the information and choose Generate Preview.</span></div> : <article>
                  <header><div><b>Customer</b><span>{record.customerName}</span></div><div><b>Cust. #</b><span>{record.customerNumber}</span></div><div><b>Spec #</b><span>{draft.specificationNumber || '—'}</span></div><div><b>Design #</b><span>{draft.designNumber || '—'}</span></div><div><b>Graphics #</b><span>{record.gNumber}</span></div></header>
                  <section className="approval-sheet-subhead"><div><b>Item Description</b><span>{record.partNumber}</span></div><div><b>Test & Flute</b><span>{draft.fluteTest || '—'}</span></div><div><b>Sales Rep</b><span>{draft.salesRep || '—'}</span></div><div><b>Date</b><span>{displayDate || '—'}</span></div></section>
                  <div className="approval-art-placeholder"><span>Artwork preview area</span></div>
                  <footer><div><b>Rev</b><span>{draft.revisionLabel}</span></div><div><b>Date</b><span>{displayDate}</span></div><div><b>Description</b><span>{draft.description}</span></div><div><b>CSR</b><span>{draft.csr || '—'}</span></div><div><b>Designer</b><span>{draft.designer || '—'}</span></div></footer>
                </article>}
              </div>
            </DocumentCanvas>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
