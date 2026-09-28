-- 재계획 기준점 좌표 파기 상태 (TRIP-992) — 위치 동의(L2) 철회 시 저장 좌표를 지우는 자리.
--
-- V2.56 인 이유: 커밋 최신 V2.55, 열린 PR #767 이 V2.54 를 쓰고 있다(2026-09-28 확인 —
-- untracked 초안까지 봤다, anti-patterns 2026-09-27 규칙).
--
-- 좌표만 null 로 지우면 기존 CHECK(GPS·MANUAL 은 좌표 필수)에 걸린다. kind 를 다른 실값으로
-- 바꾸면 "어디서 온 기준점이었나"를 조작하는 셈이라, **파기됐다는 사실 자체를 값으로** 남긴다.
-- 좌표 요구 CHECK 는 그대로 둔다 — PURGED 는 GPS·MANUAL 이 아니므로 좌표 없음이 허용된다.
ALTER TABLE replan_session DROP CONSTRAINT replan_session_origin_kind_check;
ALTER TABLE replan_session ADD CONSTRAINT replan_session_origin_kind_check
  CHECK (origin_kind IN ('GPS', 'MANUAL', 'LAST_VISIT', 'STAY_ANCHOR', 'PURGED'));

COMMENT ON COLUMN replan_session.origin_kind IS
  '기준점 출처(사다리). PURGED = 위치 동의 철회로 좌표를 파기함(TRIP-992) — 원래 GPS/MANUAL 이었다는 뜻이며 좌표는 null.';
