import 'dotenv/config';
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initDb } from './db/index.js';
import householdRoutes from './routes/household.js';
import rsvpRoutes from './routes/rsvp.js';
import scheduleRoutes from './routes/schedule.js';
import faqsRoutes from './routes/faqs.js';
import configRoutes from './routes/config.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

const trustedOrigins = (
  process.env.TRUSTED_ORIGINS || 'http://localhost:5173,http://localhost:3001'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.disable('x-powered-by');
if (isProd) app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: trustedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: '64kb' }));

app.use('/api/household', householdRoutes);
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/faqs', faqsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use((_req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({ error: 'Not found' });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error('[express] unhandled error:', err);
  }
  res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Invalid request' });
};
app.use(errorHandler);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server] failed to initialize database:', err);
    process.exit(1);
  });
