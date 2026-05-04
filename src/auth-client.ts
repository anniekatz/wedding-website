export interface AdminSession {
  user: { id: number; username: string };
}

export async function getSession(): Promise<AdminSession | null> {
  const r = await fetch('/api/admin/me', { credentials: 'include' });
  if (!r.ok) return null;
  return (await r.json()) as AdminSession;
}

export async function login(username: string, password: string): Promise<AdminSession> {
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? 'Invalid username or password');
  }
  return (await r.json()) as AdminSession;
}

export async function logout(): Promise<void> {
  await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
}
