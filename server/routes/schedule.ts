import { Router } from 'express';
import { db, scheduleEvents } from '../db/index.js';
import { asc } from 'drizzle-orm';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const events = await db.query.scheduleEvents.findMany({
      orderBy: [asc(scheduleEvents.order)],
    });

    return res.json(events);
  } catch (error) {
    console.error('Schedule error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
