-- V1.7 권한 — app_user 런타임 DML + append-only 회수
-- 전제: CREATE ROLE app_user 는 인프라(Terraform/DBA)에서 선행. 본 파일은 소유자(app_migrate)가 GRANT만.

GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;

-- append-only 강제: 동의 증적 · 위치 법정 로그는 INSERT/SELECT만 (INV-C1 · INV-LL1)
REVOKE UPDATE, DELETE ON consent_record, location_legal_log FROM app_user;

-- 이후 생성 테이블 기본 권한(U2~U8 증분 대비)
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
