-- Reconcile queue (2026-11-26 swap review, finding 1): fee-wallet transfers found by the scan wait here to be checked,
-- so a slow or pending one no longer holds back the scan cursor, and spam cannot stall it.
CREATE TABLE reconcile_queue (
  tx_hash TEXT PRIMARY KEY,                -- lowercase
  block_number INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL                -- unix seconds
);
CREATE INDEX reconcile_queue_order ON reconcile_queue (block_number);
