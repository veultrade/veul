-- Daily claims on VeulClaimsV2 (2026-11-26). Epoch rows now name the contract they belong to, because v2 counts its
-- epochs from 1 again. `epoch` stays the table's own running number; `contract_epoch` is the contract's.
ALTER TABLE claim_epochs ADD COLUMN contract TEXT;
ALTER TABLE claim_epochs ADD COLUMN contract_epoch INTEGER;
UPDATE claim_epochs SET contract = '0xdc19ca2f0110d129cb9cc7cbc990a7f614a5e53a', contract_epoch = epoch WHERE contract IS NULL;
CREATE INDEX claim_epochs_contract_root ON claim_epochs (contract, root);
