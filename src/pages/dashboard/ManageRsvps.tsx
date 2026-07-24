import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useWeddingData } from '../../WeddingDataContext';
import {
  adminFetch,
  householdHasRsvp,
  jsonInit,
  runWithSession,
  SessionExpiredError,
  type AdminHousehold,
} from './adminApi';
import { ConfirmDialog, Modal, StatusTag, type ConfirmRequest } from './Modals';
import styles from '../Dashboard.module.css';

type AttendingChoice = 'none' | 'yes' | 'no';

interface GuestRsvpDraft {
  id: number;
  name: string;
  type: 'adult' | 'child';
  attending: AttendingChoice;
  entreeChoice: string;
  comments: string;
}

export function ManageRsvps({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [households, setHouseholds] = useState<AdminHousehold[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [editingHousehold, setEditingHousehold] = useState<AdminHousehold | null>(null);
  const { entreeOptions } = useWeddingData();

  const entreeLabels = useMemo(
    () => new Map(entreeOptions.map((o) => [o.value, o.label])),
    [entreeOptions]
  );

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<AdminHousehold[]>('/api/admin/households');
      setHouseholds(data);
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

  const filtered = useMemo(() => {
    if (!households) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return households;
    return households.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.guests.some((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
    );
  }, [households, filter]);

  function confirmClearRsvp(h: AdminHousehold) {
    setConfirm({
      title: 'Clear reservation?',
      message: `Clear the reservation for "${h.name}"? Every guest goes back to "no response" and any recorded plus one is removed. The household can then RSVP again from scratch.`,
      warning:
        'This household has already submitted an RSVP. This deletes their answers.',
      confirmLabel: 'Yes, clear it',
      danger: true,
      onConfirm: async () => {
        if (
          await runWithSession(onSessionExpired, () =>
            adminFetch(`/api/admin/households/${h.id}/rsvp`, { method: 'DELETE' })
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
        These are <strong>reservations (RSVPs)</strong>: what each household answered: who is
        coming, meals, and plus ones. Anything you save here is recorded on the household's behalf.
        To change who is invited, use the <strong>Invited Households</strong> tab.
      </p>

      <div className={styles.manageToolbar}>
        <input
          type="search"
          className={styles.filterInput}
          placeholder="Filter by household or guest…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter reservations"
        />
      </div>

      {loadError && (
        <div className={styles.error}>
          {loadError}
          <button className={styles.retryBtn} onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!households && !loadError && <div className={styles.loading}>Loading…</div>}
      {households && filtered.length === 0 && (
        <div className={styles.emptyBlock}>
          {filter ? 'No matches.' : 'No households yet.'}
        </div>
      )}

      {households && filtered.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Household</th>
                <th scope="col">Status</th>
                <th scope="col">Guest Responses</th>
                <th scope="col">Plus One</th>
                <th scope="col" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => {
                const hasRsvp = householdHasRsvp(h);
                return (
                  <tr key={h.id}>
                    <td className={styles.nameCell}>{h.name}</td>
                    <td>
                      <StatusTag household={h} />
                    </td>
                    <td>
                      {h.guests.length === 0 ? (
                        <span className={styles.muted}>No guests</span>
                      ) : (
                        h.guests.map((g) => (
                          <div key={g.id} className={styles.respLine}>
                            <span>
                              {g.firstName} {g.lastName}
                            </span>
                            {g.attending === null ? (
                              <span className={styles.muted}>— no response</span>
                            ) : g.attending ? (
                              <span className={styles.respYes}>
                                — attending
                                {g.entreeChoice
                                  ? ` · ${entreeLabels.get(g.entreeChoice) ?? g.entreeChoice}`
                                  : ''}
                              </span>
                            ) : (
                              <span className={styles.respNo}>— declined</span>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                    <td>
                      {!h.allowPlusOne ? (
                        <span className={styles.muted}>Not allowed</span>
                      ) : !h.plusOne ? (
                        <span className={styles.muted}>—</span>
                      ) : (
                        <div className={styles.respLine}>
                          <span>
                            {h.plusOne.firstName} {h.plusOne.lastName}
                          </span>
                          {h.plusOne.attending ? (
                            <span className={styles.respYes}>
                              — bringing
                              {h.plusOne.entreeChoice
                                ? ` · ${entreeLabels.get(h.plusOne.entreeChoice) ?? h.plusOne.entreeChoice}`
                                : ''}
                            </span>
                          ) : (
                            <span className={styles.respNo}>— not bringing</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.smallBtn} onClick={() => setEditingHousehold(h)}>
                          {hasRsvp ? 'Edit RSVP' : 'Record RSVP'}
                        </button>
                        {hasRsvp && (
                          <button
                            className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                            onClick={() => confirmClearRsvp(h)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingHousehold && (
        <RsvpFormModal
          household={editingHousehold}
          onClose={() => setEditingHousehold(null)}
          requestConfirm={setConfirm}
          onSessionExpired={onSessionExpired}
          reload={load}
        />
      )}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function RsvpFormModal({
  household,
  onClose,
  requestConfirm,
  onSessionExpired,
  reload,
}: {
  household: AdminHousehold;
  onClose: () => void;
  requestConfirm: (req: ConfirmRequest) => void;
  onSessionExpired: () => void;
  reload: () => Promise<void>;
}) {
  const { entreeOptions } = useWeddingData();
  const [guestDrafts, setGuestDrafts] = useState<GuestRsvpDraft[]>(() =>
    household.guests.map((g) => ({
      id: g.id,
      name: `${g.firstName} ${g.lastName}`,
      type: g.type,
      attending: g.attending === null ? 'none' : g.attending ? 'yes' : 'no',
      entreeChoice: g.entreeChoice ?? '',
      comments: g.comments ?? '',
    }))
  );
  const [plusOneChoice, setPlusOneChoice] = useState<AttendingChoice>(
    household.plusOne ? (household.plusOne.attending ? 'yes' : 'no') : 'none'
  );
  const [plusOneFirst, setPlusOneFirst] = useState(household.plusOne?.firstName ?? '');
  const [plusOneLast, setPlusOneLast] = useState(household.plusOne?.lastName ?? '');
  const [plusOneEntree, setPlusOneEntree] = useState(household.plusOne?.entreeChoice ?? '');
  const [plusOneComments, setPlusOneComments] = useState(household.plusOne?.comments ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  function getEntreeOptions(guestType: 'adult' | 'child') {
    return entreeOptions.filter((o) => o.availableFor === 'both' || o.availableFor === guestType);
  }

  function updateGuest(id: number, patch: Partial<GuestRsvpDraft>) {
    setGuestDrafts((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (plusOneChoice === 'yes') {
      const first = plusOneFirst.trim();
      const last = plusOneLast.trim();
      if ((first && !last) || (!first && last)) {
        setFormError(
          `Please fill in both first and last name for the plus one, or leave both blank to use "${household.name} + 1".`
        );
        return;
      }
    }

    const hadRsvp = householdHasRsvp(household);
    requestConfirm({
      title: hadRsvp ? 'Overwrite reservation?' : 'Record reservation?',
      message: hadRsvp
        ? `Save these answers for "${household.name}"? This replaces their current reservation.`
        : `Record this reservation on behalf of "${household.name}"?`,
      warning: hadRsvp
        ? 'This household has already submitted an RSVP. Your changes will overwrite their answers.'
        : null,
      confirmLabel: 'Yes, save',
      onConfirm: async () => {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(
            `/api/admin/households/${household.id}/rsvp`,
            jsonInit('PUT', {
              guests: guestDrafts.map((g) => ({
                id: g.id,
                attending: g.attending === 'none' ? null : g.attending === 'yes',
                comments: g.comments,
                entreeChoice: g.entreeChoice,
              })),
              plusOne: !household.allowPlusOne
                ? undefined
                : plusOneChoice === 'none'
                  ? null
                  : {
                      attending: plusOneChoice === 'yes',
                      firstName: plusOneFirst,
                      lastName: plusOneLast,
                      comments: plusOneComments,
                      entreeChoice: plusOneEntree,
                    },
            })
          )
        );
        if (ok) {
          await reload();
          onClose();
        }
      },
    });
  }

  return (
    <Modal title={`Reservation: ${household.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {guestDrafts.map((g) => (
            <div key={g.id} className={styles.rsvpGuestRow}>
              <div className={styles.rsvpGuestName}>
                {g.name}
                {g.type === 'child' && (
                  <span className={`${styles.tag} ${styles.tagChild}`}>child</span>
                )}
              </div>
              <div className={styles.formRow2}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`att-${g.id}`}>
                    Response
                  </label>
                  <select
                    id={`att-${g.id}`}
                    className={styles.input}
                    value={g.attending}
                    onChange={(e) =>
                      updateGuest(g.id, { attending: e.target.value as AttendingChoice })
                    }
                  >
                    <option value="none">No response</option>
                    <option value="yes">Attending</option>
                    <option value="no">Declined</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`entree-${g.id}`}>
                    Entrée
                  </label>
                  <select
                    id={`entree-${g.id}`}
                    className={styles.input}
                    value={g.entreeChoice}
                    onChange={(e) => updateGuest(g.id, { entreeChoice: e.target.value })}
                    disabled={g.attending !== 'yes'}
                  >
                    <option value="">No selection</option>
                    {getEntreeOptions(g.type).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`comments-${g.id}`}>
                  Comments
                </label>
                <input
                  id={`comments-${g.id}`}
                  className={styles.input}
                  value={g.comments}
                  onChange={(e) => updateGuest(g.id, { comments: e.target.value })}
                  placeholder="Dietary restrictions, song requests…"
                />
              </div>
            </div>
          ))}

          {household.allowPlusOne && (
            <div className={styles.rsvpGuestRow}>
              <div className={styles.rsvpGuestName}>
                Plus One <span className={`${styles.tag} ${styles.tagPlusOne}`}>+1</span>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="plusone-choice">
                  Status
                </label>
                <select
                  id="plusone-choice"
                  className={styles.input}
                  value={plusOneChoice}
                  onChange={(e) => setPlusOneChoice(e.target.value as AttendingChoice)}
                >
                  <option value="none">Nothing recorded</option>
                  <option value="yes">Bringing a guest</option>
                  <option value="no">Not bringing a guest</option>
                </select>
              </div>
              {plusOneChoice === 'yes' && (
                <>
                  <div className={styles.formRow2}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="plusone-first">
                        Guest First Name
                      </label>
                      <input
                        id="plusone-first"
                        className={styles.input}
                        value={plusOneFirst}
                        onChange={(e) => setPlusOneFirst(e.target.value)}
                        placeholder={household.name}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="plusone-last">
                        Guest Last Name
                      </label>
                      <input
                        id="plusone-last"
                        className={styles.input}
                        value={plusOneLast}
                        onChange={(e) => setPlusOneLast(e.target.value)}
                        placeholder="+ 1"
                      />
                    </div>
                  </div>
                  <p className={styles.fieldHint}>
                    Leave both blank to record the guest as "{household.name} + 1".
                  </p>
                  <div className={styles.formRow2}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="plusone-entree">
                        Entrée
                      </label>
                      <select
                        id="plusone-entree"
                        className={styles.input}
                        value={plusOneEntree}
                        onChange={(e) => setPlusOneEntree(e.target.value)}
                      >
                        <option value="">No selection</option>
                        {getEntreeOptions('adult').map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="plusone-comments">
                        Comments
                      </label>
                      <input
                        id="plusone-comments"
                        className={styles.input}
                        value={plusOneComments}
                        onChange={(e) => setPlusOneComments(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {formError && <div className={styles.error}>{formError}</div>}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn}>
            Save Reservation
          </button>
        </div>
      </form>
    </Modal>
  );
}
