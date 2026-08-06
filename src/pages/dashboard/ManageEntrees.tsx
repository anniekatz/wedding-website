import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  adminFetch,
  jsonInit,
  runWithSession,
  SessionExpiredError,
  type AdminEntree,
  type AdminHousehold,
} from './adminApi';
import { ConfirmDialog, Modal, type ConfirmRequest } from './Modals';
import styles from '../Dashboard.module.css';

const AVAILABILITY_LABELS: Record<AdminEntree['availableFor'], string> = {
  both: 'Everyone',
  adult: 'Adults only',
  child: 'Children only',
};

interface StagedEntree {
  value: string;
  label: string;
  availableFor: 'adult' | 'child' | 'both';
}

interface AffectedPerson {
  kind: 'guest' | 'plusOne';
  id: number;
  name: string;
  householdName: string;
  type: 'adult' | 'child';
  removedValue: string;
}

//stay in sync
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 64);
}

export function ManageEntrees({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [entrees, setEntrees] = useState<AdminEntree[] | null>(null);
  const [households, setHouseholds] = useState<AdminHousehold[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [additions, setAdditions] = useState<StagedEntree[]>([]);
  const [removals, setRemovals] = useState<Set<number>>(new Set());
  const [reassignments, setReassignments] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [entreeData, householdData] = await Promise.all([
        adminFetch<AdminEntree[]>('/api/admin/entrees'),
        adminFetch<AdminHousehold[]>('/api/admin/households'),
      ]);
      setEntrees(entreeData);
      setHouseholds(householdData);
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

  const resetStaged = useCallback(() => {
    setAdditions([]);
    setRemovals(new Set());
    setReassignments({});
  }, []);

  const entreeLabels = useMemo(
    () => new Map((entrees ?? []).map((e) => [e.value, e.label])),
    [entrees]
  );

  // how many guests have x entree chosen
  const selectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of households ?? []) {
      for (const g of h.guests) {
        if (g.entreeChoice) counts.set(g.entreeChoice, (counts.get(g.entreeChoice) ?? 0) + 1);
      }
      if (h.plusOne?.entreeChoice) {
        counts.set(h.plusOne.entreeChoice, (counts.get(h.plusOne.entreeChoice) ?? 0) + 1);
      }
    }
    return counts;
  }, [households]);

  const removedValues = useMemo(
    () => new Set((entrees ?? []).filter((e) => removals.has(e.id)).map((e) => e.value)),
    [entrees, removals]
  );

  const affected = useMemo<AffectedPerson[]>(() => {
    if (!households || removedValues.size === 0) return [];
    const list: AffectedPerson[] = [];
    for (const h of households) {
      for (const g of h.guests) {
        if (g.entreeChoice && removedValues.has(g.entreeChoice)) {
          list.push({
            kind: 'guest',
            id: g.id,
            name: `${g.firstName} ${g.lastName}`,
            householdName: h.name,
            type: g.type,
            removedValue: g.entreeChoice,
          });
        }
      }
      if (h.plusOne?.entreeChoice && removedValues.has(h.plusOne.entreeChoice)) {
        list.push({
          kind: 'plusOne',
          id: h.plusOne.id,
          name: `${h.plusOne.firstName} ${h.plusOne.lastName}`,
          householdName: h.name,
          type: 'adult',
          removedValue: h.plusOne.entreeChoice,
        });
      }
    }
    return list;
  }, [households, removedValues]);

  // entrees a guest can get if chosen was removed for whatever reason
  const replacementOptions = useCallback(
    (type: 'adult' | 'child') => {
      const surviving = (entrees ?? [])
        .filter((e) => !removals.has(e.id))
        .filter((e) => e.availableFor === 'both' || e.availableFor === type)
        .map((e) => ({ value: e.value, label: e.label }));
      const added = additions
        .filter((a) => a.availableFor === 'both' || a.availableFor === type)
        .map((a) => ({ value: a.value, label: `${a.label} (new)` }));
      return [...surviving, ...added];
    },
    [entrees, removals, additions]
  );

  const takenValues = useMemo(() => {
    const taken = new Set(
      (entrees ?? []).filter((e) => !removals.has(e.id)).map((e) => e.value.toLowerCase())
    );
    for (const a of additions) taken.add(a.value.toLowerCase());
    return taken;
  }, [entrees, removals, additions]);

  const dirty = additions.length > 0 || removals.size > 0;
  const unassigned = affected.filter((a) => !reassignments[`${a.kind}-${a.id}`]);
  const canSave = dirty && unassigned.length === 0;

  function confirmRemoveEntree(entree: AdminEntree) {
    const count = selectionCounts.get(entree.value) ?? 0;
    setConfirm({
      title: 'Remove entree?',
      message: `Remove "${entree.label}" from the menu? Nothing is deleted until you press Save Changes.`,
      warning:
        count > 0
          ? `${count} guest${count === 1 ? ' has' : 's have'} currently selected this entree. You must choose a replacement for each of them before you can save.`
          : null,
      confirmLabel: 'Yes, remove',
      danger: true,
      onConfirm: () => {
        setRemovals((prev) => new Set(prev).add(entree.id));
      },
    });
  }

  function undoRemoval(id: number) {
    setRemovals((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function stageAddition(entree: StagedEntree) {
    setAdditions((prev) => [...prev, entree]);
  }

  function undoAddition(value: string) {
    setAdditions((prev) => prev.filter((a) => a.value !== value));
    setReassignments((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key] === value) delete next[key];
      }
      return next;
    });
  }

  function confirmSave() {
    const parts: string[] = [];
    if (additions.length > 0) {
      parts.push(`add ${additions.length} entrée${additions.length === 1 ? '' : 's'}`);
    }
    if (removals.size > 0) {
      parts.push(`remove ${removals.size} entrée${removals.size === 1 ? '' : 's'}`);
    }
    if (affected.length > 0) {
      parts.push(`reassign ${affected.length} guest selection${affected.length === 1 ? '' : 's'}`);
    }
    setConfirm({
      title: 'Save menu changes?',
      message: `This will ${parts.join(', ')}. Guests will see the updated menu on the RSVP page immediately.`,
      confirmLabel: 'Yes, save',
      onConfirm: async () => {
        const ok = await runWithSession(onSessionExpired, () =>
          adminFetch(
            '/api/admin/entrees',
            jsonInit('PUT', {
              additions,
              removals: [...removals],
              reassignments: affected.map((a) => ({
                kind: a.kind,
                id: a.id,
                entreeChoice: reassignments[`${a.kind}-${a.id}`],
              })),
            })
          )
        );
        if (ok) {
          resetStaged();
          await load();
        }
      },
    });
  }

  function confirmDiscard() {
    setConfirm({
      title: 'Discard changes?',
      message: 'Discard all unsaved menu changes? The menu stays as it was.',
      confirmLabel: 'Yes, discard',
      danger: true,
      onConfirm: resetStaged,
    });
  }

  const loaded = entrees !== null && households !== null;

  return (
    <section className={styles.section}>
      <p className={styles.tabExplainer}>
        These are the <strong>entrées</strong> guests choose from when they RSVP. You can add new
        options or remove existing ones (no editing), then press <strong>Save Changes</strong> to
        apply everything at once. If guests already picked an entree you remove, you must choose a
        replacement meal for each of them before saving.
      </p>

      <div className={styles.manageToolbar}>
        <span className={styles.muted}>
          {loaded
            ? `${entrees.length} entrée${entrees.length === 1 ? '' : 's'} on the menu`
            : ''}
        </span>
        <button
          className={`${styles.primaryBtn} ${styles.slimBtn}`}
          onClick={() => setShowAddModal(true)}
          disabled={!loaded}
        >
          + Add Entrée
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
      {!loaded && !loadError && <div className={styles.loading}>Loading…</div>}

      {loaded && entrees.length === 0 && additions.length === 0 && (
        <div className={styles.emptyBlock}>No entrees yet; add the first one.</div>
      )}

      {loaded && (entrees.length > 0 || additions.length > 0) && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Entrée</th>
                <th scope="col">Available For</th>
                <th scope="col">Chosen By</th>
                <th scope="col" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {entrees.map((e) => {
                const pendingRemoval = removals.has(e.id);
                const count = selectionCounts.get(e.value) ?? 0;
                return (
                  <tr key={e.id} className={pendingRemoval ? styles.muted : undefined}>
                    <td className={styles.nameCell}>
                      {e.label} <code className={styles.code}>{e.value}</code>{' '}
                      {pendingRemoval && (
                        <span className={`${styles.tag} ${styles.tagNone}`}>removing</span>
                      )}
                    </td>
                    <td>{AVAILABILITY_LABELS[e.availableFor]}</td>
                    <td>
                      {count > 0 ? (
                        `${count} guest${count === 1 ? '' : 's'}`
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {pendingRemoval ? (
                          <button className={styles.smallBtn} onClick={() => undoRemoval(e.id)}>
                            Undo
                          </button>
                        ) : (
                          <button
                            className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                            onClick={() => confirmRemoveEntree(e)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {additions.map((a) => (
                <tr key={`new-${a.value}`}>
                  <td className={styles.nameCell}>
                    {a.label} <code className={styles.code}>{a.value}</code>{' '}
                    <span className={`${styles.tag} ${styles.tagDone}`}>new</span>
                  </td>
                  <td>{AVAILABILITY_LABELS[a.availableFor]}</td>
                  <td>
                    <span className={styles.muted}>—</span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button className={styles.smallBtn} onClick={() => undoAddition(a.value)}>
                        Undo
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {affected.length > 0 && (
        <div className={styles.householdCard}>
          <div className={styles.warnBox}>
            ⚠ {affected.length} guest{affected.length === 1 ? ' has' : 's have'} selected an entree
            that is being removed. Choose a replacement for each of them; saving is blocked until
            every guest has a new entrée.
          </div>
          {affected.map((a) => {
            const key = `${a.kind}-${a.id}`;
            return (
              <div key={key} className={styles.rsvpGuestRow}>
                <div className={styles.rsvpGuestName}>
                  {a.name}
                  {a.kind === 'plusOne' && (
                    <span className={`${styles.tag} ${styles.tagPlusOne}`}>+1</span>
                  )}
                  {a.kind === 'guest' && a.type === 'child' && (
                    <span className={`${styles.tag} ${styles.tagChild}`}>child</span>
                  )}
                </div>
                <div className={styles.formRow2}>
                  <div className={styles.field}>
                    <span className={styles.label}>Current Entrée</span>
                    <span className={styles.muted}>
                      {entreeLabels.get(a.removedValue) ?? a.removedValue} · {a.householdName}
                    </span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`reassign-${key}`}>
                      New Entrée
                    </label>
                    <select
                      id={`reassign-${key}`}
                      className={styles.input}
                      value={reassignments[key] ?? ''}
                      onChange={(e) =>
                        setReassignments((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        Choose a replacement…
                      </option>
                      {replacementOptions(a.type).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dirty && (
        <div className={styles.manageToolbar}>
          <span className={styles.muted}>
            {unassigned.length > 0
              ? `Unsaved changes · ${unassigned.length} guest${unassigned.length === 1 ? ' still needs' : 's still need'} a replacement entrée`
              : 'Unsaved changes'}
          </span>
          <div className={styles.rowActions}>
            <button className={styles.ghostBtn} onClick={confirmDiscard}>
              Discard
            </button>
            <button className={styles.primaryBtn} onClick={confirmSave} disabled={!canSave}>
              Save Changes
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddEntreeModal
          takenValues={takenValues}
          onAdd={stageAddition}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function AddEntreeModal({
  takenValues,
  onAdd,
  onClose,
}: {
  takenValues: Set<string>;
  onAdd: (entree: StagedEntree) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [availableFor, setAvailableFor] = useState<'adult' | 'child' | 'both'>('both');
  const [formError, setFormError] = useState<string | null>(null);
  const value = slugify(label);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!label.trim()) {
      setFormError('A name is required.');
      return;
    }
    if (!value) {
      setFormError('The name must contain at least one letter or number.');
      return;
    }
    if (takenValues.has(value)) {
      setFormError('An entree with a similar name already exists.');
      return;
    }
    onAdd({ value, label: label.trim(), availableFor });
    onClose();
  }

  return (
    <Modal title="Add Entrée" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="entree-label">
              Name
            </label>
            <input
              id="entree-label"
              className={styles.input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Salmon"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="entree-availability">
              Available For
            </label>
            <select
              id="entree-availability"
              className={styles.input}
              value={availableFor}
              onChange={(e) => setAvailableFor(e.target.value as 'adult' | 'child' | 'both')}
            >
              <option value="both">Everyone</option>
              <option value="adult">Adults only</option>
              <option value="child">Children only</option>
            </select>
          </div>
          <p className={styles.fieldHint}>
            The entree is added to the menu when you press Save Changes.
          </p>
          {formError && <div className={styles.error}>{formError}</div>}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn}>
            Add Entrée
          </button>
        </div>
      </form>
    </Modal>
  );
}
