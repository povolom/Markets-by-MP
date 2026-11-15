// Shared domain types. The API contract (src/server/schemas.ts) mirrors these, and the web app,
// the API and future native clients all use the same shapes.

export type AssetClass = 'stock' | 'etf' | 'crypto' | 'index' | 'fx' | 'mutual_fund';
export type Currency = 'CAD' | 'USD' | string;
export type Provenance = 'demo' | 'production' | 'research';

/** Where a value came from and how fresh it is. Attached to every market-data response. */
export interface DataMeta {
  provider: string;            // e.g. "demo", "yahoo-research"
  provenance: Provenance;      // demo data is always labelled as such
  observedAt: string | null;   // when the market value was observed (ISO)
  retrievedAt: string;         // when Markets fetched or generated it (ISO)
  delaySeconds: number | null; // known delay, null if unknown
  notes?: string[];
}

export interface Instrument {
  id: string;                  // stable Markets ID, e.g. "xnas.aapl"
  symbol: string;              // ticker as quoted on its exchange
  name: string;
  assetClass: AssetClass;
  exchange: string;            // MIC or pseudo-exchange ("CRYPTO", "INDEX", "FX")
  exchangeName: string;
  currency: Currency;
  timezone: string;            // exchange timezone (IANA)
  country: string | null;      // ISO country of listing / domicile
  sector: string | null;
  industry: string | null;
  tradable: boolean;           // false for indexes: they are not directly purchasable
  description: string;
}

export interface Bar {
  date: string;                // YYYY-MM-DD in exchange timezone
  open: string; high: string; low: string; close: string;
  adjClose: string;            // adjusted for splits and distributions
  volume: number | null;
}

export type SessionStatus = 'pre' | 'open' | 'post' | 'closed' | 'always_open';

export interface Quote {
  instrumentId: string;
  price: string;
  previousClose: string;
  change: string;              // signed
  changePct: string;           // signed percent
  dayHigh: string | null;
  dayLow: string | null;
  currency: Currency;
  session: SessionStatus;
  meta: DataMeta;
}

export interface DividendRecord {
  exDate: string;
  payDate: string | null;
  amount: string;              // per share/unit, in currency
  currency: Currency;
  status: 'paid' | 'declared' | 'projected';
}

export interface MarketEvent {
  id: string;
  instrumentId: string;
  type: 'earnings' | 'dividend_ex' | 'dividend_pay' | 'split' | 'meeting';
  date: string;
  confirmed: boolean;          // false = estimated date
  title: string;
}

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
  excerpt: string | null;
  instrumentIds: string[];
  kind: 'reporting' | 'opinion' | 'press_release' | 'unknown';
  provenance: Provenance;
}

export interface FundHolding {
  instrumentId: string | null; // null when the holding isn't in Markets' coverage
  name: string;
  weightPct: string;
  sector: string | null;
  country: string | null;
}

export interface FundComposition {
  asOf: string;
  coveragePct: string;         // share of the fund described by `holdings`
  holdings: FundHolding[];
  sectors: Record<string, string>;
  countries: Record<string, string>;
}

export interface Statistics {
  instrumentId: string;
  fiftyTwoWeekHigh: string | null;
  fiftyTwoWeekLow: string | null;
  volatility1y: string | null;       // annualized, percent
  maxDrawdown1y: string | null;      // percent (negative)
  marketCap: string | null;          // equities only
  peRatio: string | null;            // equities only
  dividendYield: string | null;      // stocks, ETFs, funds
  expenseRatio: string | null;       // funds only
  beta: string | null;
  meta: DataMeta;
}

export interface FinancialStatementRow { label: string; values: (string | null)[] }
export interface Financials {
  instrumentId: string;
  periods: string[];                 // fiscal years, newest first
  currency: Currency;
  income: FinancialStatementRow[];
  balance: FinancialStatementRow[];
  cashflow: FinancialStatementRow[];
  meta: DataMeta;
}

export type TransactionType = 'buy' | 'sell' | 'dividend' | 'fee' | 'deposit' | 'withdrawal' | 'split' | 'interest';

export interface Transaction {
  id: string;
  portfolioId: string;
  type: TransactionType;
  instrumentId: string | null;
  tradeDate: string;
  quantity: string | null;
  price: string | null;              // null = cost unknown
  amount: string | null;
  currency: Currency;
  fxToBase: string | null;           // rate currency -> base on tradeDate
  fee: string;
  note: string;
}
