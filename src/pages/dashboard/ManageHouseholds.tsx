import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  adminFetch,
  householdHasRsvp,
  jsonInit,
  runWithSession,
  SessionExpiredError,
  type AdminGuest,
  type AdminHousehold,
} from './adminApi';
import { ConfirmDialog, Modal, StatusTag, type ConfirmRequest } from './Modals';
import styles from '../Dashboard.module.css';

interface GuestDraft {
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  type: 'adult' | 'child';
}

const emptyGuestDraft = (): GuestDraft => ({
  firstName: '',
  lastName: '',
  nickname: '',
  email: '',
  type: 'adult',
});

type HouseholdModalState = { mode: 'add' } | { mode: 'edit'; household: AdminHousehold };
type GuestModalState =
  | { mode: 'add'; household: AdminHousehold }
  | { mode: 'edit'; household: AdminHousehold; guest: AdminGuest };

export function ManageHouseholds({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [households, setHouseholds] = useState<AdminHousehold[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [householdModal, setHouseholdModal] = useState<HouseholdModalState | null>(null);
  const [guestModal, setGuestModal] = useState<GuestModalState | null>(null);

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
        h.inviteCode.toLowerCase().includes(q) ||
        h.guests.some((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
    );
  }, [households, filter]);

  function confirmDeleteHousehold(h: AdminHousehold) {
    setConfirm({
      title: 'Delete household?',
      message: `Permanently delete "${h.name}"? This removes the household, its ${h.guests.length} guest${h.guests.length === 1 ? '' : 's'}, any plus one, and its RSVP history. This cannot be undone.`,
      warning: householdHasRsvp(h)
        ? 'This household has already submitted an RSVP; their reservation will be deleted along with it.'
        : null,
      confirmLabel: 'Yes, delete',
      danger: true,
      onConfirm: async () => {
        if (
          await runWithSession(onSessionExpired, () =>
            adminFetch(`/api/admin/households/${h.id}`, { method: 'DELETE' })
          )
        ) {
          await load();
        }
      },
    });
  }

  function confirmDeleteGuest(h: AdminHousehold, g: AdminGuest) {
    setConfirm({
      title: 'Delete guest?',
      message: `Permanently delete ${g.firstName} ${g.lastName} from "${h.name}"? This cannot be undone.`,
      warning:
        g.attending !== null
          ? `${g.firstName} has already RSVP'd (${g.attending ? 'attending' : 'declined'}); deleting them deletes their response too.`
          : null,
      confirmLabel: 'Yes, delete',
      danger: true,
      onConfirm: async () => {
        if (
          await runWithSession(onSessionExpired, () =>
            adminFetch(`/api/admin/guests/${g.id}`, { method: 'DELETE' })
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
        This is your <strong>invite list</strong>: the households and guests who can look up their
        invitation and RSVP. Changes here affect who is invited, not what they answered. To record
        or change a response, use the <strong>RSVPs</strong> tab.
      </p>

      <div className={styles.manageToolbar}>
        <input
          type="search"
          className={styles.filterInput}
          placeholder="Filter by household, guest, or invite code…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter households"
        />
        <button
          className={`${styles.primaryBtn} ${styles.slimBtn}`}
          onClick={() => setHouseholdModal({ mode: 'add' })}
        >
          + Add Household
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
      {!households && !loadError && <div className={styles.loading}>Loading…</div>}
      {households && filtered.length === 0 && (
        <div className={styles.emptyBlock}>
          {filter ? 'No matches.' : 'No households yet'}
        </div>
      )}

      {filtered.map((h) => (
        <div key={h.id} className={styles.householdCard}>
          <div className={styles.householdHeader}>
            <div className={styles.householdTitleGroup}>
              <span className={styles.householdName}>{h.name}</span>
              <code className={styles.code}>{h.inviteCode}</code>
              {h.allowPlusOne && <span className={`${styles.tag} ${styles.tagAdult}`}>+1 allowed</span>}
              <StatusTag household={h} />
            </div>
            <div className={styles.rowActions}>
              <button
                className={styles.smallBtn}
                onClick={() => setGuestModal({ mode: 'add', household: h })}
              >
                Add Guest
              </button>
              <button
                className={styles.smallBtn}
                onClick={() => setHouseholdModal({ mode: 'edit', household: h })}
              >
                Edit
              </button>
              <button
                className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                onClick={() => confirmDeleteHousehold(h)}
              >
                Delete
              </button>
            </div>
          </div>
          {h.notes && <p className={styles.householdNotes}>{h.notes}</p>}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  <th scope="col">Type</th>
                  <th scope="col">Nickname(s)</th>
                  <th scope="col">Email</th>
                  <th scope="col">RSVP</th>
                  <th scope="col" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {h.guests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.empty}>
                      No guests in this household yet.
                    </td>
                  </tr>
                ) : (
                  h.guests.map((g) => (
                    <tr key={g.id}>
                      <td className={styles.nameCell}>
                        {g.firstName} {g.lastName}
                      </td>
                      <td>
                        <span
                          className={`${styles.tag} ${g.type === 'child' ? styles.tagChild : styles.tagAdult}`}
                        >
                          {g.type}
                        </span>
                      </td>
                      <td>{g.nickname || <span className={styles.muted}>—</span>}</td>
                      <td>{g.email || <span className={styles.muted}>—</span>}</td>
                      <td>
                        {g.attending === null ? (
                          <span className={styles.muted}>No response</span>
                        ) : g.attending ? (
                          'Attending'
                        ) : (
                          'Declined'
                        )}
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            className={styles.smallBtn}
                            onClick={() => setGuestModal({ mode: 'edit', household: h, guest: g })}
                          >
                            Edit
                          </button>
                          <button
                            className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                            onClick={() => confirmDeleteGuest(h, g)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {householdModal && (
        <HouseholdFormModal
          state={householdModal}
          onClose={() => setHouseholdModal(null)}
          requestConfirm={setConfirm}
          onSessionExpired={onSessionExpired}
          reload={load}
        />
      )}
      {guestModal && (
        <GuestFormModal
          state={guestModal}
          onClose={() => setGuestModal(null)}
          requestConfirm={setConfirm}
          onSessionExpired={onSessionExpired}
          reload={load}
        />
      )}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function HouseholdFormModal({
  state,
  onClose,
  requestConfirm,
  onSessionExpired,
  reload,
}: {
  state: HouseholdModalState;
  onClose: () => void;
  requestConfirm: (req: ConfirmRequest) => void;
  onSessionExpired: () => void;
  reload: () => Promise<void>;
}) {
  const editing = state.mode === 'edit' ? state.household : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [inviteCode, setInviteCode] = useState(editing?.inviteCode ?? '');
  const [allowPlusOne, setAllowPlusOne] = useState(editing?.allowPlusOne ?? false);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [reminderEmail, setReminderEmail] = useState(editing?.reminderEmail ?? '');
  const [guestDrafts, setGuestDrafts] = useState<GuestDraft[]>(editing ? [] : [emptyGuestDraft()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateDraft(index: number, patch: Partial<GuestDraft>) {
    setGuestDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError('Household name is required.');
      return;
    }

    if (!editing) {
      const rows = guestDrafts.filter(
        (d) => d.firstName.trim() || d.lastName.trim() || d.nickname.trim() || d.email.trim()
      );
      if (rows.some((d) => !d.firstName.trim() || !d.lastName.trim())) {
        setFormError('Each guest needs both a first and last name.');
        return;
      }
      setSaving(true);
      try {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(
            '/api/admin/households',
            jsonInit('POST', {
              name: name.trim(),
              inviteCode: inviteCode.trim() || undefined,
              allowPlusOne,
              notes: notes.trim() || undefined,
              guests: rows.map((d) => ({
                firstName: d.firstName.trim(),
                lastName: d.lastName.trim(),
                nickname: d.nickname.trim() || undefined,
                email: d.email.trim() || undefined,
                type: d.type,
              })),
            })
          )
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

    if (!inviteCode.trim()) {
      setFormError('Invite code is required.');
      return;
    }
    const household = editing;
    const warnings: string[] = [];
    if (householdHasRsvp(household)) {
      warnings.push('This household has already submitted an RSVP.');
    }
    if (household.plusOne && !allowPlusOne) {
      warnings.push(
        `Turning off their plus one will remove the recorded plus one (${household.plusOne.firstName} ${household.plusOne.lastName}).`
      );
    }
    requestConfirm({
      title: 'Save household changes?',
      message: `Save these changes to "${household.name}"?`,
      warning: warnings.join(' ') || null,
      confirmLabel: 'Yes, save',
      onConfirm: async () => {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(
            `/api/admin/households/${household.id}`,
            jsonInit('PUT', {
              name: name.trim(),
              inviteCode: inviteCode.trim(),
              allowPlusOne,
              notes: notes.trim() || null,
              reminderEmail: reminderEmail.trim() || null,
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
    <Modal title={editing ? 'Edit Household' : 'Add Household'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hh-name">
              Household Name
            </label>
            <input
              id="hh-name"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Smith Family"
            />
          </div>
          <div className={styles.formRow2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hh-code">
                Invite Code
              </label>
              <input
                id="hh-code"
                className={styles.input}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={editing ? '' : 'Leave blank to auto-generate'}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Plus One</span>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={allowPlusOne}
                  onChange={(e) => setAllowPlusOne(e.target.checked)}
                />
                <span>May bring a plus one</span>
              </label>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hh-notes">
              Notes (only visible to you)
            </label>
            <input
              id="hh-notes"
              className={styles.input}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. college friends, needs wheelchair seating"
            />
          </div>
          {editing && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hh-email">
                Reminder Email
              </label>
              <input
                id="hh-email"
                type="email"
                className={styles.input}
                value={reminderEmail}
                onChange={(e) => setReminderEmail(e.target.value)}
                placeholder="Usually set by the household during RSVP"
              />
            </div>
          )}

          {!editing && (
            <div className={styles.field}>
              <span className={styles.label}>Guests</span>
              {guestDrafts.map((draft, i) => (
                <div key={i} className={styles.draftCard}>
                  <div className={styles.formRow2}>
                    <input
                      className={styles.input}
                      value={draft.firstName}
                      onChange={(e) => updateDraft(i, { firstName: e.target.value })}
                      placeholder="First name"
                      aria-label={`Guest ${i + 1} first name`}
                    />
                    <input
                      className={styles.input}
                      value={draft.lastName}
                      onChange={(e) => updateDraft(i, { lastName: e.target.value })}
                      placeholder="Last name"
                      aria-label={`Guest ${i + 1} last name`}
                    />
                  </div>
                  <div className={styles.formRow2}>
                    <input
                      className={styles.input}
                      value={draft.nickname}
                      onChange={(e) => updateDraft(i, { nickname: e.target.value })}
                      placeholder="Nickname(s), comma-separated"
                      aria-label={`Guest ${i + 1} nicknames`}
                    />
                    <input
                      className={styles.input}
                      type="email"
                      value={draft.email}
                      onChange={(e) => updateDraft(i, { email: e.target.value })}
                      placeholder="Email (optional)"
                      aria-label={`Guest ${i + 1} email`}
                    />
                  </div>
                  <div className={styles.draftFooter}>
                    <select
                      className={styles.input}
                      value={draft.type}
                      onChange={(e) => updateDraft(i, { type: e.target.value as 'adult' | 'child' })}
                      aria-label={`Guest ${i + 1} type`}
                    >
                      <option value="adult">Adult</option>
                      <option value="child">Child</option>
                    </select>
                    <button
                      type="button"
                      className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                      onClick={() => setGuestDrafts((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => setGuestDrafts((prev) => [...prev, emptyGuestDraft()])}
              >
                + Add another guest
              </button>
              <p className={styles.fieldHint}>You can also add guests later from the household card.</p>
            </div>
          )}

          {formError && <div className={styles.error}>{formError}</div>}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Household'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GuestFormModal({
  state,
  onClose,
  requestConfirm,
  onSessionExpired,
  reload,
}: {
  state: GuestModalState;
  onClose: () => void;
  requestConfirm: (req: ConfirmRequest) => void;
  onSessionExpired: () => void;
  reload: () => Promise<void>;
}) {
  const editing = state.mode === 'edit' ? state.guest : null;
  const household = state.household;
  const [firstName, setFirstName] = useState(editing?.firstName ?? '');
  const [lastName, setLastName] = useState(editing?.lastName ?? '');
  const [nickname, setNickname] = useState(editing?.nickname ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [type, setType] = useState<'adult' | 'child'>(editing?.type ?? 'adult');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const payload = () => ({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    nickname: nickname.trim() || null,
    email: email.trim() || null,
    type,
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setFormError('First and last name are required.');
      return;
    }

    if (!editing) {
      setSaving(true);
      try {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(`/api/admin/households/${household.id}/guests`, jsonInit('POST', payload()))
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

    const guest = editing;
    requestConfirm({
      title: 'Save guest changes?',
      message: `Save these changes to ${guest.firstName} ${guest.lastName}?`,
      warning:
        guest.attending !== null
          ? `${guest.firstName} has already RSVP'd (${guest.attending ? 'attending' : 'declined'}). Your changes will show on their existing reservation.`
          : null,
      confirmLabel: 'Yes, save',
      onConfirm: async () => {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(`/api/admin/guests/${guest.id}`, jsonInit('PUT', payload()))
        );
        if (ok) {
          await reload();
          onClose();
        }
      },
    });
  }

  return (
    <Modal
      title={editing ? `Edit Guest in ${household.name}` : `Add Guest for ${household.name}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.formRow2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="guest-first">
                First Name
              </label>
              <input
                id="guest-first"
                className={styles.input}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="guest-last">
                Last Name
              </label>
              <input
                id="guest-last"
                className={styles.input}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="guest-nickname">
              Nickname(s)
            </label>
            <input
              id="guest-nickname"
              className={styles.input}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Johnny, JJ"
            />
            <p className={styles.fieldHint}>
              Used when guests search for their invitation by name. Separate multiple with commas.
            </p>
          </div>
          <div className={styles.formRow2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="guest-email">
                Email (optional)
              </label>
              <input
                id="guest-email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="guest-type">
                Type
              </label>
              <select
                id="guest-type"
                className={styles.input}
                value={type}
                onChange={(e) => setType(e.target.value as 'adult' | 'child')}
              >
                <option value="adult">Adult</option>
                <option value="child">Child</option>
              </select>
            </div>
          </div>
          {formError && <div className={styles.error}>{formError}</div>}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Guest'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
