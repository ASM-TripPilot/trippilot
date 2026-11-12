-- 아웃박스 포기(abandon) 이벤트 조회·재전송 — 경보 `trippilot-<env>-outbox-abandon` 을 받았을 때 쓴다.
--
-- 릴레이는 10번(약 13분, OutboxRelay.MAX_ATTEMPTS) 실패한 행을 포기하고 남겨 둔다(지우지 않는다). 원인(구독자 버그·
-- 외부 장애)을 고친 뒤 여기서 attempts 를 0 으로 되돌리면 다음 릴레이 회차(2초)가 다시 집는다. 구독자는 event_id 로
-- 멱등이라 이미 반영된 구독자에게 다시 가도 중복 처리되지 않는다.
--
--   조회만:    psql "$DATABASE_URL" -f backend/scripts/outbox_requeue.sql
--   재전송:    psql "$DATABASE_URL" -v ids="'<event_id>','<event_id>'" -f backend/scripts/outbox_requeue.sql
--   전부:      psql "$DATABASE_URL" -v ids=ALL -f backend/scripts/outbox_requeue.sql
\set ON_ERROR_STOP on
SET search_path = app;

SELECT event_id, event_type, aggregate_type, aggregate_id, occurred_at, attempts, next_attempt_at
FROM outbox_event
WHERE published_at IS NULL AND attempts >= 10
ORDER BY occurred_at;

\if :{?ids}
  SELECT :'ids' = 'ALL' AS requeue_all \gset
  \if :requeue_all
    UPDATE outbox_event SET attempts = 0, next_attempt_at = now()
    WHERE published_at IS NULL AND attempts >= 10
    RETURNING event_id, event_type;
  \else
    UPDATE outbox_event SET attempts = 0, next_attempt_at = now()
    WHERE published_at IS NULL AND attempts >= 10 AND event_id IN (:ids)
    RETURNING event_id, event_type;
  \endif
\endif
