import express, { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq, desc, inArray, sql } from 'drizzle-orm';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSessionToken,
  loginRateLimit,
  readSession,
  requireAdmin,
  sessionCookieOptions,
  verifyCredentials,
  type AdminRequest,
} from '../auth.js';
import {
  db,
  guests,
  households,
  rsvpLogs,
  plusOnes,
  faqs,
  entreeOptions,
  scheduleEvents,
  type EntreeOption,
} from '../db/index.js';
import {
  deleteUploadedFile,
  ensureUploadsDir,
  uploadsDir,
  uploadsFileFromPublicPath,
} from '../uploads.js';
import { isCodeLookupEnabled, setCodeLookupEnabled } from '../settings.js';

const router = Router();
const isProd = process.env.NODE_ENV === 'production';

router.post('/login', loginRateLimit, async (req: Request, res: Response) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  try {
    const user = await verifyCredentials(username, password);
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

    const token = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(isProd));
    return res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[admin] login failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const raw = getSessionToken(req);
    if (raw) await destroySession(raw);
    res.clearCookie(SESSION_COOKIE);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] logout failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ user: { id: session.userId, username: session.username } });
  } catch (err) {
    console.error('[admin] /me failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.use(requireAdmin);

router.get('/settings', async (_req: AdminRequest, res: Response) => {
  try {
    return res.json({ codeLookupEnabled: await isCodeLookupEnabled() });
  } catch (err) {
    console.error('[admin] settings query failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', async (req: AdminRequest, res: Response) => {
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (typeof raw.codeLookupEnabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid settings.' });
    }
    await setCodeLookupEnabled(raw.codeLookupEnabled);
    return res.json({ codeLookupEnabled: raw.codeLookupEnabled });
  } catch (err) {
    console.error('[admin] update settings failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/dashboard', async (_req: AdminRequest, res: Response) => {
  try {
    const noResponseQuery = db
      .select({
        id: households.id,
        name: households.name,
        inviteCode: households.inviteCode,
        allowPlusOne: households.allowPlusOne,
        reminderEmail: households.reminderEmail,
        guestCount: sql<number>`COUNT(${guests.id})`.as('guestCount'),
        respondedCount: sql<number>`SUM(CASE WHEN ${guests.attending} IS NOT NULL THEN 1 ELSE 0 END)`.as(
          'respondedCount'
        ),
      })
      .from(households)
      .leftJoin(guests, eq(guests.householdId, households.id))
      .groupBy(households.id)
      // some guests answered, some didn't
      .having(
        sql`SUM(CASE WHEN ${guests.attending} IS NOT NULL THEN 1 ELSE 0 END) < COUNT(${guests.id})`
      );

    const [logs, guestRows, plusOneRows, noResponse] = await Promise.all([
      db
        .select({
          id: rsvpLogs.id,
          householdId: rsvpLogs.householdId,
          householdName: households.name,
          action: rsvpLogs.action,
          timestamp: rsvpLogs.timestamp,
          snapshot: rsvpLogs.snapshot,
        })
        .from(rsvpLogs)
        .leftJoin(households, eq(rsvpLogs.householdId, households.id))
        .orderBy(desc(rsvpLogs.timestamp)),
      db
        .select({
          id: guests.id,
          firstName: guests.firstName,
          lastName: guests.lastName,
          type: guests.type,
          attending: guests.attending,
          entreeChoice: guests.entreeChoice,
          comments: guests.comments,
          householdId: guests.householdId,
          householdName: households.name,
        })
        .from(guests)
        .leftJoin(households, eq(guests.householdId, households.id)),
      db
        .select({
          id: plusOnes.id,
          firstName: plusOnes.firstName,
          lastName: plusOnes.lastName,
          attending: plusOnes.attending,
          entreeChoice: plusOnes.entreeChoice,
          comments: plusOnes.comments,
          householdId: plusOnes.householdId,
          householdName: households.name,
        })
        .from(plusOnes)
        .leftJoin(households, eq(plusOnes.householdId, households.id)),
      noResponseQuery,
    ]);

    const attending = [
      ...guestRows
        .filter((g) => g.attending === true)
        .map((g) => ({ ...g, isPlusOne: false })),
      ...plusOneRows
        .filter((p) => p.attending === true)
        .map((p) => ({ ...p, type: 'adult' as const, isPlusOne: true })),
    ];

    const declined = [
      ...guestRows
        .filter((g) => g.attending === false)
        .map((g) => ({ ...g, isPlusOne: false })),
      ...plusOneRows
        .filter((p) => p.attending === false)
        .map((p) => ({ ...p, type: 'adult' as const, isPlusOne: true })),
    ];

    return res.json({ logs, attending, declined, noResponse });
  } catch (err) {
    console.error('[admin] dashboard query failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

function csvField(value: string | null | undefined): string {
  let s = value ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

function timestampForFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// export rsvps as csv
router.get('/export', async (_req: AdminRequest, res: Response) => {
  try {
    const [allHouseholds, allGuests, allPlusOnes, entrees] = await Promise.all([
      db.query.households.findMany(),
      db.query.guests.findMany(),
      db.query.plusOnes.findMany(),
      db.query.entreeOptions.findMany(),
    ]);
    const entreeLabel = new Map(entrees.map((e) => [e.value, e.label]));
    const statusOf = (attending: boolean | null) =>
      attending === null ? 'No Response' : attending ? 'Attending' : 'Not Attending';

    const rows: string[][] = [
      [
        'Household',
        'Invite Code',
        'First Name',
        'Last Name',
        'Guest Type',
        'Status',
        'Entrée',
        'Comments',
        'Reminder Email',
      ],
    ];

    const sorted = [...allHouseholds].sort((a, b) => a.name.localeCompare(b.name));
    for (const h of sorted) {
      for (const g of allGuests.filter((g) => g.householdId === h.id)) {
        rows.push([
          h.name,
          h.inviteCode,
          g.firstName,
          g.lastName,
          g.type === 'child' ? 'Child' : 'Adult',
          statusOf(g.attending),
          g.entreeChoice ? (entreeLabel.get(g.entreeChoice) ?? g.entreeChoice) : '',
          g.comments ?? '',
          h.reminderEmail ?? '',
        ]);
      }
      const plusOne = allPlusOnes.find((p) => p.householdId === h.id);
      if (plusOne) {
        rows.push([
          h.name,
          h.inviteCode,
          plusOne.firstName,
          plusOne.lastName,
          'Plus One',
          statusOf(plusOne.attending),
          plusOne.entreeChoice ? (entreeLabel.get(plusOne.entreeChoice) ?? plusOne.entreeChoice) : '',
          plusOne.comments ?? '',
          h.reminderEmail ?? '',
        ]);
      }
    }

    const csv = rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="rsvp-export-${timestampForFilename(new Date())}.csv"`
    );
    return res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('[admin] export failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const MAX_NAME_LENGTH = 100;
const MAX_CODE_LENGTH = 32;
const MAX_NOTES_LENGTH = 500;
const MAX_COMMENTS_LENGTH = 500;
const MAX_EMAIL_LENGTH = 254;
const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 4000;

const INVALID = Symbol('invalid');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalString(value: unknown, maxLength: number): string | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) return INVALID;
  return value;
}

function requiredString(value: unknown, maxLength: number): string | typeof INVALID {
  const parsed = optionalString(value, maxLength);
  if (parsed === INVALID || !parsed || !parsed.trim()) return INVALID;
  return parsed.trim();
}

function isValidEntree(entrees: EntreeOption[], value: string, guestType: 'adult' | 'child') {
  const option = entrees.find((e) => e.value === value);
  return !!option && (option.availableFor === 'both' || option.availableFor === guestType);
}

interface GuestInput {
  firstName: string;
  lastName: string;
  nickname: string | null;
  email: string | null;
  type: 'adult' | 'child';
}

function parseGuestInput(value: unknown): GuestInput | typeof INVALID {
  if (!value || typeof value !== 'object') return INVALID;
  const raw = value as Record<string, unknown>;
  const firstName = requiredString(raw.firstName, MAX_NAME_LENGTH);
  const lastName = requiredString(raw.lastName, MAX_NAME_LENGTH);
  const nickname = optionalString(raw.nickname, MAX_NAME_LENGTH);
  const email = optionalString(raw.email, MAX_EMAIL_LENGTH);
  if (firstName === INVALID || lastName === INVALID || nickname === INVALID || email === INVALID) {
    return INVALID;
  }
  if (raw.type !== undefined && raw.type !== 'adult' && raw.type !== 'child') return INVALID;
  const trimmedEmail = email?.trim() || null;
  if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) return INVALID;
  return {
    firstName,
    lastName,
    nickname: nickname?.trim() || null,
    email: trimmedEmail,
    type: (raw.type as 'adult' | 'child' | undefined) ?? 'adult',
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

async function inviteCodeTaken(code: string, excludeHouseholdId?: number) {
  const match = await db.query.households.findFirst({
    where: sql`upper(${households.inviteCode}) = ${code.toUpperCase()}`,
  });
  return !!match && match.id !== excludeHouseholdId;
}

async function generateInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const bytes = randomBytes(6);
    let code = '';
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!(await inviteCodeTaken(code))) return code;
  }
  throw new Error('Could not generate a unique invite code');
}

router.get('/households', async (_req: AdminRequest, res: Response) => {
  try {
    const [allHouseholds, allGuests, allPlusOnes] = await Promise.all([
      db.query.households.findMany(),
      db.query.guests.findMany(),
      db.query.plusOnes.findMany(),
    ]);
    const guestsByHousehold = new Map<number, typeof allGuests>();
    for (const g of allGuests) {
      const list = guestsByHousehold.get(g.householdId);
      if (list) list.push(g);
      else guestsByHousehold.set(g.householdId, [g]);
    }
    const plusOneByHousehold = new Map(allPlusOnes.map((p) => [p.householdId, p]));
    const payload = [...allHouseholds]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((h) => ({
        ...h,
        guests: guestsByHousehold.get(h.id) ?? [],
        plusOne: plusOneByHousehold.get(h.id) ?? null,
      }));
    return res.json(payload);
  } catch (err) {
    console.error('[admin] households query failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/households', async (req: AdminRequest, res: Response) => {
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const name = requiredString(raw.name, MAX_NAME_LENGTH);
    if (name === INVALID) return res.status(400).json({ error: 'Household name is required.' });
    const rawCode = optionalString(raw.inviteCode, MAX_CODE_LENGTH);
    const notes = optionalString(raw.notes, MAX_NOTES_LENGTH);
    if (rawCode === INVALID || notes === INVALID) {
      return res.status(400).json({ error: 'Invalid household details.' });
    }
    if (raw.allowPlusOne !== undefined && typeof raw.allowPlusOne !== 'boolean') {
      return res.status(400).json({ error: 'Invalid household details.' });
    }
    const allowPlusOne = raw.allowPlusOne === true;

    const guestInputs: GuestInput[] = [];
    if (raw.guests !== undefined) {
      if (!Array.isArray(raw.guests)) return res.status(400).json({ error: 'Invalid guest list.' });
      for (const entry of raw.guests) {
        const parsed = parseGuestInput(entry);
        if (parsed === INVALID) {
          return res.status(400).json({ error: 'Each guest needs a valid first and last name.' });
        }
        guestInputs.push(parsed);
      }
    }

    let inviteCode = rawCode?.trim() || null;
    if (inviteCode) {
      if (await inviteCodeTaken(inviteCode)) {
        return res.status(409).json({ error: 'That invite code is already in use.' });
      }
    } else {
      inviteCode = await generateInviteCode();
    }

    const created = db.transaction((tx) => {
      const household = tx
        .insert(households)
        .values({ name, inviteCode: inviteCode!, allowPlusOne, notes: notes?.trim() || null })
        .returning()
        .get();
      for (const guest of guestInputs) {
        tx.insert(guests).values({ householdId: household.id, ...guest }).run();
      }
      return household;
    });
    return res.status(201).json({ id: created.id });
  } catch (err) {
    console.error('[admin] create household failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/households/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid household id' });
    const household = await db.query.households.findFirst({ where: eq(households.id, id) });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const name = requiredString(raw.name, MAX_NAME_LENGTH);
    if (name === INVALID) return res.status(400).json({ error: 'Household name is required.' });
    const inviteCode = requiredString(raw.inviteCode, MAX_CODE_LENGTH);
    if (inviteCode === INVALID) return res.status(400).json({ error: 'Invite code is required.' });
    const notes = optionalString(raw.notes, MAX_NOTES_LENGTH);
    const reminderEmail = optionalString(raw.reminderEmail, MAX_EMAIL_LENGTH);
    if (notes === INVALID || reminderEmail === INVALID || typeof raw.allowPlusOne !== 'boolean') {
      return res.status(400).json({ error: 'Invalid household details.' });
    }
    const allowPlusOne = raw.allowPlusOne;
    const trimmedEmail = reminderEmail?.trim() || null;
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid reminder email address.' });
    }
    if (await inviteCodeTaken(inviteCode, id)) {
      return res.status(409).json({ error: 'That invite code is already in use.' });
    }

    db.transaction((tx) => {
      tx.update(households)
        .set({
          name,
          inviteCode,
          allowPlusOne,
          notes: notes?.trim() || null,
          reminderEmail: trimmedEmail,
        })
        .where(eq(households.id, id))
        .run();
      if (!allowPlusOne) {
        tx.delete(plusOnes).where(eq(plusOnes.householdId, id)).run();
      }
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] update household failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/households/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid household id' });
    const household = await db.query.households.findFirst({ where: eq(households.id, id) });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    db.transaction((tx) => {
      tx.delete(plusOnes).where(eq(plusOnes.householdId, id)).run();
      tx.delete(rsvpLogs).where(eq(rsvpLogs.householdId, id)).run();
      tx.delete(guests).where(eq(guests.householdId, id)).run();
      tx.delete(households).where(eq(households.id, id)).run();
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] delete household failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/households/:id/guests', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid household id' });
    const household = await db.query.households.findFirst({ where: eq(households.id, id) });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const parsed = parseGuestInput(req.body);
    if (parsed === INVALID) {
      return res.status(400).json({ error: 'A valid first and last name are required.' });
    }
    const [created] = await db.insert(guests).values({ householdId: id, ...parsed }).returning();
    return res.status(201).json(created);
  } catch (err) {
    console.error('[admin] add guest failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/guests/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid guest id' });
    const guest = await db.query.guests.findFirst({ where: eq(guests.id, id) });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    const parsed = parseGuestInput(req.body);
    if (parsed === INVALID) {
      return res.status(400).json({ error: 'A valid first and last name are required.' });
    }
    await db
      .update(guests)
      .set({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        nickname: parsed.nickname,
        email: parsed.email,
        type: parsed.type,
      })
      .where(eq(guests.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] update guest failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/guests/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid guest id' });
    const guest = await db.query.guests.findFirst({ where: eq(guests.id, id) });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    await db.delete(guests).where(eq(guests.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] delete guest failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/households/:id/rsvp', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid household id' });
    const household = await db.query.households.findFirst({ where: eq(households.id, id) });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(raw.guests)) {
      return res.status(400).json({ error: 'Invalid reservation submission' });
    }

    const existingGuests = await db.query.guests.findMany({ where: eq(guests.householdId, id) });
    const guestById = new Map(existingGuests.map((g) => [g.id, g]));
    const entrees = await db.query.entreeOptions.findMany();

    const validatedGuests: Array<{
      id: number;
      attending: boolean | null;
      comments: string | null;
      entreeChoice: string | null;
    }> = [];
    for (const entry of raw.guests) {
      if (!entry || typeof entry !== 'object') {
        return res.status(400).json({ error: 'Invalid reservation submission' });
      }
      const e = entry as Record<string, unknown>;
      if (!Number.isInteger(e.id)) {
        return res.status(400).json({ error: 'Invalid reservation submission' });
      }
      const guest = guestById.get(e.id as number);
      if (!guest) {
        return res.status(400).json({ error: 'Guest does not belong to this household.' });
      }
      if (e.attending !== null && typeof e.attending !== 'boolean') {
        return res.status(400).json({ error: 'Invalid reservation submission' });
      }
      const attending = e.attending as boolean | null;
      const comments = optionalString(e.comments, MAX_COMMENTS_LENGTH);
      const entreeChoice = optionalString(e.entreeChoice, MAX_NAME_LENGTH);
      if (comments === INVALID || entreeChoice === INVALID) {
        return res.status(400).json({ error: 'Invalid reservation submission' });
      }
      const entree = entreeChoice?.trim() || null;
      if (attending === true && entree && !isValidEntree(entrees, entree, guest.type)) {
        return res.status(400).json({ error: `Invalid entrée selection for ${guest.firstName}.` });
      }
      validatedGuests.push({
        id: guest.id,
        attending,
        comments: comments?.trim() || null,
        entreeChoice: attending === true ? entree : null,
      });
    }

    const existingPlusOne = await db.query.plusOnes.findFirst({
      where: eq(plusOnes.householdId, id),
    });
    type PlusOneValue = {
      firstName: string;
      lastName: string;
      attending: boolean;
      comments: string | null;
      entreeChoice: string | null;
    };
    let plusOneAction:
      | { kind: 'none' }
      | { kind: 'remove' }
      | { kind: 'save'; value: PlusOneValue } = { kind: 'none' };
    if (household.allowPlusOne && raw.plusOne !== undefined) {
      if (raw.plusOne === null) {
        plusOneAction = { kind: 'remove' };
      } else if (typeof raw.plusOne === 'object') {
        const p = raw.plusOne as Record<string, unknown>;
        if (typeof p.attending !== 'boolean') {
          return res.status(400).json({ error: 'Invalid reservation submission' });
        }
        const first = optionalString(p.firstName, MAX_NAME_LENGTH);
        const last = optionalString(p.lastName, MAX_NAME_LENGTH);
        const comments = optionalString(p.comments, MAX_COMMENTS_LENGTH);
        const entreeChoice = optionalString(p.entreeChoice, MAX_NAME_LENGTH);
        if (first === INVALID || last === INVALID || comments === INVALID || entreeChoice === INVALID) {
          return res.status(400).json({ error: 'Invalid reservation submission' });
        }
        let firstName = first?.trim() ?? '';
        let lastName = last?.trim() ?? '';
        if (p.attending && !firstName && !lastName) {
          firstName = household.name;
          lastName = '+ 1';
        }
        if (p.attending && (!firstName || !lastName)) {
          return res.status(400).json({
            error: `Please fill in both first and last name for the plus one, or leave both blank to use "${household.name} + 1".`,
          });
        }
        const entree = entreeChoice?.trim() || null;
        if (p.attending && entree && !isValidEntree(entrees, entree, 'adult')) {
          return res.status(400).json({ error: 'Invalid entrée selection for the plus one.' });
        }
        plusOneAction = {
          kind: 'save',
          value: {
            firstName,
            lastName,
            attending: p.attending,
            comments: comments?.trim() || null,
            entreeChoice: p.attending ? entree : null,
          },
        };
      } else {
        return res.status(400).json({ error: 'Invalid reservation submission' });
      }
    }

    const snapshot = JSON.stringify({
      guests: validatedGuests.map((g) => ({
        ...g,
        firstName: guestById.get(g.id)?.firstName,
        lastName: guestById.get(g.id)?.lastName,
      })),
      plusOne: plusOneAction.kind === 'save' ? plusOneAction.value : null,
      editedBy: req.admin?.username ?? 'admin',
    });

    db.transaction((tx) => {
      for (const g of validatedGuests) {
        tx.update(guests)
          .set({ attending: g.attending, comments: g.comments, entreeChoice: g.entreeChoice })
          .where(eq(guests.id, g.id))
          .run();
      }
      if (plusOneAction.kind === 'remove') {
        tx.delete(plusOnes).where(eq(plusOnes.householdId, id)).run();
      } else if (plusOneAction.kind === 'save') {
        if (existingPlusOne) {
          tx.update(plusOnes).set(plusOneAction.value).where(eq(plusOnes.householdId, id)).run();
        } else if (plusOneAction.value.attending) {
          tx.insert(plusOnes).values({ householdId: id, ...plusOneAction.value }).run();
        }
      }
      tx.insert(rsvpLogs)
        .values({ householdId: id, action: 'admin_edit', timestamp: new Date().toISOString(), snapshot })
        .run();
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] save reservation failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/households/:id/rsvp', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid household id' });
    const household = await db.query.households.findFirst({ where: eq(households.id, id) });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const householdGuests = await db.query.guests.findMany({ where: eq(guests.householdId, id) });
    const snapshot = JSON.stringify({
      cleared: true,
      guests: householdGuests.map((g) => ({
        id: g.id,
        firstName: g.firstName,
        lastName: g.lastName,
        attending: null,
      })),
      plusOne: null,
      editedBy: req.admin?.username ?? 'admin',
    });

    db.transaction((tx) => {
      tx.update(guests)
        .set({ attending: null, comments: null, entreeChoice: null })
        .where(eq(guests.householdId, id))
        .run();
      tx.delete(plusOnes).where(eq(plusOnes.householdId, id)).run();
      tx.insert(rsvpLogs)
        .values({ householdId: id, action: 'admin_clear', timestamp: new Date().toISOString(), snapshot })
        .run();
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] clear reservation failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/faqs', async (req: AdminRequest, res: Response) => {
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const question = requiredString(raw.question, MAX_QUESTION_LENGTH);
    if (question === INVALID) return res.status(400).json({ error: 'Question is required.' });
    const answer = requiredString(raw.answer, MAX_ANSWER_LENGTH);
    if (answer === INVALID) return res.status(400).json({ error: 'Answer is required.' });
    const imagePath = optionalString(raw.imagePath, 300);
    if (imagePath === INVALID || (imagePath && !uploadsFileFromPublicPath(imagePath))) {
      return res.status(400).json({ error: 'Invalid image reference.' });
    }

    let order: number;
    if (raw.order === undefined || raw.order === null) {
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX("order"), 0)` })
        .from(faqs);
      order = maxOrder + 1;
    } else if (typeof raw.order === 'number' && Number.isInteger(raw.order)) {
      order = raw.order;
    } else {
      return res.status(400).json({ error: 'Order must be a whole number.' });
    }

    const [created] = await db
      .insert(faqs)
      .values({ question, answer, imagePath: imagePath || null, order })
      .returning();
    return res.status(201).json(created);
  } catch (err) {
    console.error('[admin] create faq failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/faqs/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid FAQ id' });
    const existing = await db.query.faqs.findFirst({ where: eq(faqs.id, id) });
    if (!existing) return res.status(404).json({ error: 'FAQ not found' });

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const question = requiredString(raw.question, MAX_QUESTION_LENGTH);
    if (question === INVALID) return res.status(400).json({ error: 'Question is required.' });
    const answer = requiredString(raw.answer, MAX_ANSWER_LENGTH);
    if (answer === INVALID) return res.status(400).json({ error: 'Answer is required.' });
    const imagePath = optionalString(raw.imagePath, 300);
    if (imagePath === INVALID || (imagePath && !uploadsFileFromPublicPath(imagePath))) {
      return res.status(400).json({ error: 'Invalid image reference.' });
    }
    let order = existing.order;
    if (raw.order !== undefined && raw.order !== null) {
      if (typeof raw.order !== 'number' || !Number.isInteger(raw.order)) {
        return res.status(400).json({ error: 'Order must be a whole number.' });
      }
      order = raw.order;
    }

    const nextImage = imagePath || null;
    if (existing.imagePath && existing.imagePath !== nextImage) {
      deleteUploadedFile(existing.imagePath);
    }
    await db
      .update(faqs)
      .set({ question, answer, imagePath: nextImage, order })
      .where(eq(faqs.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] update faq failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/faqs/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid FAQ id' });
    const existing = await db.query.faqs.findFirst({ where: eq(faqs.id, id) });
    if (!existing) return res.status(404).json({ error: 'FAQ not found' });

    await db.delete(faqs).where(eq(faqs.id, id));
    deleteUploadedFile(existing.imagePath);
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] delete faq failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const MAX_LOCATION_LENGTH = 200;
const MAX_EVENT_DESCRIPTION_LENGTH = 500;
const EVENT_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// schedule times iso stirngs
function parseEventTime(value: unknown): string | null | typeof INVALID {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.trim();
  if (!EVENT_TIME_RE.test(trimmed)) return INVALID;
  const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  if (Number.isNaN(new Date(normalized).getTime())) return INVALID;
  return normalized;
}

interface ScheduleEventInput {
  name: string;
  location: string;
  time: string;
  endTime: string | null;
  description: string | null;
}

function parseScheduleEventInput(value: unknown): ScheduleEventInput | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'Invalid event details.' };
  const raw = value as Record<string, unknown>;
  const name = requiredString(raw.name, MAX_NAME_LENGTH);
  if (name === INVALID) return { error: 'Event name is required.' };
  const location = requiredString(raw.location, MAX_LOCATION_LENGTH);
  if (location === INVALID) return { error: 'Location is required.' };
  const time = parseEventTime(raw.time);
  if (time === INVALID || time === null) {
    return { error: 'A valid start time is required (date and time).' };
  }
  const endTime = parseEventTime(raw.endTime);
  if (endTime === INVALID) return { error: 'Invalid end time.' };
  if (endTime && endTime <= time) return { error: 'End time must be after the start time.' };
  const description = optionalString(raw.description, MAX_EVENT_DESCRIPTION_LENGTH);
  if (description === INVALID) return { error: 'Invalid event details.' };
  return { name, location, time, endTime, description: description?.trim() || null };
}

router.post('/schedule', async (req: AdminRequest, res: Response) => {
  try {
    const parsed = parseScheduleEventInput(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const raw = (req.body ?? {}) as Record<string, unknown>;
    let order: number;
    if (raw.order === undefined || raw.order === null) {
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX("order"), 0)` })
        .from(scheduleEvents);
      order = maxOrder + 1;
    } else if (typeof raw.order === 'number' && Number.isInteger(raw.order)) {
      order = raw.order;
    } else {
      return res.status(400).json({ error: 'Order must be a whole number.' });
    }

    const [created] = await db
      .insert(scheduleEvents)
      .values({ ...parsed, order })
      .returning();
    return res.status(201).json(created);
  } catch (err) {
    console.error('[admin] create schedule event failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/schedule/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid event id' });
    const existing = await db.query.scheduleEvents.findFirst({ where: eq(scheduleEvents.id, id) });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    const parsed = parseScheduleEventInput(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const raw = (req.body ?? {}) as Record<string, unknown>;
    let order = existing.order;
    if (raw.order !== undefined && raw.order !== null) {
      if (typeof raw.order !== 'number' || !Number.isInteger(raw.order)) {
        return res.status(400).json({ error: 'Order must be a whole number.' });
      }
      order = raw.order;
    }

    await db
      .update(scheduleEvents)
      .set({ ...parsed, order })
      .where(eq(scheduleEvents.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] update schedule event failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/schedule/:id', async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid event id' });
    const existing = await db.query.scheduleEvents.findFirst({ where: eq(scheduleEvents.id, id) });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    await db.delete(scheduleEvents).where(eq(scheduleEvents.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] delete schedule event failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const ENTREE_VALUE_RE = /^[a-z0-9]{1,64}$/;

class StaleEntreeSelectionError extends Error {}

router.get('/entrees', async (_req: AdminRequest, res: Response) => {
  try {
    const entrees = await db.query.entreeOptions.findMany({
      orderBy: [asc(entreeOptions.order)],
    });
    return res.json(entrees);
  } catch (err) {
    console.error('[admin] entrees query failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/entrees', async (req: AdminRequest, res: Response) => {
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (
      !Array.isArray(raw.additions) ||
      !Array.isArray(raw.removals) ||
      !Array.isArray(raw.reassignments)
    ) {
      return res.status(400).json({ error: 'Invalid entree update.' });
    }

    const additions: Array<{ value: string; label: string; availableFor: 'adult' | 'child' | 'both' }> = [];
    for (const entry of raw.additions) {
      if (!entry || typeof entry !== 'object') {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      const e = entry as Record<string, unknown>;
      const label = requiredString(e.label, MAX_NAME_LENGTH);
      if (label === INVALID) return res.status(400).json({ error: 'Each new entree needs a name.' });
      if (typeof e.value !== 'string' || !ENTREE_VALUE_RE.test(e.value)) {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      if (e.availableFor !== 'adult' && e.availableFor !== 'child' && e.availableFor !== 'both') {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      additions.push({
        value: e.value,
        label,
        availableFor: e.availableFor as 'adult' | 'child' | 'both',
      });
    }

    const removalIds = new Set<number>();
    for (const entry of raw.removals) {
      if (!Number.isInteger(entry) || (entry as number) <= 0) {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      removalIds.add(entry as number);
    }

    if (additions.length === 0 && removalIds.size === 0) {
      return res.status(400).json({ error: 'Nothing to save.' });
    }

    const guestReassign = new Map<number, string>();
    const plusOneReassign = new Map<number, string>();
    for (const entry of raw.reassignments) {
      if (!entry || typeof entry !== 'object') {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      const e = entry as Record<string, unknown>;
      const choice = requiredString(e.entreeChoice, MAX_NAME_LENGTH);
      if ((e.kind !== 'guest' && e.kind !== 'plusOne') || !Number.isInteger(e.id) || choice === INVALID) {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      const map = e.kind === 'guest' ? guestReassign : plusOneReassign;
      if (map.has(e.id as number)) {
        return res.status(400).json({ error: 'Invalid entree update.' });
      }
      map.set(e.id as number, choice);
    }

    const current = await db.query.entreeOptions.findMany();
    const currentById = new Map(current.map((e) => [e.id, e]));
    for (const id of removalIds) {
      if (!currentById.has(id)) {
        return res
          .status(409)
          .json({ error: 'One of the removed entrees no longer exists. Refresh and try again.' });
      }
    }

    const remaining = current.filter((e) => !removalIds.has(e.id));
    const takenValues = new Set(remaining.map((e) => e.value.toLowerCase()));
    for (const a of additions) {
      if (takenValues.has(a.value.toLowerCase())) {
        return res.status(409).json({ error: `An entree named "${a.label}" already exists.` });
      }
      takenValues.add(a.value.toLowerCase());
    }

    const removedValues = new Set(current.filter((e) => removalIds.has(e.id)).map((e) => e.value));

    const optionByValue = new Map<string, { availableFor: 'adult' | 'child' | 'both' }>();
    for (const e of remaining) optionByValue.set(e.value, e);
    for (const a of additions) optionByValue.set(a.value, a);
    const allowedFor = (value: string, type: 'adult' | 'child') => {
      const option = optionByValue.get(value);
      return !!option && (option.availableFor === 'both' || option.availableFor === type);
    };

    const [allGuests, allPlusOnes] = await Promise.all([
      db.query.guests.findMany(),
      db.query.plusOnes.findMany(),
    ]);
    const affectedGuests = allGuests.filter((g) => g.entreeChoice && removedValues.has(g.entreeChoice));
    const affectedPlusOnes = allPlusOnes.filter(
      (p) => p.entreeChoice && removedValues.has(p.entreeChoice)
    );

    const affectedGuestIds = new Set(affectedGuests.map((g) => g.id));
    const affectedPlusOneIds = new Set(affectedPlusOnes.map((p) => p.id));
    for (const id of guestReassign.keys()) {
      if (!affectedGuestIds.has(id)) return res.status(400).json({ error: 'Invalid entree update.' });
    }
    for (const id of plusOneReassign.keys()) {
      if (!affectedPlusOneIds.has(id)) return res.status(400).json({ error: 'Invalid entree update.' });
    }

    const missing: string[] = [];
    for (const g of affectedGuests) {
      const choice = guestReassign.get(g.id);
      if (!choice) {
        missing.push(`${g.firstName} ${g.lastName}`);
      } else if (!allowedFor(choice, g.type)) {
        return res
          .status(400)
          .json({ error: `Invalid replacement entree for ${g.firstName} ${g.lastName}.` });
      }
    }
    for (const p of affectedPlusOnes) {
      const choice = plusOneReassign.get(p.id);
      if (!choice) {
        missing.push(`${p.firstName} ${p.lastName} (plus one)`);
      } else if (!allowedFor(choice, 'adult')) {
        return res
          .status(400)
          .json({ error: `Invalid replacement entree for ${p.firstName} ${p.lastName}.` });
      }
    }
    if (missing.length > 0) {
      return res
        .status(409)
        .json({ error: `A replacement entree is still needed for: ${missing.join(', ')}.` });
    }

    let nextOrder = remaining.reduce((max, e) => Math.max(max, e.order), 0);

    db.transaction((tx) => {
      for (const [guestId, choice] of guestReassign) {
        tx.update(guests).set({ entreeChoice: choice }).where(eq(guests.id, guestId)).run();
      }
      for (const [plusOneId, choice] of plusOneReassign) {
        tx.update(plusOnes).set({ entreeChoice: choice }).where(eq(plusOnes.id, plusOneId)).run();
      }
      if (removalIds.size > 0) {
        tx.delete(entreeOptions).where(inArray(entreeOptions.id, [...removalIds])).run();
      }
      for (const a of additions) {
        nextOrder += 1;
        tx.insert(entreeOptions).values({ ...a, order: nextOrder }).run();
      }
      if (removedValues.size > 0) {
        const values = [...removedValues];
        const stillSelected =
          (tx
            .select({ n: sql<number>`COUNT(*)` })
            .from(guests)
            .where(inArray(guests.entreeChoice, values))
            .get()?.n ?? 0) +
          (tx
            .select({ n: sql<number>`COUNT(*)` })
            .from(plusOnes)
            .where(inArray(plusOnes.entreeChoice, values))
            .get()?.n ?? 0);
        if (stillSelected > 0) throw new StaleEntreeSelectionError();
      }
    });
    return res.json({ success: true });
  } catch (err) {
    if (err instanceof StaleEntreeSelectionError) {
      return res.status(409).json({
        error: 'A guest just submitted an RSVP with one of the removed entrees. Refresh and try again.',
      });
    }
    console.error('[admin] update entrees failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

router.post(
  '/uploads',
  express.raw({ type: 'image/*', limit: '15mb' }),
  async (req: AdminRequest, res: Response) => {
    try {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const ext = IMAGE_EXTENSIONS[contentType];
      if (!ext) {
        return res.status(415).json({ error: 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'No image data received.' });
      }
      ensureUploadsDir();
      const name = `faq-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
      await fs.promises.writeFile(path.join(uploadsDir, name), req.body);
      return res.status(201).json({ path: `/uploads/${name}` });
    } catch (err) {
      console.error('[admin] upload failed:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;
