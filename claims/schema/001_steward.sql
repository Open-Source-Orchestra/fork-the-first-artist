CREATE TABLE artist_claims.invites (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  artist_name text NOT NULL CHECK (char_length(artist_name) BETWEEN 1 AND 80),
  issued_by text NOT NULL CHECK (char_length(issued_by) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

-- Only a future verified-proof transaction may create claims. No public insert API exists.
CREATE TABLE artist_claims.claims (
  id uuid PRIMARY KEY,
  invite_id uuid NOT NULL UNIQUE REFERENCES artist_claims.invites(id),
  ens_owner text NOT NULL CHECK (ens_owner ~ '^0x[0-9a-f]{40}$'),
  hedera_account text NOT NULL CHECK (hedera_account ~ '^(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})\.([1-9][0-9]{0,18})$'),
  hedera_network text NOT NULL CHECK (hedera_network = 'testnet'),
  verified_at timestamptz NOT NULL,
  activation_state text NOT NULL DEFAULT 'pending' CHECK (activation_state IN ('pending', 'active', 'failed')),
  frozen_at timestamptz,
  frozen_by text,
  freeze_reason text,
  CHECK ((frozen_at IS NULL AND frozen_by IS NULL AND freeze_reason IS NULL)
    OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL AND freeze_reason IS NOT NULL
      AND char_length(frozen_by) BETWEEN 1 AND 120 AND char_length(freeze_reason) BETWEEN 1 AND 500))
);

CREATE TABLE artist_claims.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id uuid REFERENCES artist_claims.invites(id),
  claim_id uuid REFERENCES artist_claims.claims(id),
  action text NOT NULL CHECK (action IN ('invite_issued', 'invite_revoked', 'claim_frozen')),
  actor text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 120),
  reason text CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nonnulls(invite_id, claim_id) = 1),
  CHECK (action = 'invite_issued' OR reason IS NOT NULL),
  CHECK ((action = 'claim_frozen' AND claim_id IS NOT NULL) OR (action <> 'claim_frozen' AND invite_id IS NOT NULL))
);
