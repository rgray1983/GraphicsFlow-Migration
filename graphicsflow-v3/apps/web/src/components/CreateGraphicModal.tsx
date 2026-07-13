import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CreateGraphicInput, CreateGraphicResponse } from '@graphicsflow/shared';
import { Modal } from './Modal';
import './CreatorModal.css';

type CreateGraphicModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (response: CreateGraphicResponse) => void;
};

const EMPTY_FORM: CreateGraphicInput = {
  customerNumber: '',
  customerName: '',
  partNumber: '',
};

async function createGraphic(input: CreateGraphicInput): Promise<CreateGraphicResponse> {
  const response = await fetch('/api/graphics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => null) as { error?: string } | CreateGraphicResponse | null;
  if (!response.ok) {
    throw new Error(body && 'error' in body && body.error ? body.error : 'The G# could not be created.');
  }
  return body as CreateGraphicResponse;
}

export function CreateGraphicModal({ isOpen, onClose, onCreated }: CreateGraphicModalProps) {
  const [form, setForm] = useState<CreateGraphicInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useMemo(() => Object.values(form).some((value) => value.trim() !== ''), [form]);

  useEffect(() => {
    if (!isOpen) return;
    setForm(EMPTY_FORM);
    setSubmitting(false);
    setError(null);
  }, [isOpen]);

  const requestClose = () => {
    if (submitting) return;
    if (dirty && !window.confirm('Discard the information entered for this new G#?')) return;
    onClose();
  };

  const updateField = (field: keyof CreateGraphicInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await createGraphic(form);
      onCreated(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The G# could not be created.');
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title="Create G#">
      <form className="creator-form" onSubmit={handleSubmit}>
        <div className="creator-intro">
          <p className="eyebrow">New graphics record</p>
          <h3>Start a new G#</h3>
          <p>GraphicsFlow will assign the next available G# using the identifier configured in Company Settings.</p>
        </div>

        <div className="creator-fields">
          <label>
            <span>Customer #</span>
            <input
              autoFocus
              disabled={submitting}
              maxLength={80}
              onChange={(event) => updateField('customerNumber', event.target.value)}
              required
              value={form.customerNumber}
            />
          </label>
          <label>
            <span>Customer Name</span>
            <input
              disabled={submitting}
              maxLength={160}
              onChange={(event) => updateField('customerName', event.target.value)}
              required
              value={form.customerName}
            />
          </label>
          <label>
            <span>Part #</span>
            <input
              disabled={submitting}
              maxLength={160}
              onChange={(event) => updateField('partNumber', event.target.value)}
              required
              value={form.partNumber}
            />
          </label>
        </div>

        {error && <div className="creator-message is-error" role="alert">{error}</div>}

        <footer className="creator-actions">
          <button className="creator-secondary" disabled={submitting} onClick={requestClose} type="button">Cancel</button>
          <button className="creator-primary" disabled={submitting} type="submit">
            {submitting ? 'Creating G#…' : 'Create G#'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
