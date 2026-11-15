// Provider contract. The Markets API talks only to this interface; upstream sources plug in behind it.
import type { Bar, DividendRecord, Financials, FundComposition, Instrument, MarketEvent, NewsItem, Quote, Statistics } from '../../domain/types';

/** What a provider's data may be used for. Each use is tracked separately. */
export interface Rights {
  internalProcessing: boolean;
  publicDisplay: boolean;
  apiRedistribution: boolean;
  derivedAnalytics: boolean;
  cachingSeconds: number;        // how long results may be cached
  newsContent: 'none' | 'headlines' | 'headlines_and_excerpts';
  notes: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  provenance: 'demo' | 'production' | 'research';
  enabled: boolean;
  rights: Rights;
  assetClasses: string[];
  delaySeconds: number | null;
}

export interface MarketDataProvider {
  info: ProviderInfo;
  instruments(): Instrument[];
  instrument(id: string): Instrument | undefined;
  history(id: string): Promise<Bar[]>;                       // daily bars, oldest first, completed sessions + today if closed
  quote(id: string, now: Date): Promise<Quote>;
  dividends(id: string, now: Date): Promise<DividendRecord[]>;
  events(id: string, now: Date): Promise<MarketEvent[]>;
  news(id: string | null, now: Date): Promise<NewsItem[]>;
  statistics(id: string, now: Date): Promise<Statistics>;
  financials(id: string, now: Date): Promise<Financials | null>;
  composition(id: string): FundComposition | undefined;
  fxRate(from: string, to: string, date: string | null): Promise<string>;  // date null = latest
}
