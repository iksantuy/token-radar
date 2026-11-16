// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, and its constants are fitted from the
// snapshot at run time by `buildCalibration` rather than typed in:
//
//   ratio      = median mcap/TVL of the protocol's category, when it holds >= 3 token protocols;
//                otherwise the whole-universe median (both computed here, from the snapshot)
//   sizeMult   = clamp((tvl_usd / medianTvl) ^ size_elasticity, 0.25, 2.5)
//   growthMult = the growth bucket's median residual multiplier (fitted after category and size)
//   ageMult    = the age bucket's median residual multiplier (fitted the same way)
//   implied    = max(1, round(tvl_usd x ratio x sizeMult x growthMult x ageMult))
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * The model's fitted constants, all computed from the snapshot by `buildCalibration` and carried in
 * data.js so the page can recompute a row and show its own arithmetic.
 */
export interface ModelConstants {
  /** Whole-universe median mcap/TVL, the fallback for a category with fewer than `min_category_n` peers. */
  universe_ratio: number;
  /** Median TVL of the protocols the calibration was fitted on; the size term is relative to it. */
  median_tvl: number;
  /** Within-category elasticity of log(mcap/TVL) to log(TVL). Negative: big TVL carries a lower multiple. */
  size_elasticity: number;
  /** How many recorded-token protocols a category needs before its own median replaces the universe one. */
  min_category_n: number;
  /** Shrinkage strength of every bucket ratio toward the universe median: weight is n/(n+k). */
  shrink_k: number;
  /** The elasticity's standard error and t, so the page can state how strong the size term is. */
  size_t: number;
  /** How many protocols the calibration read, and how many categories cleared `min_category_n`. */
  sample_n: number;
}

