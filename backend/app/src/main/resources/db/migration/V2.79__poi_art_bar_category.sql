-- V2.79 poi 카테고리 '미술'·'술집' 추가 (TRIP-1545)
-- 근거: 문화에서 갤러리·미술관을, 맛집·액티비티에서 술집을 갈라 정식 카테고리로 둔다. 경계 코드는 ART·BAR(경계 10종).
-- poi.category CHECK(poi_category_check)를 교체해 두 값을 허용한다. 기존 값·행 영향 없음(순증) — V2.6 과 같은 방식.
-- 행을 옮기는 일은 이 마이그레이션이 하지 않는다(적재 문서의 태그 `갤러리`·`술집` 기준 UPDATE 를 운영자가 따로 돌린다).

ALTER TABLE poi DROP CONSTRAINT poi_category_check;
ALTER TABLE poi ADD CONSTRAINT poi_category_check
  CHECK (category IN ('명소','맛집','카페','야경','자연','쇼핑','문화','액티비티','미술','술집'));
