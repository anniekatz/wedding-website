import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { getSession, login, logout, type AdminSession } from '../auth-client';
import { useWeddingData } from '../WeddingDataContext';
import {
  adminFetch,
  jsonInit,
  SessionExpiredError,
  type AdminSettings,
} from './dashboard/adminApi';
import { ManageHouseholds } from './dashboard/ManageHouseholds';
import { ManageRsvps } from './dashboard/ManageRsvps';
import { ManageEntrees } from './dashboard/ManageEntrees';
import { ManageSchedule } from './dashboard/ManageSchedule';
import { ManageFaqs } from './dashboard/ManageFaqs';
import styles from './Dashboard.module.css';

interface RsvpLog {
  id: number;
  householdId: number;
  householdName: string | null;
  action: 'initial_rsvp' | 'modification' | 'admin_edit' | 'admin_clear';
  timestamp: string;
  snapshot: string;
}

type TabKey = 'overview' | 'households' | 'rsvps' | 'entrees' | 'schedule' | 'faqs';

const TAB_LABELS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'households', label: 'Invited Households' },
  { key: 'rsvps', label: 'RSVPs' },
  { key: 'entrees', label: 'Entrées' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'faqs', label: 'FAQs' },
];

interface AttendingGuest {
  id: number;
  firstName: string;
  lastName: string;
  type: 'adult' | 'child';
  attending: boolean | null;
  entreeChoice: string | null;
  comments: string | null;
  householdId: number;
  householdName: string | null;
  isPlusOne: boolean;
}

interface NoResponseHousehold {
  id: number;
  name: string;
  inviteCode: string;
  allowPlusOne: boolean;
  reminderEmail: string | null;
  guestCount: number;
  respondedCount: number;
}

interface DashboardData {
  logs: RsvpLog[];
  attending: AttendingGuest[];
  declined: AttendingGuest[];
  noResponse: NoResponseHousehold[];
}

