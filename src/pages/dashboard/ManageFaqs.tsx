import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  adminFetch,
  jsonInit,
  runWithSession,
  SessionExpiredError,
  type AdminFaq,
} from './adminApi';
import { ConfirmDialog, Modal, type ConfirmRequest } from './Modals';
import styles from '../Dashboard.module.css';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type FaqModalState = { mode: 'add' } | { mode: 'edit'; faq: AdminFaq };

export function ManageFaqs({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [faqs, setFaqs] = useState<AdminFaq[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [faqModal, setFaqModal] = useState<FaqModalState | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<AdminFaq[]>('/api/faqs');
      setFaqs(data);
      setLoadError(null);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Request failed');
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmDeleteFaq(faq: AdminFaq) {
    const preview = faq.question.length > 80 ? `${faq.question.slice(0, 80)}…` : faq.question;
    setConfirm({
      title: 'Delete FAQ?',
      message: `Permanently delete the FAQ "${preview}"? This cannot be undone.`,
      warning: faq.imagePath ? 'Its attached image will be deleted too.' : null,
      confirmLabel: 'Yes, delete',
      danger: true,
      onConfirm: async () => {
        if (
          await runWithSession(onSessionExpired, () =>
            adminFetch(`/api/admin/faqs/${faq.id}`, { method: 'DELETE' })
          )
        ) {
          await load();
        }
      },
    });
  }

  return (
    <section className={styles.section}>
      <p className={styles.tabExplainer}>
        These questions and answers appear on the public <strong>FAQs</strong> page. Changes go
        live immediately. Answers can have an image attached (a map, a photo, etc.).
      </p>

      <div className={styles.manageToolbar}>
        <span className={styles.muted}>
          {faqs ? `${faqs.length} FAQ${faqs.length === 1 ? '' : 's'}` : ''}
        </span>
        <button
          className={`${styles.primaryBtn} ${styles.slimBtn}`}
          onClick={() => setFaqModal({ mode: 'add' })}
        >
          + Add FAQ
        </button>
      </div>

      {loadError && (
        <div className={styles.error}>
          {loadError}
          <button className={styles.retryBtn} onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!faqs && !loadError && <div className={styles.loading}>Loading…</div>}
      {faqs && faqs.length === 0 && (
        <div className={styles.emptyBlock}>No FAQs yet; add your first one.</div>
      )}

      {faqs?.map((faq) => (
        <div key={faq.id} className={styles.householdCard}>
          <div className={styles.householdHeader}>
            <div className={styles.householdTitleGroup}>
              <span className={`${styles.tag} ${styles.tagNone}`}>#{faq.order}</span>
              <span className={styles.householdName}>{faq.question}</span>
            </div>
            <div className={styles.rowActions}>
              <button
                className={styles.smallBtn}
                onClick={() => setFaqModal({ mode: 'edit', faq })}
              >
                Edit
              </button>
              <button
                className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                onClick={() => confirmDeleteFaq(faq)}
              >
                Delete
              </button>
            </div>
          </div>
          <div className={styles.faqAnswerBlock}>
            <p className={styles.faqAnswerPreview}>{faq.answer}</p>
            {faq.imagePath && (
              <img src={faq.imagePath} alt="" className={styles.faqThumb} loading="lazy" />
            )}
          </div>
        </div>
      ))}

      {faqModal && (
        <FaqFormModal
          state={faqModal}
          onClose={() => setFaqModal(null)}
          requestConfirm={setConfirm}
          onSessionExpired={onSessionExpired}
          reload={load}
        />
      )}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function FaqFormModal({
  state,
  onClose,
  requestConfirm,
  onSessionExpired,
  reload,
}: {
  state: FaqModalState;
  onClose: () => void;
  requestConfirm: (req: ConfirmRequest) => void;
  onSessionExpired: () => void;
  reload: () => Promise<void>;
}) {
  const editing = state.mode === 'edit' ? state.faq : null;
  const [question, setQuestion] = useState(editing?.question ?? '');
  const [answer, setAnswer] = useState(editing?.answer ?? '');
  const [order, setOrder] = useState(editing ? String(editing.order) : '');
  const [imagePath, setImagePath] = useState<string | null>(editing?.imagePath ?? null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFormError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setFormError('Image must be 15 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const ok = await runWithSession(onSessionExpired, async () => {
        const result = await adminFetch<{ path: string }>('/api/admin/uploads', {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        setImagePath(result.path);
      });
      if (!ok) return;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function buildPayload() {
    const trimmedOrder = order.trim();
    return {
      question: question.trim(),
      answer: answer.trim(),
      imagePath,
      order: trimmedOrder === '' ? undefined : Number(trimmedOrder),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!question.trim() || !answer.trim()) {
      setFormError('Both a question and an answer are required.');
      return;
    }
    const trimmedOrder = order.trim();
    if (trimmedOrder !== '' && !Number.isInteger(Number(trimmedOrder))) {
      setFormError('Order must be a whole number.');
      return;
    }

    if (!editing) {
      setSaving(true);
      try {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch('/api/admin/faqs', jsonInit('POST', buildPayload()))
        );
        if (ok) {
          await reload();
          onClose();
        }
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setSaving(false);
      }
      return;
    }

    const faq = editing;
    const removingImage = !!faq.imagePath && faq.imagePath !== imagePath;
    requestConfirm({
      title: 'Save FAQ changes?',
      message: 'Save these changes? They appear on the public FAQs page immediately.',
      warning: removingImage ? 'The previously attached image will be deleted.' : null,
      confirmLabel: 'Yes, save',
      onConfirm: async () => {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(`/api/admin/faqs/${faq.id}`, jsonInit('PUT', buildPayload()))
        );
        if (ok) {
          await reload();
          onClose();
        }
      },
    });
  }

  return (
    <Modal title={editing ? 'Edit FAQ' : 'Add FAQ'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="faq-question">
              Question
            </label>
            <input
              id="faq-question"
              className={styles.input}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Can I bring my kids?"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="faq-answer">
              Answer
            </label>
            <textarea
              id="faq-answer"
              className={`${styles.input} ${styles.textareaControl}`}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="faq-order">
              Order
            </label>
            <input
              id="faq-order"
              className={styles.input}
              inputMode="numeric"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              placeholder="Leave blank to add at the end"
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Attached Image (optional)</span>
            {imagePath ? (
              <div className={styles.uploadRow}>
                <img src={imagePath} alt="" className={styles.imagePreview} />
                <button
                  type="button"
                  className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                  onClick={() => setImagePath(null)}
                >
                  Remove image
                </button>
              </div>
            ) : (
              <label className={`${styles.smallBtn} ${styles.uploadBtn}`}>
                {uploading ? 'Uploading…' : 'Upload image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className={styles.fileInputHidden}
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
            )}
            <p className={styles.fieldHint}>PNG, JPEG, WebP, or GIF.</p>
          </div>
          {formError && <div className={styles.error}>{formError}</div>}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving || uploading}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add FAQ'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
