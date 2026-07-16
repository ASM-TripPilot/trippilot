-- V1.4 M1 Auth — 리프레시 회전 체인 · 삭제 유예

CREATE TABLE refresh_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  device_id  varchar(128) NOT NULL,
  token_hash varchar(255) NOT NULL UNIQUE,       -- 원문 미저장
  chain_id   uuid NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,               -- = issued_at + 90d (앱 계산)
  rotated_at timestamptz,                         -- NULL=체인 현행
  revoked_at timestamptz
);
-- INV-R1 체인마다 현행(미회전·미폐기) 토큰 최대 1개
CREATE UNIQUE INDEX ux_refresh_chain_current ON refresh_session (chain_id)
  WHERE rotated_at IS NULL AND revoked_at IS NULL;
CREATE INDEX ix_refresh_account_device ON refresh_session (account_id, device_id);
CREATE INDEX ix_refresh_expires ON refresh_session (expires_at);

CREATE TABLE deletion_schedule (
  deletion_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  purge_at        timestamptz NOT NULL,           -- = requested_at + 30d
  cascade_summary jsonb NOT NULL,
  cancelled_at    timestamptz
);
-- INV-D1 계정당 활성 유예 최대 1개
CREATE UNIQUE INDEX ux_deletion_active ON deletion_schedule (account_id) WHERE cancelled_at IS NULL;
CREATE INDEX ix_deletion_purge ON deletion_schedule (purge_at) WHERE cancelled_at IS NULL;
