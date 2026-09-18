-- 위반 사유 영속(TRIP-309 · BR-U3-13).
-- 지금까지 has_violation(불리언)만 남겨서, 저장 후 재조회하면 "무엇이 왜 문제인지"가 사라졌다.
-- BR-U3-13 은 저장 후에도 위반 블록을 **지속 가시화**하라고 정한다 — 배지만으로는 부족하다.
ALTER TABLE visit_slot ADD COLUMN violation_reason varchar(300);

-- 사유가 있는데 플래그가 꺼져 있으면 화면이 위반을 안 그린다 — 둘이 어긋난 상태를 DB 에서 막는다.
ALTER TABLE visit_slot ADD CONSTRAINT chk_visit_slot_violation
  CHECK (violation_reason IS NULL OR has_violation);
