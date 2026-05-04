import { Router } from 'express';
import { db, guests, plusOnes, households, rsvpLogs } from '../db/index.js';
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

// submit or update RSVP
router.post('/', async (req, res) => {
  try {
    if (isRsvpLocked()) {
      return res.status(403).json({
        error: 'RSVPs are now closed. You can no longer modify your reservation.',
      });
    }

    const { householdId, guests: guestRsvps, plusOne, reminderEmail } = req.body as RsvpRequest;

    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });

    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const existingGuests = await db.query.guests.findMany({
      where: eq(guests.householdId, householdId),
    });
    const hasExistingRsvp = existingGuests.some(g => g.attending !== null);
    const action = hasExistingRsvp ? 'modification' : 'initial_rsvp';

    for (const guestRsvp of guestRsvps) {
      await db
        .update(guests)
        .set({
          attending: guestRsvp.attending,
          comments: guestRsvp.comments || null,
          entreeChoice: guestRsvp.attending ? (guestRsvp.entreeChoice || null) : null,
        })
        .where(eq(guests.id, guestRsvp.id));
    }

    if (household.allowPlusOne && plusOne) {
      const existingPlusOne = await db.query.plusOnes.findFirst({
        where: eq(plusOnes.householdId, householdId),
      });

      if (existingPlusOne) {
        await db
          .update(plusOnes)
          .set({
            firstName: plusOne.firstName,
            lastName: plusOne.lastName,
            attending: plusOne.attending,
            comments: plusOne.comments || null,
            entreeChoice: plusOne.attending ? (plusOne.entreeChoice || null) : null,
          })
          .where(eq(plusOnes.householdId, householdId));
      } else if (plusOne.attending) {
        await db.insert(plusOnes).values({
          householdId,
          firstName: plusOne.firstName,
          lastName: plusOne.lastName,
          attending: plusOne.attending,
          comments: plusOne.comments || null,
          entreeChoice: plusOne.entreeChoice || null,
        });
      }
    }

    if (reminderEmail !== undefined) {
      await db
        .update(households)
        .set({ reminderEmail: reminderEmail || null })
        .where(eq(households.id, householdId));
    }

    const snapshot = JSON.stringify({
      guests: guestRsvps,
      plusOne: plusOne || null,
      reminderEmail: reminderEmail || null,
    });
    await db.insert(rsvpLogs).values({
      householdId,
      action,
      timestamp: new Date().toISOString(),
      snapshot,
    });

    return res.json({ success: true, message: 'RSVP submitted successfully' });
  } catch (error) {
    console.error('RSVP error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
