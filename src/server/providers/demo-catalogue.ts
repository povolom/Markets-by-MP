// The demo catalogue: real-world tickers so the product feels familiar, with generated prices and
// fundamentals that are labelled DEMO everywhere they appear. Nothing here is real market data.
import type { AssetClass, FundComposition, Instrument } from '../../domain/types';

interface Seed {
  id: string; symbol: string; name: string; cls: AssetClass; ex: string; exName: string; ccy: string;
  country: string | null; sector: string | null; industry: string | null; start: number; drift: number; vol: number;
  yieldPct?: number; payMonths?: number[]; split?: { date: string; ratio: number }; dip?: { daysAgo: number; depth: number };
  marketCapB?: number; pe?: number; expense?: number; revenueB?: number; desc: string;
}

const US = { ex: 'XNAS', exName: 'Nasdaq', ccy: 'USD', country: 'US' };
const NY = { ex: 'XNYS', exName: 'New York Stock Exchange', ccy: 'USD', country: 'US' };
const AR = { ex: 'ARCX', exName: 'NYSE Arca', ccy: 'USD', country: 'US' };
const TO = { ex: 'XTSE', exName: 'Toronto Stock Exchange', ccy: 'CAD', country: 'CA' };
const Q = [3, 6, 9, 12], Q2 = [2, 5, 8, 11], Q1 = [1, 4, 7, 10];

