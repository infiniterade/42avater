-- Looks handed out with a signature, so nobody else can get one for the same picture while it is valid
-- (stops "design sniping": copying a design seen in a pending mint and minting it first).
CREATE TABLE IF NOT EXISTS reservations (
  look    TEXT PRIMARY KEY,      -- lookHash (0x…, the contract's picture identity)
  holder  TEXT NOT NULL,         -- address the signature is for (lowercase)
  caw     TEXT NOT NULL,         -- CAW NAME token id (decimal)
  expires INTEGER NOT NULL       -- unix seconds, same as the signature's deadline
);
CREATE INDEX IF NOT EXISTS reservations_caw ON reservations (caw);
