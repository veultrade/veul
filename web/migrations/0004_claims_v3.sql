-- Claims v3 (2026-11-26): each epoch remembers the last ledger row it included, so the next run can check that the
-- total grew by exactly the paybacks recorded since (rows can be recorded late, so block numbers are not enough).
ALTER TABLE claim_epochs ADD COLUMN up_to_row INTEGER;
