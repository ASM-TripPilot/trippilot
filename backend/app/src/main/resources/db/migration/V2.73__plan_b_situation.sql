-- Plan-B 상황 감지 — 트리거 생명주기·억제 범위·감시 상태(설계서 §4.1).
--
-- 모두 확장형이다(상수 기본값 · NULL 허용 · 새 표). 롤링 배포 창의 옛 파드가 그대로 읽고 쓴다.
-- 새 상태값·새 kind 는 없다 — 만료 원인은 로그로만 남긴다.

-- 같은 대상의 발화 중 트리거를 **날짜까지** 가른다. 날짜 전체 신호(slot_key NULL)가 여행 내내 한 자리로 묶여
-- 오늘 뜬 비 알림이 내일 비 알림을 막던 것을 푼다. 새 인덱스는 옛 것보다 느슨해(열 추가) 기존 행이 위반할 수 없다.
DROP INDEX ux_plan_b_trigger_active;
CREATE UNIQUE INDEX ux_plan_b_trigger_active
  ON plan_b_trigger (trip_id, kind, affected_date, COALESCE(slot_key, ''))
  WHERE state = 'ACTIVE';

ALTER TABLE plan_b_trigger
  -- 위험(RISK)은 일정을 막는다(푸시 대상), 주의(CAUTION)는 앱 안에만.
  ADD COLUMN severity         varchar(7)  NOT NULL DEFAULT 'RISK' CHECK (severity IN ('RISK','CAUTION')),
  -- 이 행을 실은 알림 사건의 최고 심각도. NULL = 조용한 발화(배너만)·무발화.
  -- 같은 대상·같은 심각도로 두 번 알리지 않는 근거다.
  ADD COLUMN alerted_severity varchar(7)  CHECK (alerted_severity IN ('RISK','CAUTION')),
  -- 푸시 대상 사건의 대표였던 시각 — 여행·하루(KST) 푸시 상한을 센다.
  ADD COLUMN pushed_at        timestamptz,
  -- 제자리 갱신·해제·소비가 서로를 덮어쓰지 않게(낙관적 잠금).
  ADD COLUMN version          bigint      NOT NULL DEFAULT 0;

-- 지금까지의 발화분은 알림 사건을 냈다(발화 시 PlanBTriggered 발행) — '이미 알렸음'과 푸시 상한 집계가 끊기지 않게.
UPDATE plan_b_trigger SET alerted_severity = 'RISK', pushed_at = detected_at WHERE should_replan;

-- [끄기] 억제가 끈 트리거의 날짜·심각도를 기억한다. NULL = 전부(옛 행 동작 그대로).
-- 주의를 끈 것이 같은 날 위험 격상을, 오늘을 끈 것이 내일 대상을 막지 않게 한다.
ALTER TABLE plan_b_suppression
  ADD COLUMN affected_date date,
  ADD COLUMN max_severity  varchar(7) CHECK (max_severity IN ('RISK','CAUTION'));

-- 감시 상태 — (여행, 출처)의 마지막 관측. 화면이 '정상 / 확인 불가'(i09)를 거짓 정상 없이 말하게 한다.
-- 출처는 스윕 감지기 이름(kma-forecast · kma-warning · airkorea · place).
CREATE TABLE plan_b_watch (
  trip_id    uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  source     varchar(20) NOT NULL,
  status     varchar(7)  NOT NULL CHECK (status IN ('CHECKED','UNKNOWN')),
  -- 이 상태를 관측한 시각.
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (trip_id, source)
);
