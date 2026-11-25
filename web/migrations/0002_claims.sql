-- Weekly payback claims (session 1.6). Each epoch is one Merkle root posted to the VeulClaims contract.
-- A leaf is (wallet, cumulative USDG owed since the first swap); the contract pays cumulative minus already claimed.

CREATE TABLE claim_epochs (
  epoch INTEGER PRIMARY KEY,               -- 1, 2, 3, … (matches the contract's epoch once posted)
  root TEXT NOT NULL,                      -- 0x Merkle root
  total_usdg INTEGER NOT NULL,             -- sum of all cumulative amounts in this root (USDG base units)
  up_to_block INTEGER NOT NULL,            -- ledger rows up to and including this block are in the tree
  created_at INTEGER NOT NULL,             -- unix seconds
  posted_tx TEXT                           -- the setRoot transaction, once the owner has signed it
);

CREATE TABLE claim_leaves (
  epoch INTEGER NOT NULL,
  wallet TEXT NOT NULL,                    -- lowercase
  cumulative_usdg INTEGER NOT NULL,        -- USDG base units owed in total up to this epoch
  proof TEXT NOT NULL,                     -- JSON array of 0x hashes
  PRIMARY KEY (epoch, wallet)
);
