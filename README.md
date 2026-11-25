<p align="center"><img src="assets/brand/veul-mark-on-gradient.png" alt="Veul" width="96"></p>

# Veul

Swap any token on Robinhood Chain through Uniswap, and get paid back in stocks. Every swap pays a 0.5% fee;
half of it, 0.25% of the trade, is recorded for you and paid back every week as the stock token you pick
(NVDA, SPY, TSLA or GOOGL at launch).

**Preview.** Live prices and quotes are real; real swaps are switched on only for the team wallet while the
launch checks run, capped at 0.01 ETH per trade. Not available to US persons. Not affiliated with Robinhood.

## What is here

| Path | What |
|---|---|
| [`web/`](web) | The site and the app: Next.js 16 on Cloudflare Workers (OpenNext). Landing, swap, discover, wallet, stock bag, ledger, rewards, agents. |
| [`web/src/app/api/`](web/src/app/api) | Server routes: quotes, swap building and simulation, balances, market lists, token lookup, the payback ledger. |
| [`web/src/lib/swap/`](web/src/lib/swap) | Uniswap Universal Router calldata (v3 and v4 pools) with Permit2, and the fee split. |
| [`web/migrations/`](web/migrations) | The D1 schema of the ledger: verified swaps and paybacks. |
| [`scripts/`](scripts) | Chain and pool tools (stock routes, router checks, swap simulation, transaction inspection), the market feed fetcher, and the scripts that made the site's visuals. |
| [`assets/brand/`](assets/brand) | The Veul mark. |

## How a swap works

1. The app asks `/api/quote` for a route: the token's deepest Uniswap pool (v3 or v4), against ETH, WETH or USDG.
2. `/api/swap` builds the Universal Router call with the 0.5% fee to the fee wallet, and simulates it from the
   trader's own wallet. The trader signs and sends it; the server never holds funds or keys.
3. The ledger (`/api/ledger/record`) checks the transaction on chain before it counts: the fee transfer must be
   there. A reconcile job picks up swaps that paid the fee but were never reported by the app.
4. Paybacks add up per wallet and are claimed weekly as the chosen stock token.

## Run it

Node.js 20 or newer.

```sh
cd web
npm install
npm run dev          # http://localhost:3000
```

Server settings live in `web/.dev.vars` locally and as Worker secrets in production (`wrangler secret put`).
None of them are in this repository.

| Name | What |
|---|---|
| `ALCHEMY_RPC_URL` | Robinhood Chain RPC used by the server |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app for login (email, Google or wallet); without it the app runs in sample mode |
| `PRIVY_APP_SECRET` | Privy server secret |
| `FEE_WALLET` | Receives the swap fee; real swaps stay off until it is set |
| `SWAP_OWNERS`, `MAX_REAL_SWAP_ETH` | Wallets allowed to make real swaps during testing, and the per-trade cap |
| `FEED_TOKEN` | Bearer token for the market feed and reconcile routes |
| `GMGN_API_KEY`, `COINGECKO_API_KEY` | Optional market data |

Deploy to Cloudflare: `npm run cf:deploy` (OpenNext build, then `wrangler deploy`).

## Risks

Memecoins can lose all of their value. Stock tokens are issued by Robinhood, follow their stocks up and down,
and their issuer can pause them or restrict wallets. Nothing here is financial advice.

## License

[Apache-2.0](LICENSE)
