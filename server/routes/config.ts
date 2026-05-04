import { Router } from 'express';
import { db, entreeOptions } from '../db/index.js';
import { asc } from 'drizzle-orm';
import { getRsvpSettings } from '../config.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const entrees = await db.query.entreeOptions.findMany({
      orderBy: [asc(entreeOptions.order)],
    });

    return res.json({
      rsvp: getRsvpSettings(),
      entreeOptions: entrees,
    });
  } catch (error) {
    console.error('Config error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
