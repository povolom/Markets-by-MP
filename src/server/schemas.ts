// The Markets API contract. These schemas validate requests, shape responses and generate the
// OpenAPI document at /api/v1/openapi.json.
import { z } from '@hono/zod-openapi';

const dec = (desc: string) => z.string().regex(/^-?\d+(\.\d+)?$/).openapi({ description: `${desc} Decimal string.`, example: '182.4100' });
const decN = (desc: string) => dec(desc).nullable();

export const DataMeta = z.object({
  provider: z.string().openapi({ example: 'demo' }),
  provenance: z.enum(['demo', 'production', 'research']),
  observedAt: z.string().nullable().openapi({ description: 'When the market value was observed (ISO 8601).' }),
  retrievedAt: z.string().openapi({ description: 'When Markets produced this response (ISO 8601).' }),
  delaySeconds: z.number().nullable().openapi({ description: 'Known delay; null when unknown.' }),
  notes: z.array(z.string()).optional(),
}).openapi('DataMeta');

export const Instrument = z.object({
  id: z.string().openapi({ example: 'xnas.aapl', description: 'Stable Markets instrument ID.' }),
  symbol: z.string().openapi({ example: 'AAPL' }), name: z.string(),
  assetClass: z.enum(['stock', 'etf', 'crypto', 'index', 'fx', 'mutual_fund']),
  exchange: z.string().openapi({ example: 'XNAS' }), exchangeName: z.string(),
  currency: z.string().openapi({ example: 'USD' }), timezone: z.string().openapi({ example: 'America/New_York' }),
  country: z.string().nullable(), sector: z.string().nullable(), industry: z.string().nullable(),
  tradable: z.boolean().openapi({ description: 'False for indexes and FX pairs, which are not directly purchasable here.' }),
  description: z.string(),
}).openapi('Instrument');

export const Quote = z.object({
  instrumentId: z.string(), price: dec('Last price.'), previousClose: dec('Previous session close.'),
  change: dec('Signed change from the previous close.'), changePct: dec('Signed percent change.'),
  dayHigh: decN('Session high so far.'), dayLow: decN('Session low so far.'), currency: z.string(),
  session: z.enum(['pre', 'open', 'post', 'closed', 'always_open']), meta: DataMeta,
}).openapi('Quote');

export const Bar = z.object({ date: z.string(), open: dec(''), high: dec(''), low: dec(''), close: dec('Raw close.'), adjClose: dec('Close adjusted for splits and distributions.'), volume: z.number().nullable() }).openapi('Bar');

export const ErrorBody = z.object({ error: z.object({ code: z.string().openapi({ example: 'not_found' }), message: z.string(), details: z.any().optional(), requestId: z.string().nullable() }) }).openapi('Error');
export const Pagination = z.object({ limit: z.number(), nextCursor: z.string().nullable(), total: z.number() }).openapi('Pagination');

export const InstrumentId = z.object({ id: z.string().min(1).max(64).openapi({ param: { name: 'id', in: 'path' }, example: 'xnas.aapl' }) });

export const Statistics = z.object({
  instrumentId: z.string(), fiftyTwoWeekHigh: decN(''), fiftyTwoWeekLow: decN(''), volatility1y: decN('Annualized, percent.'),
  maxDrawdown1y: decN('Percent, negative.'), marketCap: decN('Equities only.'), peRatio: decN('Equities only.'), dividendYield: decN('Trailing, percent.'),
  expenseRatio: decN('Funds only, percent.'), beta: decN('Equities only.'), meta: DataMeta,
}).openapi('Statistics');

export const Dividend = z.object({ exDate: z.string(), payDate: z.string().nullable(), amount: dec('Per unit.'), currency: z.string(), status: z.enum(['paid', 'declared', 'projected']).openapi({ description: '"projected" amounts and dates are estimates, not declarations.' }) }).openapi('Dividend');
export const Event = z.object({ id: z.string(), instrumentId: z.string(), type: z.enum(['earnings', 'dividend_ex', 'dividend_pay', 'split', 'meeting']), date: z.string(), confirmed: z.boolean().openapi({ description: 'False means an estimated date.' }), title: z.string() }).openapi('Event');
export const News = z.object({ id: z.string(), title: z.string(), publisher: z.string(), publishedAt: z.string(), url: z.string(), excerpt: z.string().nullable(), instrumentIds: z.array(z.string()), kind: z.enum(['reporting', 'opinion', 'press_release', 'unknown']), provenance: z.enum(['demo', 'production', 'research']) }).openapi('NewsItem');
const Row = z.object({ label: z.string(), values: z.array(z.string().nullable()) });
export const Financials = z.object({ instrumentId: z.string(), periods: z.array(z.string()), currency: z.string(), income: z.array(Row), balance: z.array(Row), cashflow: z.array(Row), meta: DataMeta }).openapi('Financials');
const Suggestion = z.object({ instrumentId: z.string(), score: z.number(), reasons: z.array(z.string()), correlation1y: z.number().nullable() });
export const Related = z.object({ similar: z.array(Suggestion), different: z.array(Suggestion), method: z.string(), disclaimer: z.string() }).openapi('Related');
export const DipRow = z.object({ instrumentId: z.string(), instrument: Instrument, quote: Quote, dropPct: decN('Signed percent from the reference high.'), reference: decN('Reference high on today\'s price basis.'), referenceDate: z.string().nullable(), windowDays: z.number(), basis: z.enum(['close', 'intraday']) }).openapi('DipSnapshot');

export const Ok = z.object({ ok: z.literal(true) });
export const Any = z.record(z.string(), z.any());
