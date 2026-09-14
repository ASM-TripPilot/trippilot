-- 아웃박스 릴레이 지수 백오프(REL-U6-01) — TRIP-845
--
-- 번호 근거: V2.44 가 최신이고 열린 PR 중 db/migration 을 점유한 것이 없다(2026-09-14 확인).
--
-- 왜 컬럼인가: 재시도 지연을 `attempts` 로 쿼리에서 계산하면(now() - 갱신시각 비교) **인덱스가 안 먹는다**.
-- "언제 다시 집을 수 있나"를 값으로 들고 있으면 조회가 그대로 범위 스캔이 된다.
--
-- DEFAULT now(): 기존 미발행 행은 즉시 대상이 된다 — 종전 동작(바로 집음)과 같아 회귀가 없다.
ALTER TABLE outbox_event
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN outbox_event.next_attempt_at IS
  '이 시각 이후에만 재배달 대상(REL-U6-01 지수 백오프). 실패할 때마다 뒤로 밀린다.';

-- 조회 조건이 published_at IS NULL AND next_attempt_at <= now() ORDER BY occurred_at 으로 바뀐다.
-- 기존 인덱스는 occurred_at 만 봐서 백오프로 걸러질 행까지 훑는다 — 선두 컬럼을 next_attempt_at 으로 바꾼다.
-- 이 부분 인덱스를 쓰는 조회는 릴레이 하나뿐이라 교체해도 다른 경로가 느려지지 않는다.
DROP INDEX IF EXISTS ix_outbox_unpublished;
CREATE INDEX ix_outbox_due ON outbox_event (next_attempt_at, occurred_at) WHERE published_at IS NULL;
