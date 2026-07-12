# TripPilot U1 DB 스키마 설계 (마이그레이션 설계)

> 대상 유닛: U1 기반·계정·온보딩 (M1 Auth · M2 Profile · C3 Moderation) · 기준일 2026-07-06
> 근거 정본: `construction/u1-foundation/functional-design/domain-entities.md`(엔티티·불변식), `shared-infrastructure.md`(DB 롤 분리·PostgreSQL 16), `tech-stack-decisions.md`(Flyway SQL-first·JPA)
> 상태: **설계 초안** — 아직 레포 미배치·미실행. DDL은 스키마 명세용.

## 0. 범위

U1 엔티티를 PostgreSQL 16 물리 스키마로 설계한다. 스키마 정본은 U1 Flyway 마이그레이션이 소유하며, U2~U8은 이 위에 증분 추가한다. `append-only`(동의 증적·위치 법정 로그)는 DB 권한 분리로 이중 강제한다.

> **⚠️ MVP 스코프 — 소셜 로그인 전용.** 1차는 소셜 로그인(Google·Apple·Kakao·Naver)만 지원한다. 이메일/비밀번호 가입·로그인은 **후속 이연**: `password_hash` 컬럼·`email_verification` 테이블·`PENDING_VERIFICATION` 상태 전이는 MVP 마이그레이션에서 제외(enum 예약값만 유지)한다. 소셜 계정은 제공자가 신원을 보증하므로 생성 즉시 `ACTIVE`다.

## 1. 설계 컨벤션

| 항목 | 결정 | 근거 |
|---|---|---|
| 스키마 | 단일 스키마 `app` (모듈 경계는 애플리케이션 레이어가 소유, DB는 단일 스키마) | D04 모듈러 모놀리스 |
| 네이밍 | snake_case 테이블·컬럼, PK=`<entity>_id`, 인덱스 `ix_`, 유니크 `ux_`, 체크 `chk_` | — |
| 식별자(PK) | 업무 엔티티 = `uuid` (`gen_random_uuid()` v4 — 순차 노출 금지·추측 불가) / **단조 증가 요구 로그**(consent_record·location_legal_log) = `bigint GENERATED ALWAYS AS IDENTITY` | Account "추측 불가 형식", INV-C1/LL 단조 증가 |
| 시각 | 전부 `timestamptz`, UTC 저장 | shared-infra §3 타임존 UTC |
| 열거(enum) | 네이티브 enum 대신 `varchar` + `CHECK (col IN (...))` — 값 도메인 폐쇄이나 ALTER 용이성 확보 | INV 값도메인 폐쇄 |
| 집합값 | `text[]` + `CHECK (col <@ ARRAY[...])` — **NULL=미설정, 비NULL 배열=선택함**(중립 기본값과 구분) | INV-PR2 |
| 소프트 삭제 | `status` + `deleted_at` (물리 삭제 아님). 최종 파기는 유예 만료 배치 (미인증 7일 정리는 이메일 가입 후속분) | D18 |
| 해시 저장 | 토큰은 해시만(`token_hash` — 리프레시), 원문·가역암호화 금지 (`password_hash`는 이메일 로그인 후속) | SECURITY-03·12 |

## 2. DB 롤·권한 모델 (append-only 강제)

역할 3종(shared-infra §3). **CREATE ROLE은 인프라(Terraform/DBA breakglass) 소관**, 테이블 GRANT/REVOKE는 소유자(app_migrate)가 Flyway 마이그레이션에서 수행.

| 롤 | 권한 | 비고 |
|---|---|---|
| `app_migrate` | DDL + GRANT(테이블 소유자) | Flyway 마이그레이션 태스크 전용 |
| `app_user` | 테이블별 DML — 단 `consent_record`·`location_legal_log`는 **INSERT/SELECT만**(UPDATE/DELETE REVOKE) | 런타임 앱. append-only의 DB 레벨 강제 (INV-C1·LL1) |
| master | 전체(비상용) | Secrets Manager 보관·평시 미사용 |

## 3. 테이블 설계

### 3.1 M1 Auth