export const SEEDS: Seed[] = [
  { id: 'xnas.aapl', symbol: 'AAPL', name: 'Apple Inc.', cls: 'stock', ...US, sector: 'Technology', industry: 'Consumer Electronics', start: 150, drift: 0.12, vol: 0.26, yieldPct: 0.45, payMonths: Q2, dip: { daysAgo: 9, depth: 0.1 }, marketCapB: 3300, pe: 31, revenueB: 390, desc: 'Designs phones, computers, wearables and services.' },
  { id: 'xnas.msft', symbol: 'MSFT', name: 'Microsoft Corporation', cls: 'stock', ...US, sector: 'Technology', industry: 'Software', start: 290, drift: 0.13, vol: 0.24, yieldPct: 0.75, payMonths: Q, dip: { daysAgo: 14, depth: 0.06 }, marketCapB: 3100, pe: 34, revenueB: 245, desc: 'Software, cloud computing and devices.' },
  { id: 'xnas.nvda', symbol: 'NVDA', name: 'NVIDIA Corporation', cls: 'stock', ...US, sector: 'Technology', industry: 'Semiconductors', start: 420, drift: 0.35, vol: 0.5, yieldPct: 0.03, payMonths: Q, split: { date: '2024-06-10', ratio: 10 }, marketCapB: 3400, pe: 52, revenueB: 130, desc: 'Graphics processors and AI computing platforms.' },
  { id: 'xnas.amd', symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', cls: 'stock', ...US, sector: 'Technology', industry: 'Semiconductors', start: 95, drift: 0.15, vol: 0.48, marketCapB: 260, pe: 45, revenueB: 26, desc: 'Processors and graphics chips.', dip: { daysAgo: 6, depth: 0.14 } },
  { id: 'xnas.amzn', symbol: 'AMZN', name: 'Amazon.com, Inc.', cls: 'stock', ...US, sector: 'Consumer Discretionary', industry: 'Internet Retail', start: 120, drift: 0.14, vol: 0.32, marketCapB: 2100, pe: 40, revenueB: 640, desc: 'Online retail, cloud services and advertising.' },
  { id: 'xnas.googl', symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)', cls: 'stock', ...US, sector: 'Communication Services', industry: 'Internet Content', start: 105, drift: 0.14, vol: 0.3, yieldPct: 0.45, payMonths: Q, marketCapB: 2200, pe: 23, revenueB: 350, desc: 'Search, advertising, cloud and other technologies.' },
  { id: 'xnas.meta', symbol: 'META', name: 'Meta Platforms, Inc.', cls: 'stock', ...US, sector: 'Communication Services', industry: 'Internet Content', start: 280, drift: 0.18, vol: 0.38, yieldPct: 0.35, payMonths: Q, marketCapB: 1500, pe: 27, revenueB: 165, desc: 'Social apps and virtual reality.' },
  { id: 'xnas.tsla', symbol: 'TSLA', name: 'Tesla, Inc.', cls: 'stock', ...US, sector: 'Consumer Discretionary', industry: 'Auto Manufacturers', start: 210, drift: 0.08, vol: 0.6, marketCapB: 900, pe: 85, revenueB: 97, desc: 'Electric vehicles and energy storage.', dip: { daysAgo: 4, depth: 0.12 } },
  { id: 'xnas.cost', symbol: 'COST', name: 'Costco Wholesale Corporation', cls: 'stock', ...US, sector: 'Consumer Staples', industry: 'Discount Stores', start: 480, drift: 0.16, vol: 0.2, yieldPct: 0.55, payMonths: Q2, marketCapB: 400, pe: 50, revenueB: 260, desc: 'Membership warehouse stores.' },
  { id: 'xnas.nflx', symbol: 'NFLX', name: 'Netflix, Inc.', cls: 'stock', ...US, sector: 'Communication Services', industry: 'Entertainment', start: 330, drift: 0.2, vol: 0.4, marketCapB: 380, pe: 42, revenueB: 39, desc: 'Streaming entertainment.' },
  { id: 'xnys.jpm', symbol: 'JPM', name: 'JPMorgan Chase & Co.', cls: 'stock', ...NY, sector: 'Financials', industry: 'Banks', start: 135, drift: 0.11, vol: 0.22, yieldPct: 2.2, payMonths: Q1, marketCapB: 650, pe: 13, revenueB: 270, desc: 'Banking, payments and asset management.' },
  { id: 'xnys.v', symbol: 'V', name: 'Visa Inc.', cls: 'stock', ...NY, sector: 'Financials', industry: 'Credit Services', start: 220, drift: 0.11, vol: 0.2, yieldPct: 0.75, payMonths: Q, marketCapB: 600, pe: 30, revenueB: 36, desc: 'Electronic payments network.' },
  { id: 'xnys.jnj', symbol: 'JNJ', name: 'Johnson & Johnson', cls: 'stock', ...NY, sector: 'Health Care', industry: 'Drug Manufacturers', start: 165, drift: 0.02, vol: 0.17, yieldPct: 3.1, payMonths: Q, marketCapB: 380, pe: 16, revenueB: 88, desc: 'Pharmaceuticals and medical devices.' },
  { id: 'xnys.ko', symbol: 'KO', name: 'The Coca-Cola Company', cls: 'stock', ...NY, sector: 'Consumer Staples', industry: 'Beverages', start: 60, drift: 0.04, vol: 0.15, yieldPct: 3.0, payMonths: Q1, marketCapB: 290, pe: 24, revenueB: 46, desc: 'Beverages sold worldwide.' },
  { id: 'xnys.pg', symbol: 'PG', name: 'The Procter & Gamble Company', cls: 'stock', ...NY, sector: 'Consumer Staples', industry: 'Household Products', start: 145, drift: 0.05, vol: 0.16, yieldPct: 2.4, payMonths: Q2, marketCapB: 390, pe: 26, revenueB: 84, desc: 'Household and personal care products.' },
  { id: 'xnys.xom', symbol: 'XOM', name: 'Exxon Mobil Corporation', cls: 'stock', ...NY, sector: 'Energy', industry: 'Oil & Gas Integrated', start: 95, drift: 0.05, vol: 0.27, yieldPct: 3.4, payMonths: Q, marketCapB: 470, pe: 14, revenueB: 340, desc: 'Oil, gas and chemicals.' },
  { id: 'xtse.ry', symbol: 'RY', name: 'Royal Bank of Canada', cls: 'stock', ...TO, sector: 'Financials', industry: 'Banks', start: 125, drift: 0.09, vol: 0.18, yieldPct: 3.6, payMonths: Q2, marketCapB: 240, pe: 14, revenueB: 57, desc: 'Canada\'s largest bank by assets.' },
  { id: 'xtse.td', symbol: 'TD', name: 'The Toronto-Dominion Bank', cls: 'stock', ...TO, sector: 'Financials', industry: 'Banks', start: 85, drift: 0.01, vol: 0.2, yieldPct: 5.0, payMonths: Q1, marketCapB: 140, pe: 11, revenueB: 55, desc: 'Banking in Canada and the US.', dip: { daysAgo: 11, depth: 0.08 } },
  { id: 'xtse.shop', symbol: 'SHOP', name: 'Shopify Inc.', cls: 'stock', ...TO, sector: 'Technology', industry: 'Software', start: 75, drift: 0.2, vol: 0.55, marketCapB: 190, pe: 70, revenueB: 9, desc: 'Commerce software for businesses.', dip: { daysAgo: 7, depth: 0.11 } },
  { id: 'xtse.enb', symbol: 'ENB', name: 'Enbridge Inc.', cls: 'stock', ...TO, sector: 'Energy', industry: 'Oil & Gas Midstream', start: 50, drift: 0.04, vol: 0.17, yieldPct: 6.5, payMonths: [3, 6, 9, 12], marketCapB: 130, pe: 20, revenueB: 53, desc: 'Pipelines and gas utilities.' },
  { id: 'xtse.cnr', symbol: 'CNR', name: 'Canadian National Railway Company', cls: 'stock', ...TO, sector: 'Industrials', industry: 'Railroads', start: 160, drift: 0.03, vol: 0.19, yieldPct: 2.4, payMonths: Q, marketCapB: 95, pe: 19, revenueB: 17, desc: 'Freight railway across Canada and the US.' },
  { id: 'xtse.bce', symbol: 'BCE', name: 'BCE Inc.', cls: 'stock', ...TO, sector: 'Communication Services', industry: 'Telecom Services', start: 60, drift: -0.08, vol: 0.2, yieldPct: 8.0, payMonths: Q1, marketCapB: 30, pe: 18, revenueB: 24, desc: 'Telecommunications and media.' },
  { id: 'xtse.su', symbol: 'SU', name: 'Suncor Energy Inc.', cls: 'stock', ...TO, sector: 'Energy', industry: 'Oil & Gas Integrated', start: 42, drift: 0.05, vol: 0.28, yieldPct: 4.2, payMonths: Q, marketCapB: 65, pe: 9, revenueB: 50, desc: 'Integrated energy company.' },
  { id: 'xtse.csu', symbol: 'CSU', name: 'Constellation Software Inc.', cls: 'stock', ...TO, sector: 'Technology', industry: 'Software', start: 2900, drift: 0.18, vol: 0.25, yieldPct: 0.1, payMonths: Q1, marketCapB: 95, pe: 90, revenueB: 10, desc: 'Acquires and runs vertical software businesses.' },
  { id: 'xtse.xeqt', symbol: 'XEQT', name: 'iShares Core Equity ETF Portfolio', cls: 'etf', ...TO, sector: null, industry: null, start: 25, drift: 0.09, vol: 0.13, yieldPct: 1.8, payMonths: [12], expense: 0.2, desc: 'All-equity ETF portfolio holding Canadian, US and international stock ETFs.', dip: { daysAgo: 10, depth: 0.04 } },
  { id: 'xtse.vfv', symbol: 'VFV', name: 'Vanguard S&P 500 Index ETF', cls: 'etf', ...TO, sector: null, industry: null, start: 95, drift: 0.12, vol: 0.15, yieldPct: 1.1, payMonths: Q, expense: 0.09, desc: 'Tracks the S&P 500, priced in Canadian dollars.' },
  { id: 'xtse.xiu', symbol: 'XIU', name: 'iShares S&P/TSX 60 Index ETF', cls: 'etf', ...TO, sector: null, industry: null, start: 30, drift: 0.07, vol: 0.13, yieldPct: 2.9, payMonths: Q, expense: 0.18, desc: 'Tracks 60 large Canadian companies.' },
  { id: 'xtse.xaw', symbol: 'XAW', name: 'iShares Core MSCI All Country World ex Canada ETF', cls: 'etf', ...TO, sector: null, industry: null, start: 32, drift: 0.09, vol: 0.13, yieldPct: 1.5, payMonths: [6, 12], expense: 0.22, desc: 'Global stocks outside Canada.' },
  { id: 'xtse.zag', symbol: 'ZAG', name: 'BMO Aggregate Bond Index ETF', cls: 'etf', ...TO, sector: null, industry: null, start: 14.5, drift: 0.01, vol: 0.06, yieldPct: 3.3, payMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], expense: 0.09, desc: 'Canadian investment-grade bonds.' },
  { id: 'arcx.voo', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', cls: 'etf', ...AR, sector: null, industry: null, start: 380, drift: 0.12, vol: 0.15, yieldPct: 1.3, payMonths: Q, expense: 0.03, desc: 'Tracks the S&P 500.' },
  { id: 'xnas.qqq', symbol: 'QQQ', name: 'Invesco QQQ Trust', cls: 'etf', ...US, sector: null, industry: null, start: 330, drift: 0.15, vol: 0.2, yieldPct: 0.6, payMonths: Q, expense: 0.2, desc: 'Tracks the Nasdaq-100.' },
  { id: 'arcx.vti', symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', cls: 'etf', ...AR, sector: null, industry: null, start: 210, drift: 0.11, vol: 0.16, yieldPct: 1.3, payMonths: Q, expense: 0.03, desc: 'The whole US stock market.' },
  { id: 'arcx.schd', symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF', cls: 'etf', ...AR, sector: null, industry: null, start: 25, drift: 0.06, vol: 0.14, yieldPct: 3.5, payMonths: Q, expense: 0.06, desc: 'US companies with consistent dividends.' },
  { id: 'fund.demo-balanced', symbol: 'MPB100', name: 'Demo Canadian Balanced Fund', cls: 'mutual_fund', ex: 'FUND', exName: 'Mutual fund (end-of-day NAV)', ccy: 'CAD', country: 'CA', sector: null, industry: null, start: 12, drift: 0.05, vol: 0.08, yieldPct: 2.0, payMonths: [12], expense: 1.6, desc: 'A fictional balanced fund that exists only in the demo.' },
  { id: 'crypto.btc-usd', symbol: 'BTC-USD', name: 'Bitcoin', cls: 'crypto', ex: 'CRYPTO', exName: 'Crypto (24/7, composite)', ccy: 'USD', country: null, sector: null, industry: null, start: 28000, drift: 0.24, vol: 0.6, desc: 'The first decentralized cryptocurrency.', dip: { daysAgo: 5, depth: 0.13 } },
  { id: 'crypto.eth-usd', symbol: 'ETH-USD', name: 'Ethereum', cls: 'crypto', ex: 'CRYPTO', exName: 'Crypto (24/7, composite)', ccy: 'USD', country: null, sector: null, industry: null, start: 1800, drift: 0.25, vol: 0.7, desc: 'A programmable blockchain and its currency, ether.' },
  { id: 'crypto.sol-usd', symbol: 'SOL-USD', name: 'Solana', cls: 'crypto', ex: 'CRYPTO', exName: 'Crypto (24/7, composite)', ccy: 'USD', country: null, sector: null, industry: null, start: 22, drift: 0.4, vol: 0.9, desc: 'A high-throughput blockchain and its token.' },
  { id: 'index.spx', symbol: 'SPX', name: 'S&P 500', cls: 'index', ex: 'INDEX', exName: 'Index (not directly purchasable)', ccy: 'USD', country: 'US', sector: null, industry: null, start: 4200, drift: 0.11, vol: 0.15, desc: '500 large US companies. An index; invest through a fund that tracks it.' },
  { id: 'index.ixic', symbol: 'IXIC', name: 'Nasdaq Composite', cls: 'index', ex: 'INDEX', exName: 'Index (not directly purchasable)', ccy: 'USD', country: 'US', sector: null, industry: null, start: 13000, drift: 0.14, vol: 0.2, desc: 'All stocks listed on the Nasdaq. An index; not directly purchasable.' },
  { id: 'index.tsx', symbol: 'GSPTSE', name: 'S&P/TSX Composite', cls: 'index', ex: 'INDEX', exName: 'Index (not directly purchasable)', ccy: 'CAD', country: 'CA', sector: null, industry: null, start: 19500, drift: 0.07, vol: 0.13, desc: 'The main Canadian stock index. Not directly purchasable.' },
  { id: 'fx.usdcad', symbol: 'USDCAD', name: 'US dollar / Canadian dollar', cls: 'fx', ex: 'FX', exName: 'Foreign exchange', ccy: 'CAD', country: null, sector: null, industry: null, start: 1.35, drift: 0.005, vol: 0.06, desc: 'Canadian dollars per US dollar.' },
  { id: 'fx.eurusd', symbol: 'EURUSD', name: 'Euro / US dollar', cls: 'fx', ex: 'FX', exName: 'Foreign exchange', ccy: 'USD', country: null, sector: null, industry: null, start: 1.08, drift: 0, vol: 0.07, desc: 'US dollars per euro.' },
];

export function toInstrument(s: Seed): Instrument {
  const tz = s.cls === 'crypto' ? 'UTC' : s.ex === 'XTSE' || s.ex === 'FUND' ? 'America/Toronto' : 'America/New_York';
  return {
    id: s.id, symbol: s.symbol, name: s.name, assetClass: s.cls, exchange: s.ex, exchangeName: s.exName, currency: s.ccy, timezone: tz,
    country: s.country, sector: s.sector, industry: s.industry, tradable: s.cls !== 'index' && s.cls !== 'fx', description: s.desc,
  };
}

const sectorSplit = { Technology: '31.00', Financials: '13.00', 'Health Care': '10.00', 'Consumer Discretionary': '10.00', 'Communication Services': '9.00', Industrials: '9.00', 'Consumer Staples': '6.00', Energy: '5.00' };
const asOf = '2026-09-30';

export const COMPOSITIONS: Record<string, FundComposition> = {
  'arcx.voo': { asOf, coveragePct: '35.40', holdings: [
    { instrumentId: 'xnas.nvda', name: 'NVIDIA', weightPct: '7.10', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.msft', name: 'Microsoft', weightPct: '6.50', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.aapl', name: 'Apple', weightPct: '6.30', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.amzn', name: 'Amazon', weightPct: '3.90', sector: 'Consumer Discretionary', country: 'US' },
    { instrumentId: 'xnas.meta', name: 'Meta Platforms', weightPct: '2.80', sector: 'Communication Services', country: 'US' },
    { instrumentId: 'xnas.googl', name: 'Alphabet', weightPct: '4.00', sector: 'Communication Services', country: 'US' },
    { instrumentId: 'xnas.tsla', name: 'Tesla', weightPct: '1.90', sector: 'Consumer Discretionary', country: 'US' },
    { instrumentId: 'xnys.jpm', name: 'JPMorgan Chase', weightPct: '1.50', sector: 'Financials', country: 'US' },
    { instrumentId: 'xnys.v', name: 'Visa', weightPct: '1.40', sector: 'Financials', country: 'US' },
  ], sectors: sectorSplit, countries: { US: '100.00' } },
  'xtse.vfv': { asOf, coveragePct: '35.40', holdings: [], sectors: sectorSplit, countries: { US: '100.00' } },
  'xnas.qqq': { asOf, coveragePct: '50.10', holdings: [
    { instrumentId: 'xnas.nvda', name: 'NVIDIA', weightPct: '9.20', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.msft', name: 'Microsoft', weightPct: '8.40', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.aapl', name: 'Apple', weightPct: '8.10', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.amzn', name: 'Amazon', weightPct: '5.50', sector: 'Consumer Discretionary', country: 'US' },
    { instrumentId: 'xnas.googl', name: 'Alphabet', weightPct: '5.10', sector: 'Communication Services', country: 'US' },
    { instrumentId: 'xnas.meta', name: 'Meta Platforms', weightPct: '3.70', sector: 'Communication Services', country: 'US' },
    { instrumentId: 'xnas.tsla', name: 'Tesla', weightPct: '2.80', sector: 'Consumer Discretionary', country: 'US' },
    { instrumentId: 'xnas.cost', name: 'Costco', weightPct: '2.50', sector: 'Consumer Staples', country: 'US' },
    { instrumentId: 'xnas.nflx', name: 'Netflix', weightPct: '2.00', sector: 'Communication Services', country: 'US' },
    { instrumentId: 'xnas.amd', name: 'AMD', weightPct: '1.60', sector: 'Technology', country: 'US' },
    { instrumentId: null, name: 'Other Nasdaq-100 companies (not itemized in demo data)', weightPct: '0.00', sector: null, country: 'US' },
  ].filter(h => h.weightPct !== '0.00'), sectors: { Technology: '52.00', 'Communication Services': '15.00', 'Consumer Discretionary': '14.00', 'Consumer Staples': '6.00', 'Health Care': '6.00', Industrials: '5.00' }, countries: { US: '98.00' } },
  'xtse.xeqt': { asOf, coveragePct: '30.20', holdings: [
    { instrumentId: 'xnas.nvda', name: 'NVIDIA', weightPct: '3.20', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.msft', name: 'Microsoft', weightPct: '2.90', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.aapl', name: 'Apple', weightPct: '2.80', sector: 'Technology', country: 'US' },
    { instrumentId: 'xtse.ry', name: 'Royal Bank of Canada', weightPct: '1.90', sector: 'Financials', country: 'CA' },
    { instrumentId: 'xtse.shop', name: 'Shopify', weightPct: '1.30', sector: 'Technology', country: 'CA' },
    { instrumentId: 'xtse.td', name: 'Toronto-Dominion Bank', weightPct: '1.10', sector: 'Financials', country: 'CA' },
    { instrumentId: 'xnas.amzn', name: 'Amazon', weightPct: '1.70', sector: 'Consumer Discretionary', country: 'US' },
    { instrumentId: 'xtse.enb', name: 'Enbridge', weightPct: '0.90', sector: 'Energy', country: 'CA' },
    { instrumentId: null, name: 'Other holdings (not itemized in demo data)', weightPct: '14.40', sector: null, country: null },
  ], sectors: { Technology: '24.00', Financials: '19.00', Industrials: '11.00', 'Consumer Discretionary': '9.00', Energy: '8.00', 'Health Care': '8.00', 'Communication Services': '6.00', Materials: '6.00' }, countries: { US: '45.00', CA: '25.00', 'International developed': '22.00', 'Emerging markets': '7.00' } },
  'xtse.xiu': { asOf, coveragePct: '38.00', holdings: [
    { instrumentId: 'xtse.ry', name: 'Royal Bank of Canada', weightPct: '8.50', sector: 'Financials', country: 'CA' },
    { instrumentId: 'xtse.shop', name: 'Shopify', weightPct: '6.10', sector: 'Technology', country: 'CA' },
    { instrumentId: 'xtse.td', name: 'Toronto-Dominion Bank', weightPct: '5.20', sector: 'Financials', country: 'CA' },
    { instrumentId: 'xtse.enb', name: 'Enbridge', weightPct: '4.60', sector: 'Energy', country: 'CA' },
    { instrumentId: 'xtse.cnr', name: 'Canadian National Railway', weightPct: '3.30', sector: 'Industrials', country: 'CA' },
    { instrumentId: 'xtse.csu', name: 'Constellation Software', weightPct: '3.20', sector: 'Technology', country: 'CA' },
    { instrumentId: 'xtse.su', name: 'Suncor Energy', weightPct: '2.60', sector: 'Energy', country: 'CA' },
    { instrumentId: 'xtse.bce', name: 'BCE', weightPct: '0.70', sector: 'Communication Services', country: 'CA' },
    { instrumentId: null, name: 'Other S&P/TSX 60 companies (not itemized in demo data)', weightPct: '3.80', sector: null, country: 'CA' },
  ], sectors: { Financials: '34.00', Energy: '17.00', Technology: '12.00', Industrials: '12.00', Materials: '11.00', 'Communication Services': '4.00', 'Consumer Staples': '4.00', Utilities: '3.00' }, countries: { CA: '100.00' } },
  'xtse.xaw': { asOf, coveragePct: '18.00', holdings: [
    { instrumentId: 'xnas.nvda', name: 'NVIDIA', weightPct: '4.20', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.msft', name: 'Microsoft', weightPct: '3.80', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.aapl', name: 'Apple', weightPct: '3.70', sector: 'Technology', country: 'US' },
    { instrumentId: null, name: 'Other global companies (not itemized in demo data)', weightPct: '6.30', sector: null, country: null },
  ], sectors: { Technology: '26.00', Financials: '16.00', 'Health Care': '10.00', 'Consumer Discretionary': '11.00', Industrials: '11.00', 'Communication Services': '8.00' }, countries: { US: '62.00', 'International developed': '28.00', 'Emerging markets': '10.00' } },
  'arcx.vti': { asOf, coveragePct: '29.00', holdings: [
    { instrumentId: 'xnas.nvda', name: 'NVIDIA', weightPct: '6.10', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.msft', name: 'Microsoft', weightPct: '5.70', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.aapl', name: 'Apple', weightPct: '5.50', sector: 'Technology', country: 'US' },
    { instrumentId: 'xnas.amzn', name: 'Amazon', weightPct: '3.40', sector: 'Consumer Discretionary', country: 'US' },
    { instrumentId: 'xnas.googl', name: 'Alphabet', weightPct: '3.50', sector: 'Communication Services', country: 'US' },
    { instrumentId: 'xnas.meta', name: 'Meta Platforms', weightPct: '2.40', sector: 'Communication Services', country: 'US' },
    { instrumentId: null, name: 'Other US companies (not itemized in demo data)', weightPct: '2.40', sector: null, country: 'US' },
  ], sectors: sectorSplit, countries: { US: '100.00' } },
  'arcx.schd': { asOf, coveragePct: '21.00', holdings: [
    { instrumentId: 'xnys.ko', name: 'Coca-Cola', weightPct: '4.20', sector: 'Consumer Staples', country: 'US' },
    { instrumentId: 'xnys.pg', name: 'Procter & Gamble', weightPct: '4.10', sector: 'Consumer Staples', country: 'US' },
    { instrumentId: 'xnys.jnj', name: 'Johnson & Johnson', weightPct: '4.00', sector: 'Health Care', country: 'US' },
    { instrumentId: 'xnys.xom', name: 'Exxon Mobil', weightPct: '4.30', sector: 'Energy', country: 'US' },
    { instrumentId: null, name: 'Other dividend payers (not itemized in demo data)', weightPct: '4.40', sector: null, country: 'US' },
  ], sectors: { 'Consumer Staples': '20.00', 'Health Care': '16.00', Energy: '15.00', Financials: '14.00', Industrials: '13.00', Technology: '9.00' }, countries: { US: '100.00' } },
  'xtse.zag': { asOf, coveragePct: '0.00', holdings: [], sectors: { 'Government bonds': '72.00', 'Corporate bonds': '28.00' }, countries: { CA: '100.00' } },
};
// VFV holds the same index as VOO.
COMPOSITIONS['xtse.vfv'] = { ...COMPOSITIONS['arcx.voo'] };
