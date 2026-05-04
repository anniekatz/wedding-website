import { Router } from 'express';
import { db, faqs } from '../db/index.js';
import { asc } from 'drizzle-orm';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const items = await db.query.faqs.findMany({
      orderBy: [asc(faqs.order)],
    });

    return res.json(items);
  } catch (error) {
    console.error('FAQs error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
