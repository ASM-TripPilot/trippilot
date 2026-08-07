-- V2.9 생성 진행 상태(day1 조기 노출 선행 계약, TRIP-267)
-- AI 경계는 동기 REST 2단계 호출: 1차 day1(5초) 즉시 노출 → 2차 나머지를 백엔드가 백그라운드 호출(PR #104 합의).
-- 그 사이 일정은 "일부만 채워진" 상태이므로 진행 상태를 노출한다. 확정 상태(status PLANNED/CONFIRMED)와는 다른 축.
-- 기존 행은 단일 호출로 완성된 일정이므로 COMPLETE.

ALTER TABLE itinerary ADD COLUMN generation_state varchar(12) NOT NULL DEFAULT 'COMPLETE'
  CHECK (generation_state IN ('PARTIAL','COMPLETE','FAILED'));
