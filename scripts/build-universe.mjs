// Builds src/server/data/universe.gen.ts: every instrument Markets can find.
//   US stocks and ETFs: Nasdaq Trader symbol directory (nasdaqlisted.txt, otherlisted.txt), public files.
//   Canada: a curated list of TSX stocks and ETFs (below); no free official list with clear reuse terms.
//   Crypto: CoinGecko's top coins by market cap (keyless API, attribution shown in the app).
// Run: node scripts/build-universe.mjs   (needs network; the output is committed)
import { writeFileSync, mkdirSync } from 'node:fs';

const get = async (url) => { const r = await fetch(url, { headers: { 'user-agent': 'markets-universe-builder/1.0' } }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); };

const MIC = { Q: 'XNAS', N: 'XNYS', A: 'XASE', P: 'ARCX', Z: 'BATS' };
const EXCLUDE = /\bwarrants?\b|\brights?\b|\bunits?\b|preferred|\d(\.\d+)?\s?%|\bnotes? due\b|debentures?|subordinated|\bperpetual\b|contingent value|\bwhen.issued\b|test issue/i;

function cleanName(raw, etf) {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (etf) return s;
  s = s.replace(/\s*-?\s*American Depositary (Shares|Receipts?).*$/i, ' (ADR)')
    .replace(/\s*-?\s*Class ([A-Z]) (Common Stock|Ordinary Shares|Common Shares|Subordinate Voting Shares|Shares).*$/i, ' Class $1')
    .replace(/\s*-?\s*(Common Stock|Common Shares|Ordinary Shares|Common Units|Shares of Beneficial Interest|Units representing limited partner interests|Limited Partnership Units|New York Registry Shares|Registered Shares|Ordinary Share)\b.*$/i, '')
    .replace(/\s*-\s*$/, '').replace(/\s+New$/i, '').trim();
  return s;
}

const rows = [];
const seen = new Set();
const add = (ex, sym, name, cls, rank, extra = '') => {
  const key = `${ex}|${sym}`; if (seen.has(key)) return; seen.add(key);
  rows.push([ex, sym, name.replace(/\|/g, '/'), cls, rank, extra].join('|'));
};

// ---- US: Nasdaq-listed ----
const nasdaq = (await get('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt')).split('\n').slice(1);
for (const line of nasdaq) {
  const [sym, name, cat, test, , , etf] = line.split('|');
  if (!sym || !name || test !== 'N' || /[$^=]/.test(sym) || line.startsWith('File Creation')) continue;
  const isEtf = etf === 'Y';
  if (!isEtf && EXCLUDE.test(name)) continue;
  if (isEtf && /\bwarrants?\b|\brights?\b/i.test(name)) continue;
  // Rank: Global Select first, then Global Market, then Capital Market.
  const rank = cat === 'Q' ? 2 : cat === 'G' ? 3 : 4;
  add('Q', sym, cleanName(name, isEtf), isEtf ? 'e' : 's', rank);
}

// ---- US: NYSE, NYSE American, NYSE Arca, Cboe BZX ----
const other = (await get('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt')).split('\n').slice(1);
for (const line of other) {
  const [sym, name, exch, , etf, , test] = line.split('|');
  if (!sym || !name || test !== 'N' || !MIC[exch] || /[$^=]/.test(sym) || line.startsWith('File Creation')) continue;
  const isEtf = etf === 'Y';
  if (!isEtf && EXCLUDE.test(name)) continue;
  if (isEtf && /\bwarrants?\b|\brights?\b/i.test(name)) continue;
  const rank = exch === 'N' ? 2 : exch === 'P' ? 3 : 4;
  add(exch, sym, cleanName(name, isEtf), isEtf ? 'e' : 's', rank);
}

