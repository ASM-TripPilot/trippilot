-- change_log_entry — 변경 이력(changelog 계층, US-PLANB-09 · TRIP-275).
-- "이날 무엇을 왜 바꿨는지"를 되짚기 위한 기록이라 남은 뒤에는 바뀌지 않아야 한다 → append-only.
CREATE TABLE change_log_entry (
  change_log_entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id             uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  actor               varchar(64) NOT NULL,                 -- 변경 주체(수동 편집=계정 id)
  source_type         varchar(16) NOT NULL
                        CHECK (source_type IN ('PLAN_B','MANUAL','COEDIT','ASSISTANT')),
  reason              varchar(500),                          -- 선택 — Plan-B 는 트리거 사유를 싣는다
  before_snapshot     jsonb       NOT NULL,                  -- 변경 전 일정 스냅숏(시각·순서만, INV-3)
  after_snapshot      jsonb       NOT NULL,                  -- 변경 후 스냅숏
  at                  timestamptz NOT NULL
);

-- 타임라인 조회(여행별 최신순). at 동률은 IDENTITY 로 가르므로 정렬키를 그대로 덮는다.
CREATE INDEX ix_change_log_trip_at ON change_log_entry (trip_id, at DESC, change_log_entry_id DESC);

-- 앱 롤의 UPDATE/DELETE 회수 — 남은 이력이 사후에 바뀌면 "왜 바꿨는지" 되짚는 근거가 못 된다.
--
-- ⚠ 보존 범위는 consent_record·location_legal_log 와 **다르다**. 그쪽은 법정 보존이라 캐스케이드를 일부러
-- 두지 않았지만(V1.2 '캐스케이드 없음: 법정 보존' · V1.3 'FK 미강제'), 이 이력은 여행에 딸린 사용자 데이터라
-- 여행이 지워지면 함께 지워지는 것이 맞다(개인정보 파기). PostgreSQL 은 RI 캐스케이드를 참조 테이블의
-- DELETE 권한과 무관하게 수행하므로, 위 REVOKE 는 **개별 행 조작만** 막는다 — 여행 단위 삭제는 막지 않는다.
REVOKE UPDATE, DELETE ON change_log_entry FROM app_user;