function LoginForm({ onSuccess }: { onSuccess: (session: AdminSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await login(username, password);
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid username or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.loginWrapper}>
      <div className={styles.loginOrnament} aria-hidden="true">
        &amp;
      </div>
      <h1 className={styles.loginTitle}>Admin</h1>
      <p className={styles.loginSubtitle}>Sign in to view the RSVP dashboard</p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <button className={styles.primaryBtn} type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function formatTimestamp(iso: string) {
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

interface SnapshotGuest {
  id?: number;
  firstName?: string;
  lastName?: string;
  attending?: boolean | null;
}

const ACTION_TAGS: Record<RsvpLog['action'], { label: string; className: string }> = {
  initial_rsvp: { label: 'Initial', className: styles.tagInitial },
  modification: { label: 'Modified', className: styles.tagModification },
  admin_edit: { label: 'Admin edit', className: styles.tagAdmin },
  admin_clear: { label: 'Admin clear', className: styles.tagAdmin },
};

interface SnapshotShape {
  guests?: SnapshotGuest[];
  plusOne?: { firstName?: string; lastName?: string; attending?: boolean } | null;
  reminderEmail?: string | null;
}

function summarizeSnapshot(
  snapshot: string,
  nameById: Map<number, string>
): { summary: string; names: string; pretty: string } {
  try {
    const parsed = JSON.parse(snapshot) as SnapshotShape;
    const guests = Array.isArray(parsed.guests) ? parsed.guests : [];
    const resolveName = (g: SnapshotGuest) =>
      g.firstName
        ? `${g.firstName} ${g.lastName ?? ''}`.trim()
        : (nameById.get(g.id ?? -1) ?? `Guest #${g.id}`);

    const attending = guests.filter((g) => g.attending === true);
    const declined = guests.filter((g) => g.attending === false);
    const parts: string[] = [];
    if (attending.length) parts.push(`${attending.length} attending`);
    if (declined.length) parts.push(`${declined.length} declined`);
    if (parsed.plusOne?.attending) {
      parts.push(`+1 ${`${parsed.plusOne.firstName ?? ''} ${parsed.plusOne.lastName ?? ''}`.trim() || 'guest'}`);
    } else if (parsed.plusOne && parsed.plusOne.attending === false) {
      parts.push('no +1');
    }
    if (parsed.reminderEmail) parts.push('reminder set');

    const nameParts: string[] = [];
    if (attending.length) nameParts.push(`Yes: ${attending.map(resolveName).join(', ')}`);
    if (declined.length) nameParts.push(`No: ${declined.map(resolveName).join(', ')}`);

    return {
      summary: parts.join(' · ') || 'No guest responses',
      names: nameParts.join('  ·  '),
      pretty: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return { summary: 'Unreadable snapshot', names: '', pretty: snapshot };
  }
}

function GuestTypeTag({ guest }: { guest: AttendingGuest }) {
  if (guest.isPlusOne) {
    return <span className={`${styles.tag} ${styles.tagPlusOne}`}>+1</span>;
  }
  return (
    <span className={`${styles.tag} ${guest.type === 'child' ? styles.tagChild : styles.tagAdult}`}>
      {guest.type}
    </span>
  );
}

function RsvpPageSettings({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await adminFetch<AdminSettings>('/api/admin/settings'));
      setError(null);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(codeLookupEnabled: boolean) {
    const previous = settings;
    setSettings({ codeLookupEnabled });
    setSaving(true);
    setError(null);
    try {
      await adminFetch('/api/admin/settings', jsonInit('PUT', { codeLookupEnabled }));
    } catch (err) {
      setSettings(previous);
      if (err instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>RSVP Page Settings</h2>
      <div className={styles.settingsCard}>
        {!settings && !error && <span className={styles.muted}>Loading…</span>}
        {settings && (
          <>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.codeLookupEnabled}
                disabled={saving}
                onChange={(e) => void handleToggle(e.target.checked)}
              />
              <span>Allow guests to find their invitation with an invite code</span>
            </label>
            <p className={styles.fieldHint}>
              When unchecked, the "Enter Code" option is removed from the RSVP page, making it so guests can
              only search by first and last name.
            </p>
          </>
        )}
        {error && (
          <div className={styles.error}>
            {error}
            {!settings && (
              <button className={styles.retryBtn} onClick={() => void load()}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DashboardView({
  user,
  onSignOut,
  onSessionExpired,
}: {
  user: { username: string };
  onSignOut: () => void;
  onSessionExpired: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<TabKey>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { entreeOptions } = useWeddingData();

  const fetchDashboard = useCallback(async (): Promise<DashboardData | null> => {
    const r = await fetch('/api/admin/dashboard', { credentials: 'include' });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as DashboardData;
  }, []);

  useEffect(() => {
    if (tab !== 'overview') return;
    let cancelled = false;
    fetchDashboard()
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          onSessionExpired();
          return;
        }
        setData(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Request failed');
      });
    return () => {
      cancelled = true;
    };
  }, [tab, fetchDashboard, onSessionExpired]);

  async function handleRefresh() {
    if (tab !== 'overview') {
      setRefreshKey((k) => k + 1);
      return;
    }
    setRefreshing(true);
    try {
      const result = await fetchDashboard();
      if (result === null) {
        onSessionExpired();
        return;
      }
      setData(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSignOut() {
    await logout();
    onSignOut();
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const r = await fetch('/api/admin/export', { credentials: 'include' });
      if (r.status === 401) {
        onSessionExpired();
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rsvp-export-${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const entreeLabels = useMemo(
    () => new Map(entreeOptions.map((o) => [o.value, o.label])),
    [entreeOptions]
  );

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    if (!data) return map;
    for (const g of [...data.attending, ...data.declined]) {
      if (!g.isPlusOne) map.set(g.id, `${g.firstName} ${g.lastName}`);
    }
    return map;
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    const adults = data.attending.filter((g) => !g.isPlusOne && g.type === 'adult').length;
    const children = data.attending.filter((g) => !g.isPlusOne && g.type === 'child').length;
    const plusOnes = data.attending.filter((g) => g.isPlusOne).length;
    const pendingGuests = data.noResponse.reduce(
      (n, h) => n + Math.max(0, h.guestCount - h.respondedCount),
      0
    );

    const mealCounts = new Map<string, number>();
    let noMeal = 0;
    for (const g of data.attending) {
      if (g.entreeChoice) {
        mealCounts.set(g.entreeChoice, (mealCounts.get(g.entreeChoice) ?? 0) + 1);
      } else {
        noMeal++;
      }
    }
    // list meals in the configured menu order, then any unknown values
    const meals: Array<{ label: string; count: number }> = [];
    for (const option of entreeOptions) {
      const count = mealCounts.get(option.value);
      if (count) {
        meals.push({ label: option.label, count });
        mealCounts.delete(option.value);
      }
    }
    for (const [value, count] of mealCounts) {
      meals.push({ label: value, count });
    }
    if (noMeal) meals.push({ label: 'No selection', count: noMeal });

    return { adults, children, plusOnes, pendingGuests, meals };
  }, [data, entreeOptions]);

  const query = filter.trim().toLowerCase();
  const matchesGuest = useCallback(
    (g: AttendingGuest) =>
      !query ||
      `${g.firstName} ${g.lastName}`.toLowerCase().includes(query) ||
      (g.householdName ?? '').toLowerCase().includes(query),
    [query]
  );

  const byHouseholdThenName = (a: AttendingGuest, b: AttendingGuest) =>
    (a.householdName ?? '').localeCompare(b.householdName ?? '') ||
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName);

  const attending = useMemo(
    () => (data ? [...data.attending].sort(byHouseholdThenName).filter(matchesGuest) : []),
    [data, matchesGuest]
  );
  const declined = useMemo(
    () => (data ? [...data.declined].sort(byHouseholdThenName).filter(matchesGuest) : []),
    [data, matchesGuest]
  );
  const noResponse = useMemo(
    () =>
      data
        ? data.noResponse.filter(
            (h) =>
              !query ||
              h.name.toLowerCase().includes(query) ||
              h.inviteCode.toLowerCase().includes(query)
          )
        : [],
    [data, query]
  );
  const logs = useMemo(
    () =>
      data
        ? data.logs.filter((log) => !query || (log.householdName ?? '').toLowerCase().includes(query))
        : [],
    [data, query]
  );

  const overviewBody = loadError ? (
    <div className={styles.error}>
      Failed to load dashboard: {loadError}
      <button className={styles.retryBtn} onClick={handleRefresh}>
        Retry
      </button>
    </div>
  ) : !data || !stats ? (
    <div className={styles.loading}>Loading…</div>
  ) : (
    <>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{data.attending.length}</span>
          <span className={styles.statLabel}>Attending</span>
          <span className={styles.statDetail}>
            {stats.adults} adult{stats.adults === 1 ? '' : 's'} · {stats.children} child
            {stats.children === 1 ? '' : 'ren'} · {stats.plusOnes} plus-one
            {stats.plusOnes === 1 ? '' : 's'}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{data.declined.length}</span>
          <span className={styles.statLabel}>Declined</span>
          <span className={styles.statDetail}>guests who can't make it</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{data.noResponse.length}</span>
          <span className={styles.statLabel}>Awaiting</span>
          <span className={styles.statDetail}>
            households · {stats.pendingGuests} guest{stats.pendingGuests === 1 ? '' : 's'} pending
          </span>
        </div>
        <div className={`${styles.statCard} ${styles.mealCard}`}>
          <span className={styles.statLabel}>Meal Counts</span>
          {stats.meals.length === 0 ? (
            <span className={styles.statDetail}>No meals selected yet</span>
          ) : (
            <ul className={styles.mealList}>
              {stats.meals.map((meal) => (
                <li key={meal.label} className={styles.mealRow}>
                  <span className={styles.mealLabel}>{meal.label}</span>
                  <span className={styles.mealCount}>{meal.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.filterInput}
          placeholder="Filter by guest, household, or invite code…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter dashboard tables"
        />
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Attending <span className={styles.countChip}>{attending.length}</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Household</th>
                <th scope="col">Type</th>
                <th scope="col">Entrée</th>
                <th scope="col">Comments</th>
              </tr>
            </thead>
            <tbody>
              {attending.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    {query ? 'No matches.' : 'No one yet.'}
                  </td>
                </tr>
              ) : (
                attending.map((g) => (
                  <tr key={`${g.isPlusOne ? 'p' : 'g'}-${g.id}`}>
                    <td className={styles.nameCell}>
                      {g.firstName} {g.lastName}
                    </td>
                    <td>{g.householdName ?? `#${g.householdId}`}</td>
                    <td>
                      <GuestTypeTag guest={g} />
                    </td>
                    <td>
                      {g.entreeChoice ? (
                        (entreeLabels.get(g.entreeChoice) ?? g.entreeChoice)
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.commentsCell}>
                      {g.comments || <span className={styles.muted}>—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Declined <span className={styles.countChip}>{declined.length}</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Household</th>
                <th scope="col">Type</th>
                <th scope="col">Comments</th>
              </tr>
            </thead>
            <tbody>
              {declined.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    {query ? 'No matches.' : 'No declines.'}
                  </td>
                </tr>
              ) : (
                declined.map((g) => (
                  <tr key={`${g.isPlusOne ? 'p' : 'g'}-${g.id}`}>
                    <td className={styles.nameCell}>
                      {g.firstName} {g.lastName}
                    </td>
                    <td>{g.householdName ?? `#${g.householdId}`}</td>
                    <td>
                      <GuestTypeTag guest={g} />
                    </td>
                    <td className={styles.commentsCell}>
                      {g.comments || <span className={styles.muted}>—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Awaiting Response <span className={styles.countChip}>{noResponse.length}</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Household</th>
                <th scope="col">Invite Code</th>
                <th scope="col">Responded</th>
                <th scope="col">+1 Allowed</th>
                <th scope="col">Reminder Email</th>
              </tr>
            </thead>
            <tbody>
              {noResponse.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    {query ? 'No matches.' : 'Everyone has responded. 🎉'}
                  </td>
                </tr>
              ) : (
                noResponse.map((h) => (
                  <tr key={h.id}>
                    <td className={styles.nameCell}>{h.name}</td>
                    <td>
                      <code className={styles.code}>{h.inviteCode}</code>
                    </td>
                    <td>
                      <span className={h.respondedCount > 0 ? styles.partial : undefined}>
                        {h.respondedCount} of {h.guestCount}
                      </span>
                    </td>
                    <td>{h.allowPlusOne ? 'Yes' : <span className={styles.muted}>No</span>}</td>
                    <td className={styles.commentsCell}>
                      {h.reminderEmail || <span className={styles.muted}>—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          RSVP Activity <span className={styles.countChip}>{logs.length}</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Household</th>
                <th scope="col">Action</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    {query ? 'No matches.' : 'No RSVPs submitted yet.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const { summary, names, pretty } = summarizeSnapshot(log.snapshot, nameById);
                  return (
                    <tr key={log.id}>
                      <td className={styles.timeCell}>{formatTimestamp(log.timestamp)}</td>
                      <td>{log.householdName ?? `#${log.householdId}`}</td>
                      <td>
                        <span
                          className={`${styles.tag} ${(ACTION_TAGS[log.action] ?? ACTION_TAGS.modification).className}`}
                        >
                          {(ACTION_TAGS[log.action] ?? ACTION_TAGS.modification).label}
                        </span>
                      </td>
                      <td className={styles.detailsCell}>
                        <div className={styles.logSummary}>{summary}</div>
                        {names && <div className={styles.logNames}>{names}</div>}
                        <details className={styles.logDetails}>
                          <summary>Raw snapshot</summary>
                          <pre className={styles.snapshot}>{pretty}</pre>
                        </details>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin Dashboard</h1>
          <p className={styles.userInfo}>
            Signed in as <strong>{user.username}</strong>
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.ghostBtn} onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button className={styles.ghostBtn} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className={styles.ghostBtn} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      {exportError && (
        <div className={`${styles.error} ${styles.exportError}`}>
          Export failed: {exportError}
          <button className={styles.retryBtn} onClick={handleExport}>
            Try again
          </button>
        </div>
      )}

      <div className={styles.tabs}>
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`${styles.tabBtn} ${tab === key ? styles.tabActive : ''}`}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <RsvpPageSettings onSessionExpired={onSessionExpired} />
          {overviewBody}
        </>
      )}
      {tab === 'households' && (
        <ManageHouseholds key={`households-${refreshKey}`} onSessionExpired={onSessionExpired} />
      )}
      {tab === 'rsvps' && (
        <ManageRsvps key={`rsvps-${refreshKey}`} onSessionExpired={onSessionExpired} />
      )}
      {tab === 'entrees' && (
        <ManageEntrees key={`entrees-${refreshKey}`} onSessionExpired={onSessionExpired} />
      )}
      {tab === 'schedule' && (
        <ManageSchedule key={`schedule-${refreshKey}`} onSessionExpired={onSessionExpired} />
      )}
      {tab === 'faqs' && (
        <ManageFaqs key={`faqs-${refreshKey}`} onSessionExpired={onSessionExpired} />
      )}
    </div>
  );
}

export function Dashboard() {
  const [session, setSession] = useState<AdminSession | null | undefined>(undefined);
  const clearSession = useCallback(() => setSession(null), []);

  useEffect(() => {
    getSession().then(setSession);
  }, []);

  if (session === undefined) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  if (session === null) {
    return <LoginForm onSuccess={setSession} />;
  }

  return (
    <DashboardView user={session.user} onSignOut={clearSession} onSessionExpired={clearSession} />
  );
}
