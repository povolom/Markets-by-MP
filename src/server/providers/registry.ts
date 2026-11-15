// Chooses which provider serves which purpose. Public display and API redistribution only ever use a
// provider whose rights allow it; if none does, the API says so instead of substituting other data.
import { createDemoProvider } from './demo';
import { createYahooResearch } from './yahoo-research';
import type { MarketDataProvider, ProviderInfo } from './types';

export interface Registry {
  market: MarketDataProvider;          // serves public display and the API
  providers: ProviderInfo[];           // everything configured, for /coverage
  research: ReturnType<typeof createYahooResearch>;
}

let demo: MarketDataProvider | null = null;

export function getRegistry(env: { YAHOO_RESEARCH?: string }): Registry {
  demo ??= createDemoProvider();
  const research = createYahooResearch(env.YAHOO_RESEARCH === 'enabled');
  const market = demo; // the only provider whose rights allow public display and redistribution today
  if (!market.info.rights.publicDisplay || !market.info.rights.apiRedistribution) throw new Error('No provider is licensed for public display.');
  return { market, providers: [demo.info, research.info], research };
}
