-- 일정 슬롯의 이 여행 전용 표시 이름·분류(TRIP-1801). NULL = 덮어쓰기 없음 — 앱이 장소 원본으로 폴백한다.
-- 번호 근거: V2.92(TRIP-1789) 다음. 같은 배치라 이 순서로 머지한다.
-- 장소 원본(poi·poi_snapshot)은 건드리지 않는다(INV-1) — AI 경계에도 싣지 않는 표시 전용 칸이다.
-- display_category 에 CHECK 를 걸지 않는다: 어휘의 정본은 poi_category_check 이고(V2.79 가 늘렸다) 여기 복제하면 늘 때 한쪽만 고쳐진다.
-- 앱이 place-data 판정(`categoryBoundaryCodeOf`)으로 400 을 낸다.
ALTER TABLE visit_slot
  ADD COLUMN display_name     varchar(60),
  ADD COLUMN display_category varchar(12);
