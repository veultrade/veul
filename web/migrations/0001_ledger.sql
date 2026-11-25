-- Stockup ledger (session 1.5): one row per real swap that paid the 0.5% fee, verified onchain.
-- Amounts are stored as integer strings in base units (wei, token units) so nothing is rounded.
CREATE TABLE swaps (
  tx_hash TEXT PRIMARY KEY,                 -- lowercase 0x hash; one row per transaction
  wallet TEXT NOT NULL,                     -- trader (tx sender), lowercase
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  token TEXT NOT NULL,                      -- token traded against ETH, lowercase
  token_symbol TEXT,
  token_decimals INTEGER NOT NULL,
  token_amount TEXT NOT NULL,               -- tokens received (buy) or sold (sell), base units
  eth_wei TEXT NOT NULL,                    -- trade size in ETH before the fee, wei
  fee_wei TEXT NOT NULL,                    -- ETH received by the fee wallet in this transaction, wei
  eth_usd REAL NOT NULL,                    -- ETH price in USD at the trade's block (ETH/USDG Uniswap pool)
  usd REAL NOT NULL,                        -- trade size in USD
  payback_usdg INTEGER NOT NULL,            -- payback owed, USDG base units (6 decimals): 0.25% of usd
  payback_status TEXT NOT NULL DEFAULT 'owed' CHECK (payback_status IN ('owed', 'claimed')),
  claim_tx TEXT,                            -- set by the claim (session 1.6)
  block_number INTEGER NOT NULL,
  block_time INTEGER NOT NULL,              -- unix seconds
  recorded_at INTEGER NOT NULL              -- unix seconds
);

CREATE INDEX swaps_by_wallet ON swaps (wallet, block_time DESC);

-- Small key/value state, e.g. the last block the fee-wallet scan reached.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