// ---- Canada (TSX) ----
const TSX_STOCKS = [
  ['ATD', 'Alimentation Couche-Tard Inc.'], ['BN', 'Brookfield Corporation'], ['BAM', 'Brookfield Asset Management Ltd.'], ['BIP.UN', 'Brookfield Infrastructure Partners L.P.'],
  ['BEP.UN', 'Brookfield Renewable Partners L.P.'], ['BNS', 'The Bank of Nova Scotia'], ['BMO', 'Bank of Montreal'], ['CM', 'Canadian Imperial Bank of Commerce'],
  ['NA', 'National Bank of Canada'], ['MFC', 'Manulife Financial Corporation'], ['SLF', 'Sun Life Financial Inc.'], ['GWO', 'Great-West Lifeco Inc.'],
  ['IFC', 'Intact Financial Corporation'], ['POW', 'Power Corporation of Canada'], ['FFH', 'Fairfax Financial Holdings Limited'], ['X', 'TMX Group Limited'],
  ['EQB', 'EQB Inc.'], ['IAG', 'iA Financial Corporation Inc.'], ['IGM', 'IGM Financial Inc.'], ['GSY', 'goeasy Ltd.'], ['SII', 'Sprott Inc.'], ['ONEX', 'Onex Corporation'],
  ['CP', 'Canadian Pacific Kansas City Limited'], ['TRI', 'Thomson Reuters Corporation'], ['WCN', 'Waste Connections, Inc.'], ['CNQ', 'Canadian Natural Resources Limited'],
  ['CVE', 'Cenovus Energy Inc.'], ['IMO', 'Imperial Oil Limited'], ['TOU', 'Tourmaline Oil Corp.'], ['ARX', 'ARC Resources Ltd.'], ['TRP', 'TC Energy Corporation'],
  ['PPL', 'Pembina Pipeline Corporation'], ['KEY', 'Keyera Corp.'], ['ALA', 'AltaGas Ltd.'], ['WCP', 'Whitecap Resources Inc.'], ['BTE', 'Baytex Energy Corp.'],
  ['FTS', 'Fortis Inc.'], ['EMA', 'Emera Incorporated'], ['H', 'Hydro One Limited'], ['AQN', 'Algonquin Power & Utilities Corp.'], ['NPI', 'Northland Power Inc.'],
  ['CU', 'Canadian Utilities Limited'], ['CPX', 'Capital Power Corporation'], ['TA', 'TransAlta Corporation'], ['ACO.X', 'ATCO Ltd.'],
  ['T', 'TELUS Corporation'], ['RCI.B', 'Rogers Communications Inc. Class B'], ['QBR.B', 'Quebecor Inc. Class B'], ['NTR', 'Nutrien Ltd.'],
  ['ABX', 'Barrick Mining Corporation'], ['AEM', 'Agnico Eagle Mines Limited'], ['WPM', 'Wheaton Precious Metals Corp.'], ['FNV', 'Franco-Nevada Corporation'],
  ['K', 'Kinross Gold Corporation'], ['TECK.B', 'Teck Resources Limited Class B'], ['FM', 'First Quantum Minerals Ltd.'], ['CCO', 'Cameco Corporation'],
  ['IVN', 'Ivanhoe Mines Ltd.'], ['LUN', 'Lundin Mining Corporation'], ['AGI', 'Alamos Gold Inc.'], ['BTO', 'B2Gold Corp.'], ['ELD', 'Eldorado Gold Corporation'],
  ['PAAS', 'Pan American Silver Corp.'], ['NGD', 'New Gold Inc.'], ['OR', 'OR Royalties Inc.'], ['EDV', 'Endeavour Mining plc'], ['CS', 'Capstone Copper Corp.'],
  ['HBM', 'Hudbay Minerals Inc.'], ['MX', 'Methanex Corporation'], ['L', 'Loblaw Companies Limited'], ['MRU', 'Metro Inc.'], ['DOL', 'Dollarama Inc.'],
  ['WN', 'George Weston Limited'], ['CTC.A', 'Canadian Tire Corporation, Limited Class A'], ['GIL', 'Gildan Activewear Inc.'], ['QSR', 'Restaurant Brands International Inc.'],
  ['MG', 'Magna International Inc.'], ['DOO', 'BRP Inc.'], ['ATZ', 'Aritzia Inc.'], ['SAP', 'Saputo Inc.'], ['EMP.A', 'Empire Company Limited Class A'],
  ['PBH', 'Premium Brands Holdings Corporation'], ['NWC', 'The North West Company Inc.'], ['MTY', 'MTY Food Group Inc.'], ['LSPD', 'Lightspeed Commerce Inc.'],
  ['OTEX', 'Open Text Corporation'], ['GIB.A', 'CGI Inc. Class A'], ['DSG', 'The Descartes Systems Group Inc.'], ['KXS', 'Kinaxis Inc.'], ['BB', 'BlackBerry Limited'],
  ['CLS', 'Celestica Inc.'], ['TOI', 'Topicus.com Inc.'], ['LMN', 'Lumine Group Inc.'], ['WELL', 'WELL Health Technologies Corp.'], ['WSP', 'WSP Global Inc.'],
  ['STN', 'Stantec Inc.'], ['TIH', 'Toromont Industries Ltd.'], ['CAE', 'CAE Inc.'], ['AC', 'Air Canada'], ['TFII', 'TFI International Inc.'],
  ['BBD.B', 'Bombardier Inc. Class B'], ['WFG', 'West Fraser Timber Co. Ltd.'], ['CCL.B', 'CCL Industries Inc. Class B'], ['ATRL', 'AtkinsRéalis Group Inc.'],
  ['ARE', 'Aecon Group Inc.'], ['FTT', 'Finning International Inc.'], ['SJ', 'Stella-Jones Inc.'], ['RBA', 'RB Global, Inc.'], ['FSV', 'FirstService Corporation'],
  ['CIGI', 'Colliers International Group Inc.'], ['CAR.UN', 'Canadian Apartment Properties REIT'], ['REI.UN', 'RioCan Real Estate Investment Trust'],
  ['GRT.UN', 'Granite Real Estate Investment Trust'], ['CHP.UN', 'Choice Properties Real Estate Investment Trust'], ['SRU.UN', 'SmartCentres Real Estate Investment Trust'],
  ['DIR.UN', 'Dream Industrial Real Estate Investment Trust'],
];
const TSX_ETFS = [
  ['VEQT', 'Vanguard All-Equity ETF Portfolio'], ['VGRO', 'Vanguard Growth ETF Portfolio'], ['VBAL', 'Vanguard Balanced ETF Portfolio'], ['XGRO', 'iShares Core Growth ETF Portfolio'],
  ['XBAL', 'iShares Core Balanced ETF Portfolio'], ['ZEQT', 'BMO All-Equity ETF'], ['ZGRO', 'BMO Growth ETF'], ['HXT', 'Global X S&P/TSX 60 Index Corporate Class ETF'],
  ['XIC', 'iShares Core S&P/TSX Capped Composite Index ETF'], ['VCN', 'Vanguard FTSE Canada All Cap Index ETF'], ['ZCN', 'BMO S&P/TSX Capped Composite Index ETF'],
  ['XUS', 'iShares Core S&P 500 Index ETF'], ['XUU', 'iShares Core S&P U.S. Total Market Index ETF'], ['ZSP', 'BMO S&P 500 Index ETF'],
  ['HXS', 'Global X S&P 500 Index Corporate Class ETF'], ['VUN', 'Vanguard U.S. Total Market Index ETF'], ['XSP', 'iShares Core S&P 500 Index ETF (CAD-Hedged)'],
  ['ZQQ', 'BMO Nasdaq 100 Equity Hedged to CAD Index ETF'], ['QQC', 'Invesco NASDAQ 100 Index ETF'], ['XQQ', 'iShares NASDAQ 100 Index ETF (CAD-Hedged)'],
  ['HXQ', 'Global X NASDAQ-100 Index Corporate Class ETF'], ['VXC', 'Vanguard FTSE Global All Cap ex Canada Index ETF'], ['XEF', 'iShares Core MSCI EAFE IMI Index ETF'],
  ['VIU', 'Vanguard FTSE Developed All Cap ex North America Index ETF'], ['XEC', 'iShares Core MSCI Emerging Markets IMI Index ETF'], ['VEE', 'Vanguard FTSE Emerging Markets All Cap Index ETF'],
  ['ZDV', 'BMO Canadian Dividend ETF'], ['VDY', 'Vanguard FTSE Canadian High Dividend Yield Index ETF'], ['XEI', 'iShares S&P/TSX Composite High Dividend Index ETF'],
  ['CDZ', 'iShares S&P/TSX Canadian Dividend Aristocrats Index ETF'], ['ZWC', 'BMO Canadian High Dividend Covered Call ETF'], ['ZWB', 'BMO Covered Call Canadian Banks ETF'],
  ['ZEB', 'BMO Equal Weight Banks Index ETF'], ['XFN', 'iShares S&P/TSX Capped Financials Index ETF'], ['XEG', 'iShares S&P/TSX Capped Energy Index ETF'],
  ['XIT', 'iShares S&P/TSX Capped Information Technology Index ETF'], ['XRE', 'iShares S&P/TSX Capped REIT Index ETF'], ['VAB', 'Vanguard Canadian Aggregate Bond Index ETF'],
  ['XBB', 'iShares Core Canadian Universe Bond Index ETF'], ['CASH', 'Global X High Interest Savings ETF'], ['PSA', 'Purpose High Interest Savings Fund'],
  ['ZMMK', 'BMO Money Market Fund ETF Series'], ['CBIL', 'Global X 0-3 Month T-Bill ETF'], ['TEC', 'TD Global Technology Leaders Index ETF'],
];
for (const [s, n] of TSX_STOCKS) add('T', s, n, 's', 2);
for (const [s, n] of TSX_ETFS) add('T', s, n, 'e', 2);

