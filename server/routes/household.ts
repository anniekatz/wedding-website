import { Router } from 'express';
import { db, households, guests, plusOnes } from '../db/index.js';
import { eq } from 'drizzle-orm';

const router = Router();

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

// lookup household
router.get('/lookup', async (req, res) => {
  try {
    const { code, firstName, lastName } = req.query;

    if (code) {
      const household = await db.query.households.findFirst({
        where: eq(households.inviteCode, String(code).toUpperCase()),
      });

      if (!household) {
        return res.status(404).json({ error: 'Invitation not found' });
      }

      return res.json({ householdId: household.id });
    }

    if (firstName && lastName) {
      const normalizedFirst = normalizeName(String(firstName));
      const normalizedLast = normalizeName(String(lastName));

      const allGuests = await db.query.guests.findMany();

      const guest = allGuests.find(g => {
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

      if (!guest) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      return res.json({ householdId: guest.householdId });
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
    const householdId = parseInt(req.params.id);

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
      household,
      guests: householdGuests,
      plusOne,
    });
  } catch (error) {
    console.error('Get household error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
