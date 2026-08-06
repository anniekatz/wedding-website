import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  adminFetch,
  jsonInit,
  runWithSession,
  SessionExpiredError,
  type AdminScheduleEvent,
} from './adminApi';
import { ConfirmDialog, Modal, type ConfirmRequest } from './Modals';
import styles from '../Dashboard.module.css';

type EventModalState = { mode: 'add' } | { mode: 'edit'; event: AdminScheduleEvent };

function formatEventStart(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatEventEnd(startIso: string, endIso: string) {
  const date = new Date(endIso);
  if (Number.isNaN(date.getTime())) return endIso;
  const sameDay = startIso.slice(0, 10) === endIso.slice(0, 10);
  return date.toLocaleString(
    'en-US',
    sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  );
}

export function ManageSchedule({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [events, setEvents] = useState<AdminScheduleEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [eventModal, setEventModal] = useState<EventModalState | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<AdminScheduleEvent[]>('/api/schedule');
      setEvents(data);
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

  function confirmDeleteEvent(event: AdminScheduleEvent) {
    setConfirm({
      title: 'Delete event?',
      message: `Permanently delete "${event.name}" from the schedule? This cannot be undone.`,
      confirmLabel: 'Yes, delete',
      danger: true,
      onConfirm: async () => {
        if (
          await runWithSession(onSessionExpired, () =>
            adminFetch(`/api/admin/schedule/${event.id}`, { method: 'DELETE' })
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
        These events appear on the public <strong>Schedule</strong> page, ordered by their number.
        Changes go live immediately.
      </p>

      <div className={styles.manageToolbar}>
        <span className={styles.muted}>
          {events ? `${events.length} event${events.length === 1 ? '' : 's'}` : ''}
        </span>
        <button
          className={`${styles.primaryBtn} ${styles.slimBtn}`}
          onClick={() => setEventModal({ mode: 'add' })}
        >
          + Add Event
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
      {!events && !loadError && <div className={styles.loading}>Loading…</div>}
      {events && events.length === 0 && (
        <div className={styles.emptyBlock}>No events yet; add your first one.</div>
      )}

      {events?.map((event) => (
        <div key={event.id} className={styles.householdCard}>
          <div className={styles.householdHeader}>
            <div className={styles.householdTitleGroup}>
              <span className={`${styles.tag} ${styles.tagNone}`}>#{event.order}</span>
              <span className={styles.householdName}>{event.name}</span>
              <span className={styles.muted}>
                {formatEventStart(event.time)}
                {event.endTime ? ` – ${formatEventEnd(event.time, event.endTime)}` : ''}
              </span>
            </div>
            <div className={styles.rowActions}>
              <button
                className={styles.smallBtn}
                onClick={() => setEventModal({ mode: 'edit', event })}
              >
                Edit
              </button>
              <button
                className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                onClick={() => confirmDeleteEvent(event)}
              >
                Delete
              </button>
            </div>
          </div>
          <p className={styles.householdNotes}>
            {event.location}
            {event.description ? ` — ${event.description}` : ''}
          </p>
        </div>
      ))}

      {eventModal && (
        <EventFormModal
          state={eventModal}
          onClose={() => setEventModal(null)}
          requestConfirm={setConfirm}
          onSessionExpired={onSessionExpired}
          reload={load}
        />
      )}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function EventFormModal({
  state,
  onClose,
  requestConfirm,
  onSessionExpired,
  reload,
}: {
  state: EventModalState;
  onClose: () => void;
  requestConfirm: (req: ConfirmRequest) => void;
  onSessionExpired: () => void;
  reload: () => Promise<void>;
}) {
  const editing = state.mode === 'edit' ? state.event : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  // datetime-local inputs take "YYYY-MM-DDTHH:mm"; stored values carry seconds
  const [time, setTime] = useState(editing ? editing.time.slice(0, 16) : '');
  const [endTime, setEndTime] = useState(editing?.endTime ? editing.endTime.slice(0, 16) : '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [order, setOrder] = useState(editing ? String(editing.order) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function buildPayload() {
    const trimmedOrder = order.trim();
    return {
      name: name.trim(),
      location: location.trim(),
      time,
      endTime: endTime || null,
      description: description.trim() || null,
      order: trimmedOrder === '' ? undefined : Number(trimmedOrder),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !location.trim() || !time) {
      setFormError('A name, location, and start time are required.');
      return;
    }
    if (endTime && endTime <= time) {
      setFormError('The end time must be after the start time.');
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
          adminFetch('/api/admin/schedule', jsonInit('POST', buildPayload()))
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

    const event = editing;
    requestConfirm({
      title: 'Save event changes?',
      message: 'Save these changes? They appear on the public Schedule page immediately.',
      confirmLabel: 'Yes, save',
      onConfirm: async () => {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(`/api/admin/schedule/${event.id}`, jsonInit('PUT', buildPayload()))
        );
        if (ok) {
          await reload();
          onClose();
        }
      },
    });
  }

  return (
    <Modal title={editing ? 'Edit Event' : 'Add Event'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-name">
              Name
            </label>
            <input
              id="event-name"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cocktail Hour"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-location">
              Location
            </label>
            <input
              id="event-location"
              className={styles.input}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sculpture Garden"
            />
          </div>
          <div className={styles.formRow2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="event-time">
                Starts
              </label>
              <input
                id="event-time"
                className={styles.input}
                type="datetime-local"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="event-end">
                Ends (optional)
              </label>
              <input
                id="event-end"
                className={styles.input}
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-description">
              Description (optional)
            </label>
            <textarea
              id="event-description"
              className={`${styles.input} ${styles.textareaControl}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-order">
              Order
            </label>
            <input
              id="event-order"
              className={styles.input}
              inputMode="numeric"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              placeholder="Leave blank to add at the end"
            />
          </div>
          {formError && <div className={styles.error}>{formError}</div>}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Event'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
