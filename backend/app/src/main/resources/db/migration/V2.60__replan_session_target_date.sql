-- 재계획 대상 일자(TRIP-1182 BE) — 종전에는 '오늘'이 코드에 박혀 있어 다른 날을 다시 짤 수 없었다.
-- 번호: V2.59 가 최신이고 db/migration 을 건드리는 열린 PR 이 없다(2026-10-03 확인).
ALTER TABLE replan_session ADD COLUMN target_date date;

-- 기존 행 백필 — 그 시절 대상 일자는 '진입 시각의 여행 기준 날짜'였다(ReplanSolver 가 그렇게 계산했다).
-- NOT NULL 로 닫아 두면 도메인이 null 분기를 들고 다닐 필요가 없다.
-- **DEFAULT 를 ADD COLUMN 에 붙이면 안 된다** — 볼러틸 기본값은 기존 행을 '오늘'로 채워 버려
-- 이 UPDATE 가 0행이 되고 옛 세션의 대상 일자가 전부 오늘로 조작된다.
UPDATE replan_session SET target_date = (from_instant AT TIME ZONE 'Asia/Seoul')::date WHERE target_date IS NULL;

ALTER TABLE replan_session ALTER COLUMN target_date SET NOT NULL;

-- 롤링 배포 창(prd replicas=2)에서는 구 파드가 이 컬럼을 모른 채 INSERT 한다 — 기본값이 없으면
-- NOT NULL 위반으로 사용자에게 500 이 나간다. 구 파드가 뜻한 값이 정확히 '오늘'이라 그대로 기본값에 둔다.
-- 앱은 항상 값을 명시해 보내므로(엔티티 필드가 non-null) 평상시 이 기본값은 쓰이지 않는다.
ALTER TABLE replan_session ALTER COLUMN target_date SET DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date;
