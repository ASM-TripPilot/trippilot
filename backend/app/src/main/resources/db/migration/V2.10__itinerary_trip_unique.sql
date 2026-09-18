-- 여행당 일정 1개를 DB로 못박는다(TRIP-267).
-- 지금까지는 일반 인덱스뿐이라 동시 생성 요청 두 건이 각자 "지울 게 없음"을 보고 둘 다 INSERT 할 수 있었고,
-- 그러면 조회가 임의의 한 행을 집어 나머지 한 행의 2차 생성 결과가 영영 반영되지 않는다(PARTIAL 고착).
DROP INDEX IF EXISTS ix_itinerary_trip;
ALTER TABLE itinerary ADD CONSTRAINT uq_itinerary_trip UNIQUE (trip_id);
