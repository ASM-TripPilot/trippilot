-- 원탭 [다시 짜기] 적용 뒤 — 빠진 곳 보기와 되돌리기(TRIP-1412 · BR-U4-25·28 · INV-U4-05 개정 주).
--
-- 원탭은 초안을 보자마자 반영한다. 사용자가 "무엇이 빠졌나"를 볼 수 있는 때는 반영 뒤뿐인데, 그때 원 일정은 이미 바뀌어
-- 비교를 다시 계산할 원본이 없다. 그래서 반영하는 순간 두 가지를 세션에 떠 둔다.
--
-- applied_before = 반영 직전 그 날의 비교 기준(슬롯 표면 — 전후 비교 화면의 before 그대로).
-- restore_point  = 반영 직전 그 날의 일정(슬롯 + 확정 동결 참조) — 되돌리기가 이 모습으로 돌린다.
-- reverted_at    = 되돌린 시각. 한 번만 된다.
--
-- 확장형이다: 셋 다 null 허용 · 기본값 없음. 기존 APPLIED 행은 null 로 남는다 — 그 때의 직전 모습은 남은 곳이 없어
-- 지어내지 않는다(비교는 ready=false, 되돌리기는 409). 롤링 배포 창의 옛 파드는 이 칸을 모른 채 반영해도 null 로 남는다(같은 결과).
ALTER TABLE replan_session
  ADD COLUMN applied_before jsonb,
  ADD COLUMN restore_point  jsonb,
  ADD COLUMN reverted_at    timestamptz;

-- 되돌릴 수 있는 것은 반영된 세션뿐이고, 되돌리기 지점이 있어야 한다(도메인 isRevertible 과 같은 규칙).
ALTER TABLE replan_session
  ADD CONSTRAINT chk_replan_session_reverted
    CHECK (reverted_at IS NULL OR (status = 'APPLIED' AND restore_point IS NOT NULL));
