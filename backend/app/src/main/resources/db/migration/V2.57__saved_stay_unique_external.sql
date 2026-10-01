-- V2.57 저장 숙소 외부 키 유니크(TRIP-1059 · QA-2026-09-28 #012) — 같은 외부 숙소 연타 등록이 30행까지 쌓였다.
-- 번호: V2.56 이 머지 최신, V2.54 는 미머지 PR #767 이 쓰고 있어 V2.57.
--
-- 1) 기존 중복 정리 — 계정·외부 키당 **가장 이른 행**을 남긴다. 거점 참조(base_assignment ·
--    trip_base_day, 둘 다 DEFERRABLE FK)는 남는 행으로 옮긴 뒤 지운다. 로컬은 QA 가 손으로
--    정리했지만 DEV/운영은 미확인이라 마이그레이션이 스스로 정리해야 한다(티켓 '할 것' 2).
-- 2) 부분 유니크 — 외부 키 없는 등록(핀 지정 등)은 자연 키가 없어 대상 밖(WHERE 절).

WITH ranked AS (
  SELECT saved_stay_id,
         first_value(saved_stay_id) OVER (
           PARTITION BY account_id, external_source, external_id
           ORDER BY created_at, saved_stay_id
         ) AS keeper_id
  FROM saved_stay
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL
),
dup AS (
  SELECT saved_stay_id, keeper_id FROM ranked WHERE saved_stay_id <> keeper_id
),
moved_base AS (
  UPDATE base_assignment b SET saved_stay_id = d.keeper_id
  FROM dup d WHERE b.saved_stay_id = d.saved_stay_id
  RETURNING 1
),
moved_day AS (
  UPDATE trip_base_day t SET saved_stay_id = d.keeper_id
  FROM dup d WHERE t.saved_stay_id = d.saved_stay_id
  RETURNING 1
)
DELETE FROM saved_stay s USING dup d WHERE s.saved_stay_id = d.saved_stay_id;

-- saved_stay FK 들이 DEFERRABLE 이라 위 정리의 참조 검사가 커밋까지 미뤄지는데, 그 '보류 트리거'가
-- 남아 있으면 같은 트랜잭션의 CREATE INDEX 가 거부된다(55006 실측). 여기서 즉시 검사로 소진한다 —
-- 참조를 keeper 로 옮긴 뒤라 위반 0 이어야 하고, 있다면 커밋 대신 여기서 터지는 것이 맞다.
SET CONSTRAINTS ALL IMMEDIATE;

CREATE UNIQUE INDEX ux_saved_stay_external
  ON saved_stay (account_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
