-- V1.2 M1 Auth — 약관 버전 · 동의 증적(append-only) · 마케팅 동의

CREATE TABLE terms_version (
  terms_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terms_type   varchar(20) NOT NULL CHECK (terms_type IN
                 ('TERMS_OF_SERVICE','PRIVACY_POLICY','LOCATION_TERMS','MARKETING','GPS_RECORDING','PERSONALIZATION')),
  version      varchar(40) NOT NULL,
  body         text NOT NULL,
  effective_at timestamptz NOT NULL,
  reconsent_required boolean NOT NULL DEFAULT false,
  CONSTRAINT ux_terms_type_version UNIQUE (terms_type, version)  -- INV-T1
);
CREATE INDEX ix_terms_current ON terms_version (terms_type, effective_at DESC);  -- INV-T2

-- 동의 증적: append-only · 단조 증가 (UPDATE/DELETE는 V1.7에서 app_user 권한 회수)
CREATE TABLE consent_record (
  record_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES account(account_id),   -- 캐스케이드 없음: 법정 보존
  terms_type    varchar(20) NOT NULL,
  terms_version varchar(40) NOT NULL,
  action        varchar(6)  NOT NULL CHECK (action IN ('GRANT','REVOKE')),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  channel       varchar(12) NOT NULL CHECK (channel IN ('ONBOARDING','RECONSENT','SETTINGS')),
  CONSTRAINT fk_consent_terms FOREIGN KEY (terms_type, terms_version)
    REFERENCES terms_version (terms_type, version)
);
CREATE INDEX ix_consent_fold ON consent_record (account_id, terms_type, occurred_at DESC);  -- INV-C2

CREATE TABLE marketing_consent (
  account_id uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  opt_in     boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);  -- INV-M1: opt_in 변경은 consent_record 추가와 동일 트랜잭션(앱 규율)
