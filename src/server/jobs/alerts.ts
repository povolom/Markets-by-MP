// Alert evaluation. Runs on a schedule (cron) for every user with active rules, and on demand for one
// user. Uses the shared rule engine; stores crossing state and de-duplicated events.
import { evaluateRule, step, dedupeKey, type RuleInput } from '../../domain/dips';
import { all, first, stmt } from '../db';
import { newId } from '../http';
import type { Market } from '../market';
import { summarize } from '../portfolio-service';

export interface RuleRow {
  id: string; user_id: string; name: string; scope: 'instrument' | 'watchlist' | 'holdings'; instrument_id: string | null; watchlist_id: string | null; portfolio_id: string | null;
  kind: RuleInput['kind']; threshold: string; window_days: number; basis: 'close' | 'intraday'; reset_band: string; cooldown_hours: number; notify: number; active: number;
}
export const toRuleInput = (r: RuleRow): RuleInput => ({ kind: r.kind, threshold: r.threshold, windowDays: r.window_days, basis: r.basis, resetBand: r.reset_band, cooldownHours: r.cooldown_hours });

/** The instruments a rule watches, plus average costs when it is about holdings. */
export async function ruleTargets(db: D1Database, m: Market, r: RuleRow): Promise<{ id: string; avgCost: string | null }[]> {
  if (r.scope === 'instrument' && r.instrument_id) return [{ id: r.instrument_id, avgCost: null }];
  if (r.scope === 'watchlist' && r.watchlist_id) {
    const items = await all<{ instrument_id: string }>(db, 'SELECT i.instrument_id FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE w.id = ? AND w.user_id = ?', r.watchlist_id, r.user_id);
    return items.map(i => ({ id: i.instrument_id, avgCost: null }));
  }
  if (r.scope === 'holdings' && r.portfolio_id) {
    const s = await summarize(db, m, r.user_id, r.portfolio_id).catch(() => null);
    if (!s) return [];
    const fx = s.fx;
    // Average cost is in base currency; convert back to the instrument's currency to compare with its price.
    return s.summary.holdings.filter(h => r.instrument_id ? h.instrumentId === r.instrument_id : true)
      .map(h => ({ id: h.instrumentId, avgCost: h.avgCost ? (Number(h.avgCost) / Number(fx[m.instrument(h.instrumentId).currency] ?? 1)).toFixed(4) : null }));
  }
  return [];
}

export async function evaluateUser(db: D1Database, m: Market, userId: string, now = new Date()) {
  const rules = await all<RuleRow>(db, 'SELECT * FROM alert_rules WHERE user_id = ? AND active = 1', userId);
  let fired = 0;
  const results: { ruleId: string; instrumentId: string; matched: boolean; fired: boolean; suppressedBy?: string; explanation: string; unavailable?: string }[] = [];
  for (const r of rules) {
    for (const t of await ruleTargets(db, m, r)) {
      const inst = m.lookup(t.id); if (!inst) continue;
      let bars, q;
      try { [bars, q] = await Promise.all([m.fullHistory(t.id), m.quote(t.id)]); }
      catch (e) { results.push({ ruleId: r.id, instrumentId: t.id, matched: false, fired: false, explanation: 'No price available', unavailable: (e as Error).message }); continue; }
      const ev = evaluateRule(toRuleInput(r), bars, q.price, t.avgCost);
      const st = await first<{ armed: number; last_triggered_at: string | null }>(db, 'SELECT armed, last_triggered_at FROM alert_state WHERE rule_id = ? AND instrument_id = ?', r.id, t.id);
      const out = step({ armed: st ? st.armed === 1 : true, lastTriggeredAt: st?.last_triggered_at ?? null }, ev, toRuleInput(r), now);
      const marketDate = (q.meta.observedAt ?? now.toISOString()).slice(0, 10);
      const batch = [stmt(db, 'INSERT INTO alert_state (rule_id, instrument_id, armed, last_triggered_at) VALUES (?, ?, ?, ?) ON CONFLICT(rule_id, instrument_id) DO UPDATE SET armed = excluded.armed, last_triggered_at = excluded.last_triggered_at', r.id, t.id, out.next.armed ? 1 : 0, out.next.lastTriggeredAt)];
      if (out.fire) {
        const msg = r.kind === 'target_price' ? `${inst.symbol} is below your target price.` : `Your rule matched: ${inst.symbol} is ${ev.explanation}.`;
        batch.push(stmt(db, 'INSERT OR IGNORE INTO alert_events (id, user_id, rule_id, instrument_id, observed_at, value, reference, message, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId('evt'), userId, r.id, t.id, q.meta.observedAt ?? now.toISOString(), ev.metric ?? '', ev.reference ?? '', msg, dedupeKey(r.id, t.id, marketDate)));
        fired++;
      }
      await db.batch(batch);
      results.push({ ruleId: r.id, instrumentId: t.id, matched: ev.matched, fired: out.fire, suppressedBy: out.suppressedBy, explanation: ev.explanation, unavailable: ev.unavailable });
    }
  }
  return { evaluated: results.length, fired, results };
}

/** Cron entry point: every user with an active rule, oldest first, bounded per run. */
export async function evaluateAll(db: D1Database, marketFor: (userId: string) => Promise<Market>, maxUsers = 200) {
  const users = await all<{ user_id: string }>(db, 'SELECT DISTINCT user_id FROM alert_rules WHERE active = 1 LIMIT ?', maxUsers);
  let fired = 0, failed = 0;
  for (const u of users) {
    try { fired += (await evaluateUser(db, await marketFor(u.user_id), u.user_id)).fired; }
    catch (e) { failed++; console.error(JSON.stringify({ level: 'error', job: 'alerts', error: String((e as Error).message) })); }
  }
  console.log(JSON.stringify({ level: 'info', job: 'alerts', users: users.length, fired, failed }));
  return { users: users.length, fired, failed };
}
