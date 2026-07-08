import { Router } from 'express';
import { db, guests, plusOnes, households, rsvpLogs, type EntreeOption, type Guest } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { getRsvpSettings, isRsvpLocked } from '../config.js';

const router = Router();

// rsvp settings - get lock status, cutoff date
router.get('/settings', (_req, res) => {
  res.json(getRsvpSettings());
});

interface GuestRsvp {
  id: number;
  attending: boolean;
  comments?: string;
  entreeChoice?: string;
}

interface PlusOneRsvp {
  firstName: string;
  lastName: string;
  attending: boolean;
  comments?: string;
  entreeChoice?: string;
}

interface RsvpRequest {
  householdId: number;
  guests: GuestRsvp[];
  plusOne?: PlusOneRsvp;
  reminderEmail?: string | null;
}

const MAX_NAME_LENGTH = 100;
const MAX_COMMENTS_LENGTH = 500;
const MAX_EMAIL_LENGTH = 254;

const INVALID = Symbol('invalid');

// absent counts as null
function optionalString(value: unknown, maxLength: number): string | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) return INVALID;
  return value;
}

function isValidEntree(entrees: EntreeOption[], value: string, guestType: 'adult' | 'child') {
  const option = entrees.find((e) => e.value === value);
  return !!option && (option.availableFor === 'both' || option.availableFor === guestType);
}

// submit or update RSVP
router.post('/', async (req, res) => {
  try {
    if (isRsvpLocked()) {
      return res.status(403).json({
        error: 'RSVPs are now closed. You can no longer modify your reservation.',
      });
    }

    const body = (req.body ?? {}) as Partial<RsvpRequest>;
    const { householdId, guests: guestRsvps, plusOne, reminderEmail } = body;

    if (!Number.isInteger(householdId)) {
      return res.status(400).json({ error: 'Invalid household id' });
    }
    if (!Array.isArray(guestRsvps)) {
      return res.status(400).json({ error: 'Invalid RSVP submission' });
    }

    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId as number),
    });

    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const existingGuests = await db.query.guests.findMany({
      where: eq(guests.householdId, household.id),
    });
    const guestById = new Map<number, Guest>(existingGuests.map((g) => [g.id, g]));
    const entrees = await db.query.entreeOptions.findMany();

    // validate pre-write
    const validatedGuests: Array<{
      id: number;
      attending: boolean;
      comments: string | null;
      entreeChoice: string | null;
    }> = [];
    for (const entry of guestRsvps) {
      if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.id) || typeof entry.attending !== 'boolean') {
        return res.status(400).json({ error: 'Invalid RSVP submission' });
      }
      const guest = guestById.get(entry.id);
      if (!guest) {
        return res.status(400).json({ error: 'Invalid RSVP submission' });
      }
      const comments = optionalString(entry.comments, MAX_COMMENTS_LENGTH);
      const entreeChoice = optionalString(entry.entreeChoice, MAX_NAME_LENGTH);
      if (comments === INVALID || entreeChoice === INVALID) {
        return res.status(400).json({ error: 'Invalid RSVP submission' });
      }
      if (entry.attending && entreeChoice && !isValidEntree(entrees, entreeChoice, guest.type)) {
        return res.status(400).json({ error: `Invalid entrée selection for ${guest.firstName}.` });
      }
      validatedGuests.push({
        id: guest.id,
        attending: entry.attending,
        comments: comments?.trim() || null,
        entreeChoice: entry.attending ? entreeChoice || null : null,
      });
    }

    // validate plus one if allowed
    let validatedPlusOne:
      | { firstName: string; lastName: string; attending: boolean; comments: string | null; entreeChoice: string | null }
      | null = null;
    if (household.allowPlusOne && plusOne !== undefined && plusOne !== null) {
      if (typeof plusOne !== 'object' || typeof plusOne.attending !== 'boolean') {
        return res.status(400).json({ error: 'Invalid RSVP submission' });
      }
      const rawFirst = optionalString(plusOne.firstName, MAX_NAME_LENGTH);
      const rawLast = optionalString(plusOne.lastName, MAX_NAME_LENGTH);
      const comments = optionalString(plusOne.comments, MAX_COMMENTS_LENGTH);
      const entreeChoice = optionalString(plusOne.entreeChoice, MAX_NAME_LENGTH);
      if (rawFirst === INVALID || rawLast === INVALID || comments === INVALID || entreeChoice === INVALID) {
        return res.status(400).json({ error: 'Invalid RSVP submission' });
      }
      const firstName = rawFirst?.trim();
      const lastName = rawLast?.trim();
      if (plusOne.attending && (!firstName || !lastName)) {
        return res.status(400).json({ error: 'Please provide your guest\'s first and last name.' });
      }
      if (plusOne.attending && entreeChoice && !isValidEntree(entrees, entreeChoice, 'adult')) {
        return res.status(400).json({ error: 'Invalid entrée selection for your guest.' });
      }
      validatedPlusOne = {
        firstName: firstName || '',
        lastName: lastName || '',
        attending: plusOne.attending,
        comments: comments?.trim() || null,
        entreeChoice: plusOne.attending ? entreeChoice || null : null,
      };
    }

    let validatedReminderEmail: string | null | undefined = undefined;
    if (reminderEmail !== undefined) {
      const email = optionalString(reminderEmail, MAX_EMAIL_LENGTH);
      if (email === INVALID) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      const trimmed = email?.trim() || null;
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      validatedReminderEmail = trimmed;
    }

    const existingPlusOne = household.allowPlusOne
      ? await db.query.plusOnes.findFirst({ where: eq(plusOnes.householdId, household.id) })
      : undefined;

    const hasExistingRsvp = existingGuests.some((g) => g.attending !== null);
    const action = hasExistingRsvp ? 'modification' : 'initial_rsvp';

    const snapshot = JSON.stringify({
      guests: validatedGuests.map((g) => ({
        ...g,
        firstName: guestById.get(g.id)?.firstName,
        lastName: guestById.get(g.id)?.lastName,
      })),
      plusOne: validatedPlusOne,
      reminderEmail: validatedReminderEmail ?? null,
    });

    db.transaction((tx) => {
      for (const guestRsvp of validatedGuests) {
        tx.update(guests)
          .set({
            attending: guestRsvp.attending,
            comments: guestRsvp.comments,
            entreeChoice: guestRsvp.entreeChoice,
          })
          .where(eq(guests.id, guestRsvp.id))
          .run();
      }

      if (household.allowPlusOne) {
        if (validatedPlusOne && validatedPlusOne.attending) {
          if (existingPlusOne) {
            tx.update(plusOnes)
              .set(validatedPlusOne)
              .where(eq(plusOnes.householdId, household.id))
              .run();
          } else {
            tx.insert(plusOnes)
              .values({ householdId: household.id, ...validatedPlusOne })
              .run();
          }
        } else if (existingPlusOne && existingPlusOne.attending) {
          // "not bringing a guest"
          tx.update(plusOnes)
            .set({ attending: false, entreeChoice: null })
            .where(eq(plusOnes.householdId, household.id))
            .run();
        }
      }

      if (validatedReminderEmail !== undefined) {
        tx.update(households)
          .set({ reminderEmail: validatedReminderEmail })
          .where(eq(households.id, household.id))
          .run();
      }

      tx.insert(rsvpLogs)
        .values({
          householdId: household.id,
          action,
          timestamp: new Date().toISOString(),
          snapshot,
        })
        .run();
    });

    return res.json({ success: true, message: 'RSVP submitted successfully' });
  } catch (error) {
    console.error('RSVP error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
