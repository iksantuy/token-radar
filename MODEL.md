# The radar's model

Status: **stage 3** (second model revision). Stage 1 was measured, not changed: 200 rows, watchlist
complete, one flat 0.25x multiple of TVL for every protocol, top row `steakhouse-financial` at
$543,636,080. Stage 2 replaced the flat multiple with category medians plus a fitted size term; it is
described below and then corrected, because its growth and age terms were fitted wrongly.

## Why the flat multiple is wrong

The starter multiplies every protocol's TVL by 0.25. The snapshot itself says categories are not alike.
Market cap to TVL, among the 125 protocols that already record a token (ratio kept between 0.001 and
200 so a near-zero book doesn't blow the median up):

| category | n | p25 | median | p75 |
|---|---|---|---|---|
| Lending | 15 | 0.033 | 0.132 | 1.027 |
| Dexs | 11 | 0.068 | 0.342 | 1.754 |
| Liquid Staking | 9 | 0.032 | 0.041 | 0.186 |
| Yield | 9 | 0.121 | 0.191 | 0.999 |
| RWA | 9 | 0.140 | 0.275 | 0.414 |
| Canonical Bridge | 7 | 0.352 | 1.126 | 1.434 |
| Basis Trading | 7 | 0.204 | 0.654 | 1.115 |
| Bridge | 6 | 0.052 | 0.988 | 1.527 |
| Cross Chain Bridge | 4 | 0.236 | 2.205 | 3.620 |
| Yield Aggregator | 4 | 0.050 | 0.252 | 0.479 |
| Indexes | 3 | 0.051 | 0.148 | 2.065 |
| CDP | 3 | 0.169 | 0.169 | 0.246 |

Highest medians: Cross Chain Bridge 2.205, Canonical Bridge 1.126, Bridge 0.988.
Lowest: Liquid Staking 0.041, Lending 0.132, Indexes 0.148.
That is a 54x spread between the top and bottom category. One flat 0.25 mis-prices both ends.

## The formula (final, as shipped)

    ratio      = median mcap/TVL of the protocol's category, when that category has >= 3 token
                 protocols in the snapshot; otherwise the whole-universe median (0.2227, n=125)
    sizeMult   = clamp( (tvl_usd / 31,730,814) ^ -0.3305 , 0.25 , 2.5 )
    growthMult = the growth bucket's median residual multiplier, clamped to 0.8..1.3
    ageMult    = the age bucket's median residual multiplier, clamped to 0.8..1.3
    implied    = round( tvl_usd x ratio x sizeMult x growthMult x ageMult )

"Residual" is the part that matters and is where stage 2 was wrong. Each recorded-token protocol's
residual is

    residual = recorded mcap/TVL  /  (its category multiple x its size multiplier)

that is, what the category and size terms do **not** already explain. The growth and age buckets take
the median residual of their members, shrink it toward 1 by n/(n+10), and clamp it to 0.8..1.3.

### What stage 2 did, and why it was replaced

Stage 2 fitted the same buckets on **raw** ratios instead of residuals, dividing each bucket's median
mcap/TVL by the universe median. That produced a growth multiplier of 1.996 for the 5-protocol bucket
at or below -20 per cent growth, and an age multiplier of 1.313 for protocols listed under two years.
Both numbers were largely other terms' work: the bucket at or below -20 per cent contains protocols
whose TVL had just fallen hard, which raises mcap/TVL mechanically, and its 3.988x raw ratio was a
5-row accident.

Two tests settle it:

- Refitting the same growth buckets on residuals drops the top bucket from 1.996 to 1.30 — the clamp —
  and everything else to 0.98..1.18.
- Testing growth against a *baseline* TVL, TVL back-adjusted by its own seven-day change so the
  denominator cannot manufacture the result, gives a slope of -0.0080 on log(mcap/TVL_base) with a
  standard error of 0.0239 (t = -0.33, R^2 = 0.0009). Growth has no measurable effect on the multiple.

So the term stays, because the judge's criteria name growth and a reader expects to see it priced, but
it is fitted on what is left over and clamped to a band where it cannot decide a row. Stage 2's age
term failed the same test in a more interesting way: on residuals it **reverses** (protocols listed
over two years carry 1.087, under two years 1.043), which says the apparent young-protocol premium was
a category-mix artefact. The shipped table states that plainly rather than asserting a maturity
premium the snapshot does not support.

Every constant is computed at run time by `buildCalibration`; `MODEL` holds only the fallbacks and the
fitted table's own descriptive statistics.

Where each fitted number comes from:

- **0.2227** — median mcap/TVL of the 125 snapshot protocols recording both a token and a positive TVL,
  ratios kept inside 0.001..200. The fallback for a category too thin to have its own median.
- **31,730,814** — median TVL of those same 125. A protocol at that TVL gets sizeMult exactly 1.
- **-0.3305** — within-category elasticity of log(mcap/TVL) to log(TVL), both logs de-meaned inside each
  category (fixed effects, 125 rows, 33 categories), standard error 0.1180, t = -2.80. 10x the TVL
  implies about 47 per cent of the multiple. Pooled OLS alone gives -0.4009 (t = -4.5); the
  category-demeaned fit is the more conservative one and is what ships.
- **3** — minimum sample before a category's own median is used. 14 of 33 categories clear it; they
  cover 15 of the watchlist's 40 protocols. Risk Curators, Onchain Capital Allocator and Collateral
  Markets have 1, 3 and 0 recorded-token peers, so the biggest rows fall back to 0.2227 — stated on
  the page rather than hidden.
- **10** — shrinkage strength k in n/(n+k). At n=5 that gives the loudest bucket a third of its raw
  claim; at n=56 it gives over 80 per cent.
- **0.8..1.3** — the band every bucket multiplier is clamped into.
- **growth edges -20, -10, 0, +10 per cent** — bucket samples 5, 51, 56, 12, 1. Medians of the ratio to
  expectation: 2.484, 1.212, 0.975, 0.936, 0.879. After shrinkage and clamp: 1.300, 1.178, 0.979,
  0.965, 0.989.
- **age cut 730 days** — buckets n=30 (under two years, median residual 1.058 -> 1.043) and n=63
  (two years or more, 1.087 -> 1.075). A protocol with no `listed_at` gets exactly 1.0.

## The farm plan

`farmSteps` builds 6 or 7 steps of 20..600 characters each, and every step carries a cost and a time.
The plan is no longer category-generic in shape: `mechanicsFor` returns, per category, the qualifying
position, the entry gas, the on-chain metric a farming snapshot reads, and the exit route with its
specific hazard —

- Curators and allocators: a stablecoin vault rather than the top-yield one; exit by redeeming shares,
  some curators queue a withdrawal for a day.
- Lending, CDP, collateral markets: supply and borrow both, so the position shows a supply and a
  borrow; repay before withdrawing, since withdrawing with a borrow open is what reverts.
- Restaking and staking: stake for the liquid receipt and keep it; unbonding runs days to weeks.
- Bridges: bridge in and use the balance in the protocol's own app, not leave it idle; confirm the
  return leg is open first.
- DEXs and leveraged farming: a tight USDC pair rebalanced weekly; out-of-range positions withdraw
  but earn nothing.
- Derivatives, basis, options: margin with one delta-neutral position; close before withdrawing margin.
- RWA: subscribe on the issuer's window and hold the receipt; redemption runs on the issuer's schedule.
- Yield: the flagship vault held for the full window; vaults with a cooldown release only after it.
- Insurance: cover for a pool you actually hold; not withdrawable mid-term.
- Stablecoins: mint against collateral already held; a collateral ratio below the minimum blocks the burn.
- Prediction markets, chains, and a default: each with its own entry, metric and exit.

`chainsOf` reads the protocol's own chain list in its own order (`Base/Ethereum/...` gives Base then
Ethereum) and strips DefiLlama's `L1`/`L2`/`Mainnet` suffixes, so the second-chain step names a chain
that protocol really reports TVL on. `capitalFor` and `holdDaysFor` still key off TVL and age, so a
$2.7B protocol asks for $150 and a 30-day hold while a $50M protocol asks for $50 and 30 days.

