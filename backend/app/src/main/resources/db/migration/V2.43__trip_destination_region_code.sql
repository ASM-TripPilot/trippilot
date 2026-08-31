-- trip_destination.region_code — 목적지를 행정구역 표준코드로 정규화(TRIP-361).
--
-- V2.42 다음 번호. 열린 PR 중 db/migration 을 건드리는 것이 없어 충돌 없음(2026-09-01 확인).
--
-- ## 왜 필요한가
--
-- 목적지가 자유 문자열이라 '제주'·'제주도'·'제주특별자치도'가 서로 다른 값으로 저장된다.
-- 카탈로그(V2.24)는 이미 있고 검증도 카탈로그로 하지만(TRIP-360), **저장은 여전히 이름**이라
-- 카탈로그가 가진 것(poi_count·중심좌표)으로 가는 길이 매번 이름 재해석을 거친다.
--
-- ## NULL 을 허용하는 이유 — 이름은 코드로 결정되지 않는다
--
-- 시드 실측(2026-09-01): selectable 237개 중 **7개 이름이 26개 지역에 겹친다**
-- (중구 5 · 동구 5 · 서구 4 · 남구 4 · 북구 4 · 강서구 2 · 고성군 2).
-- '중구' 하나로는 어느 중구인지 정할 수 없다. 그럴 때 다섯 중 하나를 집으면 **조용히 틀린 값**이
-- 되므로(부산 중구를 고른 사용자에게 서울 중구가 박힌다) 코드를 비워 둔다.
--
-- 정본 이탈: 티켓 AC 는 "region_code 가 NULL 인 행이 남지 않는다"라고 적었다. 그 AC 는 **클라이언트가
-- 코드를 보내는** 전면 계약 전환을 전제한다. 이번 칸은 계약을 바꾸지 않는 내부 정규화라, 이름만
-- 받는 동안에는 동명이지역을 해소할 방법이 원리적으로 없다. 남은 구멍은 계약 전환 때 닫힌다.
ALTER TABLE trip_destination
  ADD COLUMN region_code varchar(5) REFERENCES region(region_code);

COMMENT ON COLUMN trip_destination.region_code IS
  '행정구역 표준코드. NULL = 이름으로 코드를 확정하지 못함(동명이지역). 표시는 region 컬럼이 담당한다.';

-- 기존 행 백필 — **확정되는 것만** 채운다.
--
-- 이름과 별칭을 함께 본다(검증이 그렇게 하므로 저장도 같은 기준이어야 한다).
-- HAVING COUNT(DISTINCT ...) = 1 이 동명이지역을 걸러낸다 — 걸러진 이름은 NULL 로 남고,
-- 그것이 "모른다"의 정직한 표현이다. MIN() 은 집합이 1개임이 보장된 뒤라 임의 선택이 아니다.
UPDATE trip_destination td
SET region_code = m.region_code
FROM (
  SELECT n.name_key, MIN(n.region_code) AS region_code
  FROM (
    SELECT name  AS name_key, region_code FROM region
    UNION
    SELECT alias AS name_key, region_code FROM region_alias
  ) n
  GROUP BY n.name_key
  HAVING COUNT(DISTINCT n.region_code) = 1
) m
WHERE btrim(td.region) = m.name_key
  AND td.region_code IS NULL;
