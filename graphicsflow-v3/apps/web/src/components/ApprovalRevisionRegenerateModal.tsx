import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { LoadingIndicator } from './LoadingIndicator';
import './ApprovalRevisionRegenerateModal.css';

type Result = { fileName: string; objectUrl: string };

type Props = {
  graphicId: number;
  revisionId: number | null;
  revisionLabel: string;
  isOpen: boolean;
  onClose: () => void;
};

export function ApprovalRevisionRegenerateModal({ graphicId, revisionId, revisionLabel, isOpen, onClose }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !revisionId) return;
    let cancelled = false;
    let objectUrl = '';
    setLoading(true); setError(null); setResult(null);
    void fetch(`/api/graphics/${graphicId}/approval/revisions/${revisionId}.pdf`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'The Approval could not be regenerated.');
        }
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const matched = disposition.match(/filename="?([^";]+)"?/i);
        const fileName = matched?.[1] || `APPROVAL_REV_${revisionLabel}.pdf`;
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        return { fileName, objectUrl };
      })
      .then((body) => { if (!cancelled) setResult(body); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The Approval could not be regenerated.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [graphicId, revisionId, revisionLabel, isOpen]);

  const print = () => {
    if (!result) return;
    const windowRef = window.open(result.objectUrl, '_blank', 'noopener,noreferrer');
    if (!windowRef) setError('Allow pop-ups to open the printable Approval PDF.');
  };

  const download = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.objectUrl;
    link.download = result.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <Modal isOpen={isOpen} onClose={loading ? () => undefined : onClose} title={`Regenerate Approval · Revision ${revisionLabel}`}>
      <div className="approval-regenerate-result">
        {loading && <LoadingIndicator title="Regenerating Approval" message="Building a fresh temporary PDF from the saved revision information and connected artwork…" size="panel" />}
        {!loading && error && <div className="approval-regenerate-error"><strong>Approval could not be regenerated</strong><span>{error}</span></div>}
        {!loading && result && <>
          <div className="approval-regenerate-success"><span>✓</span><div><p className="eyebrow">Temporary PDF ready</p><h3>{result.fileName}</h3><p>This PDF was rebuilt from the selected V3 revision. It is temporary and is not written to the live Approval server.</p></div></div>
          <div className="approval-regenerate-actions"><button onClick={print} type="button"><strong>Print</strong><span>Open the finished PDF in a new window</span></button><button className="primary" onClick={download} type="button"><strong>Download PDF</strong><span>Save a copy to your computer</span></button></div>
          <footer><button onClick={onClose} type="button">Done</button></footer>
        </>}
        {!loading && error && <footer><button onClick={onClose} type="button">Close</button></footer>}
      </div>
    </Modal>
  );
}