```sql
-- V1.1 account
CREATE TABLE account (
  account_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            varchar(320),                 -- 소셜 제공 이메일. NULL=제공자 미제공(Apple 비공개 릴레이 등)
  -- password_hash varchar(255)  → 이메일/비밀번호 로그인 후속 도입 시 추가 (MVP 소셜 전용 — 미사용)
  age_method       varchar(20)  NOT NULL CHECK (age_method IN ('BIRTH_DATE','SELF_DECLARED')),
  birth_date       date,
  age_confirmed_at timestamptz  NOT NULL,
  status           varchar(24)  NOT NULL DEFAULT 'ACTIVE'   -- 소셜 가입=즉시 ACTIVE
                   CHECK (status IN ('ACTIVE','DELETION_PENDING','DELETED','PENDING_VERIFICATION')),
                   -- PENDING_VERIFICATION은 이메일 가입(후속) 예약값 — MVP 도달 불가
  sanction_status  varchar(24)  NOT NULL DEFAULT 'NONE'
                   CHECK (sanction_status IN ('NONE','WARNED','COMMUNITY_SUSPENDED','FULLY_SUSPENDED')),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  verified_at      timestamptz,                  -- 소셜=created_at와 동일(제공자 신원 보증)
  deleted_at       timestamptz,                  -- NULL=삭제 아님
  CONSTRAINT chk_birthdate CHECK (age_method <> 'BIRTH_DATE' OR birth_date IS NOT NULL)  -- INV-A2
);
-- INV-A3 활성 계정 간 이메일 유일(대소문자 무시)
CREATE UNIQUE INDEX ux_account_email_active ON account (lower(email))
  WHERE email IS NOT NULL AND status IN ('PENDING_VERIFICATION','ACTIVE','DELETION_PENDING');
CREATE INDEX ix_account_status ON account (status);   -- 정리·유예 배치 스캔
```

```sql
-- V1.1 social_identity
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
```

> **`email_verification` 테이블 — 후속 이연 (MVP 소셜 전용).** 이메일 가입·인증 링크 전용 테이블이라 소셜 전용 MVP에서는 생성하지 않는다. 이메일/비밀번호 로그인 도입 시 별도 마이그레이션으로 추가하며, 원설계(INV-E1~E3·24h 토큰·재발송 rate-limit·단일 유효 부분 유니크)는 그대로 보존한다.

```sql
-- V1.2 terms_version
CREATE TABLE terms_version (
  terms_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terms_type   varchar(20) NOT NULL CHECK (terms_type IN
                 ('TERMS_OF_SERVICE','PRIVACY_POLICY','LOCATION_TERMS','MARKETING','GPS_RECORDING','PERSONALIZATION')),
  version      varchar(40) NOT NULL,
  body         text NOT NULL,
  effective_at timestamptz NOT NULL,
  reconsent_required boolean NOT NULL DEFAULT false,
  CONSTRAINT ux_terms_type_version UNIQUE (terms_type, version)  -- INV-T1 참조 무결성 대상
);
CREATE INDEX ix_terms_current ON terms_version (terms_type, effective_at DESC);  -- INV-T2 현행 판정
```

```sql
-- V1.2 consent_record  (append-only · 단조 증가)
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
-- INV-C2 항목별 현재 상태 = 최신 행 폴드
CREATE INDEX ix_consent_fold ON consent_record (account_id, terms_type, occurred_at DESC);
```

```sql
-- V1.2 marketing_consent  (현재 상태 뷰 — ConsentRecord 파생)
CREATE TABLE marketing_consent (
  account_id uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  opt_in     boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);  -- INV-M1: opt_in 변경은 consent_record 추가와 동일 트랜잭션
```

```sql
-- V1.3 location_consent_state  (3층 현재 상태)
CREATE TABLE location_consent_state (
  account_id uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  os_permission_mirror varchar(16) NOT NULL DEFAULT 'NOT_DETERMINED'
                       CHECK (os_permission_mirror IN ('GRANTED','DENIED','NOT_DETERMINED')),  -- L1 미러
  legal_consent        boolean NOT NULL DEFAULT false,   -- L2 파생(consent_record LOCATION_TERMS)
  gps_recording_opt_in boolean NOT NULL DEFAULT false,   -- L3 파생(consent_record GPS_RECORDING)
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

```sql
-- V1.3 location_legal_log  (법정 로그 · append-only · 값 보존)
CREATE TABLE location_legal_log (
  log_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  uuid NOT NULL,                     -- FK 미강제(파기 후 잔존 — INV-LL2)
  event_type  varchar(20) NOT NULL CHECK (event_type IN
                ('CONSENT_GRANTED','CONSENT_REVOKED','COLLECTION','USE','PROVISION','PURGE')),
  detail      jsonb NOT NULL,                    -- 원시 좌표 미포함(사실 확인자료)
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_locallog_account_time ON location_legal_log (account_id, occurred_at DESC);
```

```sql
-- V1.4 refresh_session  (회전 체인)
CREATE TABLE refresh_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  device_id  varchar(128) NOT NULL,
  token_hash varchar(255) NOT NULL UNIQUE,
  chain_id   uuid NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,               -- = issued_at + 90d
  rotated_at timestamptz,                         -- NULL=체인 현행
  revoked_at timestamptz
);
-- INV-R1 체인마다 현행(미회전·미폐기) 토큰 최대 1개
CREATE UNIQUE INDEX ux_refresh_chain_current ON refresh_session (chain_id)
  WHERE rotated_at IS NULL AND revoked_at IS NULL;