// ---- Crypto (CoinGecko top coins) ----
const coins = JSON.parse(await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1'));
const cryptoSyms = new Set();
for (const c of coins) {
  if (/wrapped|bridged|staked|\bliquid staking\b/i.test(c.name)) continue;
  const sym = c.symbol.toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(sym) || cryptoSyms.has(sym)) continue;
  cryptoSyms.add(sym);
  add('C', sym, c.name, 'c', c.market_cap_rank ?? 999, c.id);
}

// ---- FX (ECB reference rates via Frankfurter) ----
const FX = [['USDCAD', 'US dollar / Canadian dollar'], ['EURUSD', 'Euro / US dollar'], ['GBPUSD', 'British pound / US dollar'], ['USDJPY', 'US dollar / Japanese yen'],
  ['AUDUSD', 'Australian dollar / US dollar'], ['USDCHF', 'US dollar / Swiss franc'], ['EURCAD', 'Euro / Canadian dollar'], ['GBPCAD', 'British pound / Canadian dollar'],
  ['CADJPY', 'Canadian dollar / Japanese yen'], ['USDMXN', 'US dollar / Mexican peso'], ['USDCNY', 'US dollar / Chinese yuan'], ['USDINR', 'US dollar / Indian rupee']];
for (const [s, n] of FX) add('X', s, n, 'x', 1);

mkdirSync(new URL('../src/server/data/', import.meta.url), { recursive: true });
const out = `// Generated by scripts/build-universe.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.
// One instrument per line: exchange|symbol|name|class|rank|extra
// exchange: Q Nasdaq, N NYSE, A NYSE American, P NYSE Arca, Z Cboe BZX, T TSX, C crypto, X FX
// class: s stock, e ETF, c crypto, x FX. rank: lower is more prominent. extra: CoinGecko id for crypto.
export const UNIVERSE = ${JSON.stringify(rows.join('\n'))};
`;
writeFileSync(new URL('../src/server/data/universe.gen.ts', import.meta.url), out);
console.log(`${rows.length} instruments, ${(out.length / 1024).toFixed(0)} KB`);