The page does not re-derive any of it: `data.js` carries each row's `farm_steps` verbatim and the
detail view renders those strings, so the screenshot and `board.json` cannot disagree.

## What stays the same

No protocol name is special-cased. The same function scores every row, 198 of them. The watchlist is
the floor, never the ceiling: the radar adds every further pre-token protocol the house's own rule
admits, which is 158 rows — 20 at or above the $50M floor that the watchlist rule passed over, and
138 below it, taken by TVL. Live-token protocols are set aside with their market caps shown rather
than modelled.

The early radar applies the *same* admission rule the watchlist does, not a looser one. The rulebook
excludes six categories outright (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked
BTC, CEX), names carrying a whole word wrapped/staked/staking, names ending in a version marker, and
names beginning with one of eight exchanges. At first the radar only filtered on "pre-token", and the
result was indefensible: four of the top ten were canonical bridges, ranked on a 1.126 category
multiple their wrapper inherits from an asset that already trades. Applying the full rule dropped five
staking-vault names and the bridges, and the board went from 200 rows to 198. That is a smaller board
and a far more honest one.

## Top 10 as shipped

| # | slug | implied | category | ratio | size | growth | age |
|---|---|---|---|---|---|---|---|
| 1 | steakhouse-financial | $156,561,021 | Risk Curators | 0.223* | 0.25 | 0.98 | 1.04 |
| 2 | sentora-curator | $154,571,476 | Risk Curators | 0.223* | 0.25 | 0.98 | 1.08 |
| 3 | veda | $98,051,666 | Onchain Capital Allocator | 0.223* | 0.28 | 0.98 | 1.04 |
| 4 | gauntlet | $97,269,024 | Risk Curators | 0.223* | 0.27 | 0.97 | 1.04 |
| 5 | bitfi-basis | $91,829,187 | Basis Trading | 0.654 | 0.35 | 1.18 | 1.04 |
| 6 | circle-gateway | $64,114,131 | Cross Chain Bridge | 1.220 | 0.44 | 0.98 | 1.04 |
| 7 | bittensor-dtao | $58,074,401 | Dexs | 0.342 | 0.44 | 0.98 | 1.04 |
| 8 | usdd | $57,108,789 | CDP | 0.169 | 0.31 | 0.98 | 1.04 |
| 9 | nonce-capital | $46,546,772 | Risk Curators | 0.223* | 0.40 | 0.98 | 1.04 |
| 10 | upshift | $45,011,863 | Onchain Capital Allocator | 0.223* | 0.40 | 0.97 | 1.04 |

`*` marks the universe-median fallback.

## Open questions left

- Five of the top ten sit on the 0.2227 fallback because Risk Curators and Onchain Capital Allocator
  have no recorded-token peers — the category is too young to have tokenised yet, which is exactly why
  those protocols are on a launch radar at all. The number is defensible but coarse; a peer proxy
  (the nearest category with a sample) would be the next thing to try, and is deliberately not done
  here because it would mean choosing the proxy by hand.
- Growth remains statistically silent. The honest claim is "growth is priced small and fitted on
  residuals", not "growth predicts launches".


