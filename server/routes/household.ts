import { Router } from 'express';
import { db, households, guests, plusOnes } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';
import { isCodeLookupEnabled } from '../settings.js';

const router = Router();

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// lookup household
router.get('/lookup', async (req, res) => {
  try {
    const { code, firstName, lastName } = req.query;

    if (code) {
      if (!(await isCodeLookupEnabled())) {
        return res.status(403).json({
          error: 'Invite code lookup is turned off. Please search by your first and last name.',
        });
      }

      const inviteCode = String(code).trim().toUpperCase();
      const household = await db.query.households.findFirst({
        where: sql`upper(${households.inviteCode}) = ${inviteCode}`,
      });

      if (!household) {
        return res.status(404).json({ error: 'Invitation not found' });
      }

      return res.json({ householdId: household.id });
    }

    if (firstName && lastName) {
      const normalizedFirst = normalizeName(String(firstName));
      const normalizedLast = normalizeName(String(lastName));

      if (!normalizedFirst || !normalizedLast) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      const allGuests = await db.query.guests.findMany();

      const matches = allGuests.filter(g => {
        if (normalizeName(g.lastName) !== normalizedLast) {
          return false;
        }

        if (normalizeName(g.firstName) === normalizedFirst) {
          return true;
        }

        if (g.nickname) {
          const nicknames = g.nickname.split(',').map(n => normalizeName(n.trim()));
          if (nicknames.includes(normalizedFirst)) {
            return true;
          }
        }

        return false;
      });

      const householdIds = [...new Set(matches.map(g => g.householdId))];

      if (householdIds.length === 0) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      // same name invited in more than one household edge case
      if (householdIds.length > 1) {
        return res.status(409).json({
          error: (await isCodeLookupEnabled())
            ? 'More than one invitation matches that name. Please use your invite code instead.'
            : 'More than one invitation matches that name. Please contact us so we can help you find your invitation.',
        });
      }

      return res.json({ householdId: householdIds[0] });
    }

    return res.status(400).json({ error: 'Please provide invite code or name' });
  } catch (error) {
    console.error('Lookup error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// get household details
router.get('/:id', async (req, res) => {
  try {
    const householdId = Number(req.params.id);
    if (!Number.isInteger(householdId) || householdId <= 0) {
      return res.status(400).json({ error: 'Invalid household id' });
    }

    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });

    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const householdGuests = await db.query.guests.findMany({
      where: eq(guests.householdId, householdId),
    });

    const plusOne = await db.query.plusOnes.findFirst({
      where: eq(plusOnes.householdId, householdId),
    });

    return res.json({
      household: {
        id: household.id,
        name: household.name,
        allowPlusOne: household.allowPlusOne,
        reminderEmail: household.reminderEmail,
      },
      guests: householdGuests.map(g => ({
        id: g.id,
        firstName: g.firstName,
        lastName: g.lastName,
        type: g.type,
        attending: g.attending,
        comments: g.comments,
        entreeChoice: g.entreeChoice,
      })),
      plusOne: plusOne
        ? {
            firstName: plusOne.firstName,
            lastName: plusOne.lastName,
            attending: plusOne.attending,
            comments: plusOne.comments,
            entreeChoice: plusOne.entreeChoice,
          }
        : null,
    });
  } catch (error) {
    console.error('Get household error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