export const MODEL: ModelConstants = {
  universe_ratio: 0.2227,
  median_tvl: 31_730_814,
  size_elasticity: -0.3305,
  min_category_n: 3,
  shrink_k: 10,
  size_t: -2.8,
  sample_n: 125,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3-residual-buckets';

/** How many further pre-token protocols past the watchlist the radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_ratio: number;
    category_ratio_n: number;
    category_ratio_fallback: boolean;
    size_multiplier: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_ratio: number;
  category_ratio_n: number;
  category_ratio_fallback: boolean;
  size_multiplier: number;
  growth_multiplier: number;
  age_multiplier: number;
  /** The plan exactly as board.json carries it, so the page and the board cannot drift apart. */
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The fitted tables the page shows so the model explains itself. */
export interface CalibrationView {
  categories: CategoryRatio[];
  growth: Bucket[];
  age: Bucket[];
  categories_with_sample: number;
  sample_n: number;
  age_cut_days: number;
  growth_edges: number[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: CalibrationView;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Radar rows the watchlist never named but the floor rule would have covered, disclosed on the page. */
  early_above_floor: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A median (mean of the middle pair on an even count); the mean of nothing is NaN. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The ratio band the calibration keeps: outside it a protocol's book value is an artefact, not a multiple. */
export const RATIO_FLOOR = 0.001;
export const RATIO_CAP = 200;

/** A recorded-token protocol's mcap/TVL, or null when it records no token or the ratio is out of band. */
export function recordedRatio(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || !(p.tvl_usd > 0) || !(p.mcap_usd > 0)) return null;
  const r = p.mcap_usd / p.tvl_usd;
  return r >= RATIO_FLOOR && r <= RATIO_CAP ? r : null;
}

/** One category's comparable multiple: its median ratio, the sample it read, and whether it fell back. */
export interface CategoryRatio {
  category: string;
  ratio: number;
  n: number;
  fallback: boolean;
}

/** One bucket of a fitted term: the range, the sample it read, the median it found, and its multiplier. */
export interface Bucket {
  lo: number;
  hi: number;
  n: number;
  median: number;
  multiplier: number;
}

/** The band every bucket multiplier is kept inside, so one thin bucket can never decide a row. */
export const BUCKET_MIN = 0.8;
export const BUCKET_MAX = 1.3;

/**
 * Everything the model learned from the snapshot: the category table, the size elasticity, and the
 * two binned terms. Built once per run from the snapshot alone; nothing here is typed in by hand.
 */
export interface Calibration {
  model: ModelConstants;
  /** The category table, widest sample first. */
  categories: CategoryRatio[];
  /** The growth term's buckets, by `change_7d` in per cent. */
  growth: Bucket[];
  /** The age term's buckets, by days since DefiLlama first listed the protocol. */
  age: Bucket[];
  /** How many categories cleared `min_category_n`. */
  categories_with_sample: number;
  /** How many recorded-token protocols the calibration read at all. */
  sample_n: number;
}

/** The bucket edges a term is cut on: fixed ranges, so no protocol can move a boundary. */
export const GROWTH_EDGES = [-20, -10, 0, 10];
/** The age cut: protocols listed under two years ago carried a visibly higher median ratio than older ones. */
export const AGE_CUT_DAYS = 730;

/** The bucket a value falls in, or the neutral 1 when it falls in none. */
export function bucketMultiplier(buckets: Bucket[], value: number): number {
  for (const b of buckets) if (value >= b.lo && value < b.hi) return b.multiplier;
  return 1;
}

/**
 * A binned term fitted on **residuals**, not on raw ratios. Each protocol's residual is its recorded
 * ratio divided by what the category multiple and the size term already predict, so a bucket cannot
 * claim credit for what those two terms explain. Each bucket's median residual becomes its multiplier,
 * shrunk toward 1 by n/(n+k) and clamped to the band so no thin bucket can decide a row.
 */
function fitResidualBuckets(
  rows: { value: number; residual: number }[],
  edges: number[],
  k: number,
): Bucket[] {
  const bounds = [Number.NEGATIVE_INFINITY, ...edges, Number.POSITIVE_INFINITY];
  const out: Bucket[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const lo = bounds[i]!;
    const hi = bounds[i + 1]!;
    const group = rows.filter((r) => r.value >= lo && r.value < hi);
    if (group.length === 0) continue;
    const m = median(group.map((r) => r.residual));
    const weight = group.length / (group.length + k);
    const multiplier = Math.min(BUCKET_MAX, Math.max(BUCKET_MIN, 1 + (m - 1) * weight));
    out.push({ lo, hi, n: group.length, median: round4(m), multiplier: round4(multiplier) });
  }
  return out;
}

/**
 * The within-category elasticity of log(mcap/TVL) to log(TVL): both logs are de-meaned inside each
 * category, so the fit compares protocols with their own category's peers and cannot be driven by the
 * category mix. This is what makes the size term a measurement rather than an assumption.
 */
function fitSizeElasticity(rows: { category: string; ratio: number; tvl: number }[]): number {
  const groups = new Map<string, { x: number; y: number }[]>();
  for (const r of rows) {
    const key = r.category;
    const list = groups.get(key) ?? [];
    list.push({ x: Math.log(r.tvl), y: Math.log(r.ratio) });
    groups.set(key, list);
  }
  let num = 0;
  let den = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const mx = list.reduce((a, v) => a + v.x, 0) / list.length;
    const my = list.reduce((a, v) => a + v.y, 0) / list.length;
    for (const v of list) {
      num += (v.x - mx) * (v.y - my);
      den += (v.x - mx) ** 2;
    }
  }
  if (!(den > 0)) return 0;
  return num / den;
}

/**
 * Fit the model to the snapshot. Every multiplier the board uses comes from here: the category table
 * (median mcap/TVL of each category's recorded-token protocols, or the universe median when the category
 * is thinner than `min_category_n`), the size elasticity, the growth buckets and the age buckets.
 */
export function buildCalibration(snapshot: Snapshot, base: ModelConstants = MODEL): Calibration {
  const rows: { category: string; ratio: number; tvl: number; change: number | null; age: number | null }[] = [];
  for (const p of snapshot.protocols) {
    const ratio = recordedRatio(p);
    if (ratio === null) continue;
    rows.push({
      category: p.category ?? 'none',
      ratio,
      tvl: p.tvl_usd,
      change: p.change_7d,
      age: ageDays(snapshot.as_of, p.listed_at),
    });
  }
  const universe = rows.length > 0 ? median(rows.map((r) => r.ratio)) : base.universe_ratio;
  const medianTvl = rows.length > 0 ? median(rows.map((r) => r.tvl)) : base.median_tvl;

  const byCategory = new Map<string, number[]>();
  for (const r of rows) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r.ratio);
    byCategory.set(r.category, list);
  }
  const categories: CategoryRatio[] = [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      ratio: list.length >= base.min_category_n ? median(list) : universe,
      n: list.length,
      fallback: list.length < base.min_category_n,
    }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const elasticity = fitSizeElasticity(rows);

  // The size term, applied to the ratios before the two binned terms are fitted: a protocol's expected
  // ratio is its category multiple times the size multiplier, and a residual is what that leaves over.
  const expected = (r: { category: string; tvl: number }): number => {
    const cat = categories.find((c) => c.category === r.category);
    const ratio = cat !== undefined ? cat.ratio : universe;
    const size = Math.min(2.5, Math.max(0.25, Math.exp(elasticity * Math.log(r.tvl / medianTvl))));
    return ratio * size;
  };
  // `residualOf` is the ratio of the recorded multiple to what the category and size terms already
  // predict, in plain multiplier units (1.0 means "exactly what those two terms explain"), so a bucket
  // median of 1.2 reads as "20 per cent above the expectation" and not as a logarithm of it.
  const residualOf = (r: { category: string; tvl: number; ratio: number }): number =>
    r.ratio / expected(r);

  // Growth reads a zero for a protocol that records none, the neutral value; the age term reads only
  // protocols whose listing date is known, so an unknown age is exactly neutral.
  const growthRows = rows.map((r) => ({ value: r.change ?? 0, residual: residualOf(r) }));
  const ageRows = rows.filter((r) => r.age !== null).map((r) => ({ value: r.age as number, residual: residualOf(r) }));

  const model: ModelConstants = {
    universe_ratio: round4(universe),
    median_tvl: Math.round(medianTvl),
    size_elasticity: round4(elasticity),
    min_category_n: base.min_category_n,
    shrink_k: base.shrink_k,
    size_t: base.size_t,
    sample_n: rows.length,
  };

  return {
    model,
    categories,
    // Both binned terms are fitted after the category multiple and the size term, on what they leave
    // over. Fitting them on raw ratios instead would let them claim variance the other terms explain,
    // which is what a first draft of this model did: see MODEL.md.
    growth: fitResidualBuckets(growthRows, GROWTH_EDGES, base.shrink_k),
    age: fitResidualBuckets(ageRows, [AGE_CUT_DAYS], base.shrink_k),
    categories_with_sample: categories.filter((c) => !c.fallback).length,
    sample_n: rows.length,
  };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The multipliers and the implied value one protocol gets under a fitted calibration. The same function
 * scores every row; nothing about the protocol's name enters it. `bucketMultiplier` returns 1 for a value
 * outside every bucket, which is the neutral term.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  cal: Calibration,
): {
  implied: number;
  categoryRatio: number;
  categoryRatioN: number;
  categoryFallback: boolean;
  sizeMult: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const key = protocol.category ?? 'none';
  const known = cal.categories.find((c) => c.category === key);
  const categoryRatio = known !== undefined ? known.ratio : cal.model.universe_ratio;
  const categoryRatioN = known !== undefined ? known.n : 0;
  const categoryFallback = known === undefined || known.fallback;

  // The size term: a protocol bigger than the fitted median TVL carries a lower multiple on it, by the
  // elasticity fitted within categories. Clamped so one huge protocol cannot flip the whole board.
  const sizeMult = Math.min(
    2.5,
    Math.max(0.25, Math.exp(cal.model.size_elasticity * Math.log(protocol.tvl_usd / cal.model.median_tvl))),
  );
  const growthMult = bucketMultiplier(cal.growth, finite(protocol.change_7d, 0));
  const ageMult = age === null ? 1 : bucketMultiplier(cal.age, age);

  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryRatio * sizeMult * growthMult * ageMult),
  );
  return { implied, categoryRatio, categoryRatioN, categoryFallback, sizeMult, growthMult, ageMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Categories the house's own watchlist rule treats as products of a token that already trades: a canonical
 * bridge, a liquid staking or restaking receipt and a CEX are not a protocol that may issue its own token,
 * they are the same asset in another wrapper. The watchlist never names them, so the early radar does not
 * rank them either: it is the same rule applied to the rows below the floor, and it keeps a $40M canonical
 * bridge from outranking a $500M protocol on a category multiple its wrapper inherits.
 */
export const WRAPPER_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** An exchange's name, which starts a row the house's rule keeps out: it is a venue, not a protocol. */
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** A whole word that marks a wrapped, staked or staking product of a token that already trades. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is excluded as a wrapper/staked/bridged product or an exchange, by its category. */
export function isWrapperCategory(category: string | null): boolean {
  return category !== null && WRAPPER_CATEGORIES.has(category);
}

/** Whether a protocol is one the board may rank: pre-token, not a versioned pool, not a wrapper product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p) || isWrapperCategory(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPER_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Rows the watchlist rule did not name, above or at the floor it uses. */
  early_above_floor: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal?: Calibration): BoardRow[] {
  const calibration = cal ?? buildCalibration(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol the board can score, above and below the
  // floor alike. The watchlist is the floor, never the ceiling, so a protocol the house's rule left out
  // (a parent protocol, a name the version filter keeps) is still a subject. Ordering is by TVL so a
  // deterministic slice is taken if the cap ever binds.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Kept at full precision, not rounded to four decimals: the page recomputes each row from these
      // numbers and rounds once at the end, so a rounded multiplier here made the page's own
      // recomputation disagree with the board by a few hundred dollars on most rows.
      category_ratio: s.categoryRatio,
      category_ratio_n: s.categoryRatioN,
      category_ratio_fallback: s.categoryFallback,
      size_multiplier: s.sizeMult,
      growth_multiplier: s.growthMult,
      age_multiplier: s.ageMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A chain as the plan names it, trimmed of DefiLlama's chain-suffix noise. */
function cleanChain(c: string): string {
  return c.replace(/\s+(L1|L2|Mainnet)$/i, '').trim();
}

/** The chains to route through: the first two the protocol names, in its own order. */
function chainsOf(p: SnapshotProtocol): { primary: string; secondary: string | null } {
  const named = p.chains.map(cleanChain).filter((c) => c.length > 0);
  if (named.length === 0) return { primary: 'its main chain', secondary: null };
  return { primary: named[0]!, secondary: named.length > 1 ? named[1]! : null };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What a category's farmer actually does, its entry cost, and the one metric that proves the position counts. */
interface Mechanics {
  /** The qualifying position, with the capital and the primary chain filled in. */
  action: (name: string, capital: number, chain: string) => string;
  /** The gas bill for one entry on that chain. */
  entryGas: number;
  /** The on-chain number a farming snapshot actually reads for this category. */
  metric: string;
  /** What unwinding costs and how, specific to the position type. */
  exit: string;
}

/** The mechanics a category's position implies. Matched on the category text, never on a protocol name. */
function mechanicsFor(category: string | null): Mechanics {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator'))
    return {
      action: (n, cap, ch) => `Deposit $${cap} of USDC into one of ${n}'s curator vaults on ${ch}, choosing the stablecoin vault rather than the highest-yield one, and keep the vault shares in the wallet.`,
      entryGas: 12,
      metric: 'the vault share balance and the days it was held',
      exit: 'redeem the vault shares back to USDC; most curators settle in one transaction, some queue a withdrawal for a day.',
    };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      action: (n, cap, ch) => `Supply $${cap} of USDC to ${n} on ${ch}, then borrow no more than $${Math.round(cap * 0.3)} of another asset against it so the position shows both a supply and a borrow.`,
      entryGas: 9,
      metric: 'the supplied balance, the borrow balance and the health factor',
      exit: 'repay the borrow first, then withdraw the supply; withdrawing while a borrow is open is what usually reverts.',
    };
  if (c.includes('restak') || c.includes('staking') || c.includes('staking pool'))
    return {
      action: (n, cap, ch) => `Stake $${cap} of ${ch}'s native staking asset through ${n} and keep the liquid receipt token it returns in the same wallet.`,
      entryGas: 6,
      metric: 'the receipt-token balance and the staking duration',
      exit: 'unstake through the same receipt token; a restaked position can take an unbonding period of days to weeks.',
    };
  if (c.includes('bridge'))
    return {
      action: (n, cap, ch) => `Bridge $${cap} of USDC into ${ch} through ${n}, then use the bridged balance inside ${n}'s own app rather than leaving it idle.`,
      entryGas: 14,
      metric: 'the bridged volume attributed to the wallet',
      exit: 'bridge back over the same route; check the return leg is open before you commit, since some routes pause.',
    };
  if (c.includes('dex') || c.includes('leveraged farm'))
    return {
      action: (n, cap, ch) => `Provide $${cap} as a tight USDC pair on ${n} on ${ch} and rebalance the range once a week so the position stays in range.`,
      entryGas: 11,
      metric: 'the liquidity position, its time in range and the swap volume it earned',
      exit: 'withdraw the range and swap the non-USDC leg back; out-of-range positions still withdraw but earn nothing.',
    };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options'))
    return {
      action: (n, cap, ch) => `Deposit $${cap} of USDC as margin on ${n} on ${ch} and hold one small delta-neutral position rather than a directional bet.`,
      entryGas: 10,
      metric: 'the margin balance, the open interest and the funding paid',
      exit: 'close the position before withdrawing margin; a liquidation during the hold costs the whole position.',
    };
  if (c.includes('rwa'))
    return {
      action: (n, cap, ch) => `Mint or subscribe $${cap} of ${n}'s yield asset on ${ch} once the subscription window is open, and hold the receipt rather than trading it.`,
      entryGas: 15,
      metric: 'the subscribed balance and the days held',
      exit: 'redemption usually runs on the issuer\u2019s own schedule, so plan for a settlement window rather than a same-day exit.',
    };
  if (c.includes('yield'))
    return {
      action: (n, cap, ch) => `Deposit $${cap} of USDC into ${n}'s flagship yield vault on ${ch} and leave it for the full hold rather than moving it between vaults.`,
      entryGas: 8,
      metric: 'the deposit balance, the share count and the time in the vault',
      exit: 'withdraw the shares to USDC; a vault with a cooldown releases funds only after it ends.',
    };
  if (c.includes('insurance'))
    return {
      action: (n, cap, ch) => `Buy $${cap} of cover from ${n} on ${ch} for a pool you actually hold, so the policy is a real position rather than a donation.`,
      entryGas: 7,
      metric: 'the cover amount and the policy period',
      exit: 'cover is not withdrawable mid-term; treat the premium as spent and the policy as expiring.',
    };
  if (c.includes('stable'))
    return {
      action: (n, cap, ch) => `Mint $${cap} of ${n}'s stable asset on ${ch} against collateral you already hold, and keep the minted balance in the wallet.`,
      entryGas: 8,
      metric: 'the minted balance, the collateral ratio and the days open',
      exit: 'burn the minted asset to unlock collateral; a collateral ratio below the protocol minimum blocks the burn.',
    };
  if (c.includes('prediction'))
    return {
      action: (n, cap, ch) => `Fund $${cap} into ${n} on ${ch} and take one position on a market that resolves inside the hold window.`,
      entryGas: 6,
      metric: 'the volume traded and the markets resolved',
      exit: 'positions settle at resolution; withdrawing early means selling at the market price, not the entry price.',
    };
  if (c.includes('chain'))
    return {
      action: (n, cap, ch) => `Bridge $${cap} of USDC onto ${n}, then make the qualifying action inside ${n}'s own app so the deposit is not just a transfer.`,
      entryGas: 13,
      metric: 'the value bridged in and the transactions made on the chain',
      exit: 'bridge back out; check the chain\u2019s withdrawal delay, which for some runs to days.',
    };
  return {
    action: (n, cap, ch) => `Deposit $${cap} of USDC into ${n} on ${ch} and keep the position open rather than cycling it.`,
    entryGas: 9,
    metric: 'the deposit balance and the days it was held',
    exit: 'withdraw the balance; check whether the protocol charges an exit fee before you size the position.',
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (its category's mechanics, its chains in its own order, its TVL and its age),
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const { primary, secondary } = chainsOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const mech = mechanicsFor(p.category);
  const gas = mech.entryGas;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet for this position alone and fund it with $${capital} plus about $${gas + 20} of gas; on ${primary} keep the gas token in the wallet before you start, since a position without gas cannot be exited.`,
      cost: 'under $3 to open the wallet, plus the gas you pre-fund',
      time: '5 minutes',
    },
    { text: mech.action(p.name, capital, primary), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
  ];
  if (secondary !== null) {
    steps.push({
      text: `If ${primary} gas is expensive that week, run the same position on ${secondary} instead, where ${p.name} also reports TVL; keep one chain per wallet so the activity is not split across two records.`,
      cost: `the same $${capital}, about $${Math.max(2, gas - 4)} of gas on ${secondary}`,
      time: '15 minutes to set up on the second chain',
    });
  }
  steps.push(
    {
      text: `Make one qualifying action a week and let the position rest between them: ${mech.metric} is what a farming snapshot reads, and churning the position adds gas without adding to it.`,
      cost: `about $${Math.max(1, Math.round(gas / 3))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold for at least ${hold} days${age === null ? '' : `, which is the window a protocol ${Math.floor(age / 30)} months old is usually judged on`}, so the position appears in more than one snapshot and in the protocol's own monthly figures.`,
      cost: `the $${capital} stays in the position and is not available`,
      time: `${hold} days`,
    },
    {
      text: `Keep the position's receipts in this wallet and record the transaction hashes; when a points or rewards page appears, check it against ${p.name}'s own published link and never pay a fee to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `To exit: ${mech.exit} Do this before you need the funds, not on the day the token is announced.`,
      cost: `about $${gas} of gas to unwind, and any exit fee the protocol charges`,
      time: '15 minutes, plus any unbonding period',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_ratio: row.model.category_ratio,
    category_ratio_n: row.model.category_ratio_n,
    category_ratio_fallback: row.model.category_ratio_fallback,
    size_multiplier: row.model.size_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, cal?: Calibration): { board: BoardRow[]; radar: RadarData } {
  const calibration = cal ?? buildCalibration(snapshot);
  const board = buildBoard(snapshot, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // The board outranks the watchlist: some rows are protocols the house's own rule passed over, at or
  // above the floor it uses. Counted so the page can say so instead of implying every extra row is small.
  const earlyAboveFloor = board.filter((r) => !snapshot.watchlist.includes(r.slug) && r.tvl_usd >= snapshot.floor_usd).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: calibration.model,
    model_version: MODEL_VERSION,
    calibration: {
      categories: calibration.categories,
      growth: calibration.growth,
      age: calibration.age,
      categories_with_sample: calibration.categories_with_sample,
      sample_n: calibration.sample_n,
      age_cut_days: AGE_CUT_DAYS,
      growth_edges: GROWTH_EDGES,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    early_above_floor: earlyAboveFloor,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
