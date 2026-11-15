// Cloudflare Worker entry: accounts at /api/auth/*, the Markets API at /api/v1/*, and the scheduled
// alert job. Everything else is the web app, served as static assets.
import { createAuth } from './server/auth';
import { createApi } from './server/app';
import type { Env } from './server/env';
import { evaluateAll } from './server/jobs/alerts';
import { errorResponse, ApiError } from './server/http';

const { app, marketFor } = createApi(async c => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  return session ? { userId: session.user.id, isAnonymous: Boolean((session.user as { isAnonymous?: boolean }).isAnonymous) } : null;
});

app.on(['GET', 'POST'], '/api/auth/*', async c => {
  const res = await createAuth(c.env).handler(c.req.raw);
  return res;
});
app.get('/api/auth', c => errorResponse(c, new ApiError(404, 'not_found', 'See /api/v1/docs.')));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(evaluateAll(env.DB, userId => marketFor(env, userId, { scheduled: true })));
  },
} satisfies ExportedHandler<Env>;