CREATE INDEX ix_refresh_account_device ON refresh_session (account_id, device_id);
CREATE INDEX ix_refresh_expires ON refresh_session (expires_at);  -- 만료 정리 배치
```

```sql
-- V1.4 deletion_schedule  (30일 유예)
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
CREATE INDEX ix_deletion_purge ON deletion_schedule (purge_at) WHERE cancelled_at IS NULL;  -- 만료 배치
```

### 3.2 M2 Profile

```sql
-- V1.5 profile
CREATE TABLE profile (
  account_id uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  nickname   varchar(20) NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
  nickname_updated_at     timestamptz NOT NULL DEFAULT now(),
  onboarding_completed_at timestamptz                 -- NULL=미완료
);
-- 닉네임 유일(대소문자 무시). ⚠️ "활성 계정 간" 요건 → 전역 유일 + 파기 시 닉네임 해제(§6 결정)
CREATE UNIQUE INDEX ux_profile_nickname ON profile (lower(nickname));
```

```sql
-- V1.5 preference_set  (7축 · NULL=미설정)
CREATE TABLE preference_set (
  account_id  uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  styles          text[]      CHECK (styles IS NULL OR styles <@ ARRAY['휴양','관광','액티비티','미식','쇼핑','자연','문화예술']),
  budget_tier     varchar(8)  CHECK (budget_tier IN ('저가','중간','고급','럭셔리')),
  budget_raw_amount bigint     CHECK (budget_raw_amount IS NULL OR budget_raw_amount > 0),
  companion_types text[]      CHECK (companion_types IS NULL OR companion_types <@ ARRAY['혼자','커플','친구','가족','부모님']),  -- 다중(와이어프레임 c12)
  pet_flag        boolean     NOT NULL DEFAULT false,   -- '반려동물 동반' 칩
  activities      text[]      CHECK (activities IS NULL OR activities <@ ARRAY['자연','역사문화','테마파크','맛집투어','카페','전시','야경','쇼핑']),
  transport_modes text[]      CHECK (transport_modes IS NULL OR transport_modes <@ ARRAY['도보','대중교통','렌터카','택시','자전거']),
  food_tastes     text[]      CHECK (food_tastes IS NULL OR food_tastes <@ ARRAY['한식','양식','일식','중식','아시안']),
  pace            varchar(12) CHECK (pace IN ('느긋하게','균형있게','알차게')),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_pair CHECK (budget_raw_amount IS NULL OR budget_tier IS NOT NULL)  -- INV-PR3
);
```

### 3.3 C3 Moderation

```sql
-- V1.6 banned_word_dictionary
CREATE TABLE banned_word_dictionary (
  dict_version varchar(40) PRIMARY KEY,
  entries      jsonb NOT NULL,             -- [{word, category}] · 매칭 원문은 응답 미노출
  deployed_at  timestamptz NOT NULL DEFAULT now(),
  active       boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ux_banned_active ON banned_word_dictionary ((active)) WHERE active;  -- INV-B1 활성 1개
```

### 3.4 권한 부여 (마이그레이션 마지막)

```sql
-- V1.7 grants  (소유자 app_migrate 실행)
GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
-- append-only: 갱신·삭제 회수 (INV-C1 · INV-LL1)
REVOKE UPDATE, DELETE ON consent_record, location_legal_log FROM app_user;
-- 이후 생성 테이블 기본권한
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

## 4. 불변식 → 강제 위치 매핑

| 불변식 | DB 강제 | 앱 강제(추가) |
|---|---|---|
| INV-A1 상태 전이 폐쇄 | status CHECK(값 도메인) | 전이표 가드(서비스) + PBT |
| INV-A2 연령 게이트 | chk_birthdate | 생성 전 차단(서비스) |
| INV-A3 이메일 유일 | ux_account_email_active(부분 유니크) | — |
| INV-S1 소셜 복합 유니크 | ux_social_provider_sub | — |
| INV-E2 단일 유효 토큰 | (후속 — email_verification 이연) | 이메일 로그인 도입 시 적용 |
| INV-C1/LL1 append-only | REVOKE UPDATE/DELETE + Testcontainers 권한테스트 | INSERT 전용 리포지토리(JPA UPDATE 경로 배제) |
| INV-C2 현재 상태=폴드 | ix_consent_fold | 최신 행 조회 로직 |
| INV-L1/L2 위치 게이트 | — (파생 컬럼) | effectiveCapabilities 총함수(서버·클라 공유) + PBT |
| INV-R1 체인 현행 유일 | ux_refresh_chain_current | 조건부 UPDATE 원자 회전 |
| INV-R2 재사용=탈취 | — | rotated 토큰 재사용 시 체인 전체 revoke + 알림 |
| INV-PR2 미설정≠중립 | text[] NULL 허용 | 중립 기본값은 조회 시 파생 주입(미저장) |
| INV-PR3 예산 쌍 | chk_budget_pair | 매핑함수 동시 저장 |
| INV-B1 활성 사전 1개 | ux_banned_active | — |

DB로 못 막는 상태 전이·회전·위치 게이트·재사용 감지는 **Kotest PBT**(계정 상태머신·토큰 회전·닉네임 수렴) + **Testcontainers**(실 PostgreSQL로 권한 분리·append-only 검증)가 담당.

## 5. Flyway 마이그레이션 파일 구성

`app/src/main/resources/db/migration/` (SQL-first, versioned). 단일 히스토리, 파일명 모듈 접두어.

```
V1.1__auth_account.sql          account · social_identity  (email_verification은 후속)
V1.2__auth_terms_consent.sql    terms_version · consent_record · marketing_consent
V1.3__auth_location.sql         location_consent_state · location_legal_log
V1.4__auth_session.sql          refresh_session · deletion_schedule
V1.5__profile.sql               profile · preference_set
V1.6__moderation.sql            banned_word_dictionary
V1.7__grants.sql                app_user GRANT/REVOKE (append-only 강제)
```

- 롤 생성(CREATE ROLE)은 Flyway 밖(Terraform/DBA) — 마이그레이션은 소유 테이블 GRANT만.
- `V1.7` 이후 시드(플레이스홀더 약관 버전 P7·임시 금칙어 사전 P8)는 별도 `R__`(repeatable) 또는 `V1.8__seed.sql`로 분리.
- **이메일/비밀번호 로그인 후속 도입 시**: `V2.x__auth_email_login.sql`로 `account.password_hash` 컬럼 + `email_verification` 테이블 추가(원설계·INV-E1~E3 보존).

## 6. 설계 결정 (✅ 확정 2026-07-06)

1. **PK 식별자 전략** — 업무 엔티티 `uuid v4`(`gen_random_uuid()`, 추측 불가). DAU 1천 규모(G142)에서 인덱스 지역성 무관. → ✅ **확정: UUID v4**.
2. **닉네임 유일성 범위** — `lower(nickname)` **전역 유일 인덱스 + 계정 파기 시 닉네임 해제(tombstone/NULL화)**. → ✅ **확정**.
3. **파생 캐시 동기화** — `marketing_consent`·`location_consent_state` 파생 불리언은 **앱 트랜잭션 규율 + PBT**(트리거 미사용). → ✅ **확정**.
4. **detail/cascade_summary/entries = jsonb** — 스키마 유연성 채택. 강타입 필요 시 후속 컬럼 승격. → ✅ **확정**.

## 7. 와이어프레임 정합 (2026-07-06 · 와이어프레임 우선)

Figma 와이어프레임(c밴드 온보딩) 대조로 아래를 확정·수정했다.

| # | 항목 | 변경 |
|---|---|---|
| 1 | 페이스 값 | `빡빡하게` → **`알차게`** (c10) |
| 2 | 선호 활동 | `스포츠` 제거 — 8종 (c13) |
| 3 | 음식 취향 | `기타` 제거 — 5종 (c15) |
| 4 | 동행 유형 | 단일 `companion_type` → **다중 `companion_types text[]`** + `pet_flag`('반려동물 동반' 칩, c12). **INV-PR4 갱신** |
| 5 | 위치 약관 | `LOCATION_TERMS`는 온보딩 게이트(c06) 제외 → 위치 동의 플로우(c08/l06)에서 수집. **INV-C3 갱신**: 온보딩 필수 약관 = 이용약관·개인정보 2종 |
| 6 | '가족' 라벨 | 표시 "가족(아동 동반)" / 저장값 `가족` |

styles(7)·transport(5)·budget(4구간+직접입력)은 정본과 일치.
