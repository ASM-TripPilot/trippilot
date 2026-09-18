-- V1.0 공통 — 트랜잭셔널 아웃박스 · 스케줄 락 (common/core 소유)
-- Flyway 설정: flyway.schemas=app, flyway.defaultSchema=app (미한정 DDL은 app 스키마에 생성)
-- 스키마 app 은 인프라(compose init/Terraform)가 app_migrate 소유로 선생성 — 마이그레이션은 테이블만.
-- app_user 권한은 V1.7에서 일괄 부여.

-- 트랜잭셔널 아웃박스 (at-least-once · 구독자 eventId 멱등)
CREATE TABLE outbox_event (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid        NOT NULL UNIQUE,
  event_type     varchar(80) NOT NULL,
  aggregate_type varchar(40) NOT NULL,
  aggregate_id   varchar(64) NOT NULL,
  correlation_id varchar(64),
  payload        jsonb       NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,                       -- NULL=미발행
  attempts       int         NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_unpublished ON outbox_event (occurred_at) WHERE published_at IS NULL;

-- ShedLock — 분산 스케줄 락 (아웃박스 릴레이 · 정리/유예 배치 공용)
CREATE TABLE shedlock (
  name       varchar(64)  PRIMARY KEY,
  lock_until timestamptz  NOT NULL,
  locked_at  timestamptz  NOT NULL,
  locked_by  varchar(255) NOT NULL
);
