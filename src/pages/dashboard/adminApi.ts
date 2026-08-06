export interface AdminGuest {
  id: number;
  householdId: number;
  firstName: string;
  lastName: string;
  nickname: string | null;
  email: string | null;
  type: 'adult' | 'child';
  attending: boolean | null;
  comments: string | null;
  entreeChoice: string | null;
}

export interface AdminPlusOne {
  id: number;
  householdId: number;
  firstName: string;
  lastName: string;
  attending: boolean;
  comments: string | null;
  entreeChoice: string | null;
}

export interface AdminHousehold {
  id: number;
  name: string;
  inviteCode: string;
  allowPlusOne: boolean;
  notes: string | null;
  reminderEmail: string | null;
  guests: AdminGuest[];
  plusOne: AdminPlusOne | null;
}

export interface AdminEntree {
  id: number;
  value: string;
  label: string;
  availableFor: 'adult' | 'child' | 'both';
  order: number;
}

export interface AdminScheduleEvent {
  id: number;
  name: string;
  time: string;
  endTime: string | null;
  location: string;
  description: string | null;
  order: number;
}

export interface AdminFaq {
  id: number;
  question: string;
  answer: string;
  imagePath: string | null;
  order: number;
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

export async function adminFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (res.status === 401) throw new SessionExpiredError();
  let body: unknown = null;
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    body = await res.json();
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function runWithSession(
  onSessionExpired: () => void,
  fn: () => Promise<unknown>
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      onSessionExpired();
      return false;
    }
    throw err;
  }
}

export function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

export type RsvpStatus = 'none' | 'partial' | 'responded';

export function householdRsvpStatus(h: AdminHousehold): RsvpStatus {
  const answered = h.guests.filter((g) => g.attending !== null).length;
  if (answered === 0 && !h.plusOne) return 'none';
  if (answered < h.guests.length) return 'partial';
  return 'responded';
}

export function householdHasRsvp(h: AdminHousehold): boolean {
  return householdRsvpStatus(h) !== 'none';
}
