-- V1.1 M1 Auth — 계정 · 소셜 연결 (소셜 로그인 전용 MVP)
-- 후속(이메일 로그인 도입 시): account.password_hash 컬럼 + email_verification 테이블 추가.

CREATE TABLE account (
  account_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            varchar(320),                 -- 소셜 제공 이메일. NULL=제공자 미제공(Apple 릴레이 등)
  age_method       varchar(20)  NOT NULL CHECK (age_method IN ('BIRTH_DATE','SELF_DECLARED')),
  birth_date       date,
  age_confirmed_at timestamptz  NOT NULL,
  status           varchar(24)  NOT NULL DEFAULT 'ACTIVE'   -- 소셜 가입=즉시 ACTIVE
                   CHECK (status IN ('ACTIVE','DELETION_PENDING','DELETED','PENDING_VERIFICATION')),
                   -- PENDING_VERIFICATION: 이메일 가입(후속) 예약값 — MVP 도달 불가
  sanction_status  varchar(24)  NOT NULL DEFAULT 'NONE'
                   CHECK (sanction_status IN ('NONE','WARNED','COMMUNITY_SUSPENDED','FULLY_SUSPENDED')),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  verified_at      timestamptz,                  -- 소셜=created_at와 동일(제공자 신원 보증)
  deleted_at       timestamptz,
  CONSTRAINT chk_account_birthdate CHECK (age_method <> 'BIRTH_DATE' OR birth_date IS NOT NULL)  -- INV-A2
);
-- INV-A3 활성 계정 간 이메일 유일(대소문자 무시)
CREATE UNIQUE INDEX ux_account_email_active ON account (lower(email))
  WHERE email IS NOT NULL AND status IN ('PENDING_VERIFICATION','ACTIVE','DELETION_PENDING');
CREATE INDEX ix_account_status ON account (status);

CREATE TABLE social_identity (
  social_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,  -- INV-S2
  provider       varchar(10) NOT NULL CHECK (provider IN ('GOOGLE','APPLE','KAKAO','NAVER')),
  provider_sub   varchar(255) NOT NULL,
  provider_email varchar(320),
  linked_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_social_provider_sub UNIQUE (provider, provider_sub)  -- INV-S1
);
CREATE INDEX ix_social_account ON social_identity (account_id);
