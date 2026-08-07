-- 구간 이동 거리 표시 문자열(TRIP-308 · BR-U2-08).
-- 지금까지 AI 응답의 distanceRange 가 도메인 변환에서 버려져 영속되지 않았다 — 재조회하면 사라졌다.
-- 표시 문자열만 저장한다(정본 DistanceEstimate{meters,mode,basis} 는 경계에 올리지 않음).
-- 소요시간은 어떤 형태로도 저장하지 않는다(INV-3).
ALTER TABLE visit_slot ADD COLUMN distance_range varchar(60);
