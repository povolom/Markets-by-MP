// Similar & Different. Each suggestion says why it appears. Similarity is not suitability, and a
// different ticker is not proof of diversification; the UI says both.
import type { Bar, Instrument } from './types';
import { correlation } from './stats';

export interface Suggestion { instrumentId: string; score: number; reasons: string[]; correlation1y: number | null }

export function similarAndDifferent(target: Instrument, candidates: Instrument[], history: (id: string) => Bar[] | undefined, interests: string[] = []) {
  const th = history(target.id) ?? [];
  const scored = candidates.filter(c => c.id !== target.id && c.assetClass !== 'fx').map(c => {
    const corr = th.length ? correlation(th, history(c.id) ?? []) : null;
    return { c, corr };
  });

  const similar: Suggestion[] = scored.map(({ c, corr }) => {
    const reasons: string[] = []; let score = 0;
    if (c.assetClass === target.assetClass) { score += 2; reasons.push(`Also ${label(c.assetClass)}`); }
    if (target.industry && c.industry === target.industry) { score += 3; reasons.push(`Same industry: ${c.industry}`); }
    else if (target.sector && c.sector === target.sector) { score += 2; reasons.push(`Same sector: ${c.sector}`); }
    if (target.country && c.country === target.country) { score += 1; reasons.push(`Listed in the same country (${c.country})`); }
    if (corr != null && corr > 0.6) { score += 2; reasons.push(`Prices moved closely together over the last year (correlation ${corr.toFixed(2)})`); }
    if (interests.includes(c.assetClass)) { score += 0.5; reasons.push('Matches an interest you chose'); }
    return { instrumentId: c.id, score, reasons, correlation1y: corr == null ? null : Number(corr.toFixed(2)) };
  }).filter(s => s.score >= 3).sort((a, b) => b.score - a.score).slice(0, 6);

  const different: Suggestion[] = scored.filter(({ c }) => c.tradable).map(({ c, corr }) => {
    const reasons: string[] = []; let score = 0;
    if (target.sector && c.sector && c.sector !== target.sector) { score += 2; reasons.push(`Different sector: ${c.sector}`); }
    if (target.country && c.country && c.country !== target.country) { score += 1.5; reasons.push(`Different country: ${c.country}`); }
    if (c.currency !== target.currency) { score += 1; reasons.push(`Priced in ${c.currency} instead of ${target.currency}`); }
    if (c.assetClass !== target.assetClass) { score += 1; reasons.push(`A different kind of asset: ${label(c.assetClass)}`); }
    if (corr != null && corr < 0.3) { score += 2; reasons.push(`Prices moved less in step over the last year (correlation ${corr.toFixed(2)})`); }
    return { instrumentId: c.id, score, reasons, correlation1y: corr == null ? null : Number(corr.toFixed(2)) };
  }).filter(s => s.score >= 3).sort((a, b) => b.score - a.score).slice(0, 6);

  return {
    similar, different,
    method: 'Scores combine asset class, sector and industry, country, currency, your chosen interests and the correlation of daily returns over the last year. Correlation describes the past, not the future.',
    disclaimer: 'Similar is not the same as suitable, and a different ticker is not proof of diversification. Review each one yourself.',
  };
}

export const label = (c: string) => ({ stock: 'a stock', etf: 'an ETF', crypto: 'a crypto asset', index: 'an index', fx: 'a currency pair', mutual_fund: 'a mutual fund' } as Record<string, string>)[c] ?? c;
