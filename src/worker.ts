// Cloudflare Worker entry: accounts at /api/auth/*, the Markets API at /api/v1/*, and the scheduled
// alert job. Everything else is the web app, served as static assets.
import { createAuth } from './server/auth';
import { createApi } from './server/app';
import type { Env } from './server/env';
import { evaluateAll } from './server/jobs/alerts';
import { markInvalid, staleQuestrade, updateQuestrade } from './server/data-keys';
import { redeemQuestrade } from './server/providers/questrade';
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

/** Questrade refresh tokens expire if unused for a few days; refresh quiet connections once a day. */
async function keepQuestradeAlive(env: Env) {
  const secret = env.DATA_KEY_SECRET ?? env.BETTER_AUTH_SECRET;
  const { loadQuestrade } = await import('./server/data-keys');
  for (const { user_id } of (await staleQuestrade(env.DB, 24)).slice(0, 50)) {
    const cur = await loadQuestrade(env.DB, secret, user_id); if (!cur) continue;
    const next = await redeemQuestrade(cur.refreshToken);
    if (next === 'invalid') await markInvalid(env.DB, user_id, 'questrade');
    else if (next !== 'unavailable') await updateQuestrade(env.DB, secret, user_id, next);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(evaluateAll(env.DB, userId => marketFor(env, userId, { scheduled: true })));
    ctx.waitUntil(keepQuestradeAlive(env));
  },
} satisfies ExportedHandler<Env>;
