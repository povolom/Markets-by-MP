// Accounts and sessions use Better Auth (a maintained, open-source auth library): password hashing,
// session cookies and tokens are its job, not ours. Guests get an anonymous session for the labelled
// demo, and can turn it into a real account later; their own watchlists, rules, plans and journal
// entries move across, while the demo portfolio (made-up holdings) does not.
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import type { Env } from './env';

export function emailAvailable(env: Env) { return Boolean(env.EMAIL_PROVIDER); }

export function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.BETTER_AUTH_URL],
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: false,
      // No email provider is configured in the beta, so reset links can't be delivered yet.
      sendResetPassword: async ({ url }) => {
        if (!emailAvailable(env) && env.ENVIRONMENT !== 'production') console.log(JSON.stringify({ level: 'info', event: 'dev_reset_link', url }));
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ url }) => {
        if (!emailAvailable(env) && env.ENVIRONMENT !== 'production') console.log(JSON.stringify({ level: 'info', event: 'dev_verify_link', url }));
      },
    },
    plugins: [
      anonymous({
        emailDomainName: 'guest.markets.invalid',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const from = anonymousUser.user.id, to = newUser.user.id;
          await env.DB.batch([
            env.DB.prepare('INSERT OR IGNORE INTO profiles (user_id, display_name) VALUES (?, ?)').bind(to, newUser.user.name ?? ''),
            env.DB.prepare('UPDATE watchlists SET user_id = ? WHERE user_id = ?').bind(to, from),
            env.DB.prepare("UPDATE alert_rules SET user_id = ?, portfolio_id = NULL WHERE user_id = ? AND scope != 'holdings'").bind(to, from),
            env.DB.prepare('UPDATE alert_events SET user_id = ? WHERE user_id = ? AND rule_id IN (SELECT id FROM alert_rules WHERE user_id = ?)').bind(to, from, to),
            env.DB.prepare('UPDATE plans SET user_id = ?, portfolio_id = NULL WHERE user_id = ?').bind(to, from),
            env.DB.prepare('UPDATE journal_entries SET user_id = ?, transaction_id = NULL WHERE user_id = ?').bind(to, from),
            env.DB.prepare('UPDATE bookmarks SET user_id = ? WHERE user_id = ?').bind(to, from),
          ]);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
