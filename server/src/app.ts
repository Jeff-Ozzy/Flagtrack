import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth';
import { config } from './config';
import { HttpError, errorHandler } from './http';
import { pushRouter } from './push';
import { activitiesRouter } from './routes/activities';
import { authRouter } from './routes/auth';
import { attemptsRouter, challengesRouter } from './routes/challenges';
import { championshipsRouter, gamesRouter } from './routes/championships';
import { collectivesRouter } from './routes/collectives';
import { demoRouter } from './routes/demo';
import { insightsRouter } from './routes/insights';
import { profileRouter, weightRouter } from './routes/profile';
import { reportsRouter } from './routes/reports';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: config.isProd ? undefined : false }));
  app.use(cookieParser());
  app.use(express.json({ limit: '200kb' }));

  // Writes must be JSON (or a raw image for the photo upload): blocks simple cross-site form posts.
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers['content-length'] !== '0') {
      const type = req.headers['content-type'] ?? '';
      if (type && !type.startsWith('application/json') && !type.startsWith('image/')) {
        return next(new HttpError(415, 'Tipo de conteúdo não suportado.', 'UNSUPPORTED'));
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/profile', profileRouter);
  api.use('/weights', weightRouter);
  api.use('/activities', activitiesRouter);
  api.use('/championships', championshipsRouter);
  api.use('/games', gamesRouter);
  api.use('/challenges', challengesRouter);
  api.use('/attempts', attemptsRouter);
  api.use('/collectives', collectivesRouter);
  api.use('/reports', reportsRouter);
  api.use('/push', pushRouter);
  api.use('/demo', demoRouter);
  api.use('/', insightsRouter);
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.', 'NOT_FOUND')));

  // Production: serve the built PWA with SPA fallback.
  if (existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(join(config.webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
