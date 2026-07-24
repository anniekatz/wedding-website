import { useEffect, useState, type ReactNode } from 'react';
import { householdRsvpStatus, type AdminHousehold } from './adminApi';
import styles from '../Dashboard.module.css';

export function StatusTag({ household }: { household: AdminHousehold }) {
  const status = householdRsvpStatus(household);
  if (status === 'none') {
    return <span className={`${styles.tag} ${styles.tagNone}`}>No RSVP yet</span>;
  }
  if (status === 'partial') {
    return <span className={`${styles.tag} ${styles.tagPartial}`}>Partial RSVP</span>;
  }
  return <span className={`${styles.tag} ${styles.tagDone}`}>RSVP submitted</span>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={styles.modalOverlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmRequest {
  title?: string;
  message: string;
  warning?: string | null;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  confirm,
  onClose,
}: {
  confirm: ConfirmRequest;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await confirm.onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      setBusy(false);
    }
  }

  return (
    <Modal title={confirm.title ?? 'Are you sure?'} onClose={busy ? () => {} : onClose}>
      <div className={styles.modalBody}>
        <p className={styles.confirmMessage}>{confirm.message}</p>
        {confirm.warning && <div className={styles.warnBox}>⚠ {confirm.warning}</div>}
        {error && <div className={styles.error}>{error}</div>}
      </div>
      <div className={styles.modalActions}>
        <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={confirm.danger ? styles.dangerBtn : styles.primaryBtn}
          onClick={handleConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : (confirm.confirmLabel ?? 'Yes, continue')}
        </button>
      </div>
    </Modal>
  );
}
