import { Router, type Request, type Response } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
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
import { db, guests, households, rsvpLogs, plusOnes } from '../db/index.js';

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

export default router;
