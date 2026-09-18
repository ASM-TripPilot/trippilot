-- 로컬 개발용 롤·스키마 부트스트랩 (최초 기동 시 1회 실행)
-- 근거: U1-DB스키마-설계.md §2 (DB 롤·권한 모델). 운영에서 CREATE ROLE 은
-- 인프라(Terraform/DBA breakglass) 소관 — 이 파일은 그 로컬 대역이다.
-- 테이블별 GRANT/REVOKE(app_user DML·append-only 회수)는 Flyway V1.7 이 소유(TRIP-147).

-- app_migrate: DDL + 테이블 소유자 (Flyway 마이그레이션 전용)
CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate';

-- app_user: 런타임 앱 DML
CREATE ROLE app_user LOGIN PASSWORD 'app_user';

-- 단일 스키마 app (D04 모듈러 모놀리스) — 소유자는 app_migrate
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate;

-- 런타임 접속 준비. 테이블 GRANT 는 아직 없음(Flyway V1.7 에서 일괄 부여).
GRANT USAGE ON SCHEMA app TO app_user;

-- 기본 search_path 를 app 으로 고정
ALTER ROLE app_migrate IN DATABASE trippilot SET search_path = app;
ALTER ROLE app_user    IN DATABASE trippilot SET search_path = app;
