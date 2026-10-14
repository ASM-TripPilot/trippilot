-- 자동화 구간 — 지오펜스 무장 · 경로 기록이 언제 돌았나(U10 M-U10-c · DEC-U10-10 · TRIP-1404).
--
-- V2.68 — V2.67(#1164, 방문 실적 완료 출처) 다음. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-14).
--
-- **좌표가 없다.** 이 표는 업무 데이터(무장 여부 판정 · 관측)이고, 법적 사실은 `location_legal_log` 에 따로 남는다 —
-- 두 계층을 섞지 않는다(P-DATA-U4-1). 업무 데이터는 여행 수명을 따르고(CASCADE), 법정 로그는 법정 기한을 따른다.
CREATE TABLE location_automation_interval (
  -- 클라가 짓는다 — START·END 보고의 멱등 키다(오프라인 큐가 같은 보고를 다시 보낸다).
  interval_id   uuid        PRIMARY KEY,
  trip_id       uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- 법정 로그의 대상 계정. 여행 소유자다.
  account_id    uuid        NOT NULL,
  kind          varchar(20) NOT NULL CHECK (kind IN ('GEOFENCE_ARMED','ROUTE_RECORDING')),
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  end_reason    varchar(24) CHECK (end_reason IN
                  ('CLIENT_STOP','PERMISSION_DOWNGRADE','ACCURACY_REDUCED','CONSENT_REVOKED','TRIP_ENDED','SERVER_TIMEOUT')),
  -- END 에서만 온다. 경로 기록은 표본 수, 무장은 리전 수.
  point_count   integer     CHECK (point_count IS NULL OR point_count >= 0),
  region_count  integer     CHECK (region_count IS NULL OR region_count >= 0),
  CONSTRAINT chk_location_automation_interval_order CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- 닫힌 구간에는 닫힌 이유가 있다 — 이유 없는 종료는 "앱이 멈췄나 서버가 닫았나"를 가를 수 없게 한다.
  CONSTRAINT chk_location_automation_interval_end CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

-- 무장 여부(`isAutomationArmed`) — 여행·종류로 좁혀 시각으로 고른다.
CREATE INDEX ix_location_automation_interval_trip ON location_automation_interval (trip_id, kind, started_at);

-- 열린 구간 스위퍼(G-U10-11)와 철회 시 닫기 — 열린 것만 훑는다.
CREATE INDEX ix_location_automation_interval_open ON location_automation_interval (account_id) WHERE ended_at IS NULL;
