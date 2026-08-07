import { Router } from 'express';
import { db, entreeOptions } from '../db/index.js';
import { asc } from 'drizzle-orm';
import { getRsvpSettings } from '../config.js';
import { isCodeLookupEnabled } from '../settings.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const [entrees, codeLookupEnabled] = await Promise.all([
      db.query.entreeOptions.findMany({
        orderBy: [asc(entreeOptions.order)],
      }),
      isCodeLookupEnabled(),
    ]);

    return res.json({
      rsvp: { ...getRsvpSettings(), codeLookupEnabled },
      entreeOptions: entrees,
    });
  } catch (error) {
    console.error('Config error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
