import { useEffect, useState, type FormEvent } from 'react';
import { getSession, login, logout, type AdminSession } from '../auth-client';
import styles from './Dashboard.module.css';

interface RsvpLog {
  id: number;
  householdId: number;
  householdName: string | null;
  action: 'initial_rsvp' | 'modification';
  timestamp: string;
  snapshot: string;
}

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
      <h1 className={styles.loginTitle}>Admin</h1>
      <p className={styles.loginSubtitle}>Sign in to view the dashboard</p>
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
        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function formatTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function DashboardView({
  user,
  onSignOut,
}: {
  user: { username: string };
  onSignOut: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/dashboard', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: DashboardData) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    await logout();
    onSignOut();
  }

  if (loadError) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.error}>Failed to load dashboard: {loadError}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1 className={styles.title}>RSVP Dashboard</h1>
        <div>
          <span className={styles.userInfo}>
            Signed in as <strong>{user.username}</strong>
          </span>
          <button className={styles.signOut} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          RSVP Logs
          <span className={styles.sectionMeta}>({data.logs.length})</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Household</th>
                <th>Action</th>
                <th>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    No RSVPs submitted yet.
                  </td>
                </tr>
              ) : (
                data.logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatTimestamp(log.timestamp)}</td>
                    <td>{log.householdName ?? `#${log.householdId}`}</td>
                    <td>
                      <span
                        className={`${styles.tag} ${
                          log.action === 'initial_rsvp' ? styles.tagInitial : styles.tagModification
                        }`}
                      >
                        {log.action === 'initial_rsvp' ? 'Initial' : 'Modified'}
                      </span>
                    </td>
                    <td>
                      <pre className={styles.snapshot}>{log.snapshot}</pre>
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
          Attending
          <span className={styles.sectionMeta}>({data.attending.length})</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Household</th>
                <th>Type</th>
                <th>Entrée</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {data.attending.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    No one yet.
                  </td>
                </tr>
              ) : (
                data.attending.map((g) => (
                  <tr key={`${g.isPlusOne ? 'p' : 'g'}-${g.id}`}>
                    <td>
                      {g.firstName} {g.lastName}
                    </td>
                    <td>{g.householdName ?? `#${g.householdId}`}</td>
                    <td>
                      {g.isPlusOne ? (
                        <span className={`${styles.tag} ${styles.tagPlusOne}`}>+1</span>
                      ) : (
                        <span
                          className={`${styles.tag} ${
                            g.type === 'child' ? styles.tagChild : styles.tagAdult
                          }`}
                        >
                          {g.type}
                        </span>
                      )}
                    </td>
                    <td>{g.entreeChoice ?? '—'}</td>
                    <td>{g.comments ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Declined
          <span className={styles.sectionMeta}>({data.declined.length})</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Household</th>
                <th>Type</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {data.declined.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    No declines.
                  </td>
                </tr>
              ) : (
                data.declined.map((g) => (
                  <tr key={`${g.isPlusOne ? 'p' : 'g'}-${g.id}`}>
                    <td>
                      {g.firstName} {g.lastName}
                    </td>
                    <td>{g.householdName ?? `#${g.householdId}`}</td>
                    <td>
                      {g.isPlusOne ? (
                        <span className={`${styles.tag} ${styles.tagPlusOne}`}>+1</span>
                      ) : (
                        <span
                          className={`${styles.tag} ${
                            g.type === 'child' ? styles.tagChild : styles.tagAdult
                          }`}
                        >
                          {g.type}
                        </span>
                      )}
                    </td>
                    <td>{g.comments ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          No Response
          <span className={styles.sectionMeta}>({data.noResponse.length} households)</span>
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Household</th>
                <th>Invite Code</th>
                <th>Guests</th>
                <th>+1 Allowed</th>
                <th>Reminder Email</th>
              </tr>
            </thead>
            <tbody>
              {data.noResponse.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    Everyone has responded.
                  </td>
                </tr>
              ) : (
                data.noResponse.map((h) => (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td>
                      <code>{h.inviteCode}</code>
                    </td>
                    <td>{h.guestCount}</td>
                    <td>{h.allowPlusOne ? 'Yes' : 'No'}</td>
                    <td>{h.reminderEmail ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function Dashboard() {
  const [session, setSession] = useState<AdminSession | null | undefined>(undefined);

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

  return <DashboardView user={session.user} onSignOut={() => setSession(null)} />;
}
