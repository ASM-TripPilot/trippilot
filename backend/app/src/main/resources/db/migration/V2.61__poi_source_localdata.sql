-- V2.61 poi 출처 'LOCALDATA' 추가 (TRIP-1224) — 지방행정 인허가 일반음식점(data.go.kr 15096283).
-- TourAPI 음식점은 전수 수집이 끝났는데도 숙소 12,936곳 중 22.9% 가 7km 안 식당 6곳 미만이다(군 지역 49.6%).
-- 그 공백 지역에만 인허가 대장의 영업 중 식당을 수집 게이트를 거쳐 넣는다(ai/scripts/collect_localdata.py).
-- poi.source 인라인 CHECK(auto명 poi_source_check — V2.0)를 교체한다. 값은 앱 enum `PoiSource` 와 같은 집합이고,
-- 'LOCALDATA'(9자)는 varchar(12) 안에 든다. 기존 값·행 영향 없음(순증).
-- 번호: V2.60 이 최신이고 V2.61 을 쓰는 브랜치가 없다(2026-10-04 확인).

ALTER TABLE poi DROP CONSTRAINT poi_source_check;
ALTER TABLE poi ADD CONSTRAINT poi_source_check
  CHECK (source IN ('KAKAO_LOCAL','TOURAPI','MANUAL','LOCALDATA'));
