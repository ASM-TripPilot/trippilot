-- V1.3 M1 Auth — 위치 동의 3층 상태 · 위치 법정 로그(append-only)

CREATE TABLE location_consent_state (
  account_id uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  os_permission_mirror varchar(16) NOT NULL DEFAULT 'NOT_DETERMINED'
                       CHECK (os_permission_mirror IN ('GRANTED','DENIED','NOT_DETERMINED')),  -- L1 미러
  legal_consent        boolean NOT NULL DEFAULT false,   -- L2 파생(LOCATION_TERMS)
  gps_recording_opt_in boolean NOT NULL DEFAULT false,   -- L3 파생(GPS_RECORDING)
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 위치정보 수집·이용·제공 사실 확인자료: append-only · 값 보존 (UPDATE/DELETE 권한 회수는 V1.7)
CREATE TABLE location_legal_log (
  log_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  uuid NOT NULL,                     -- FK 미강제(파기 후 잔존 — INV-LL2)
  event_type  varchar(20) NOT NULL CHECK (event_type IN
                ('CONSENT_GRANTED','CONSENT_REVOKED','COLLECTION','USE','PROVISION','PURGE')),
  detail      jsonb NOT NULL,                    -- 원시 좌표 미포함(사실 확인자료)
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_locallog_account_time ON location_legal_log (account_id, occurred_at DESC);
