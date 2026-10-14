-- V2.71 poi 출처 'OVERTURE' 추가 (TRIP-888/684) — Overture Maps places (CDLA Permissive 2.0).
-- TourAPI·인허가로는 안 메워지는 축이 있다. 서울 실측(2026-10-14, 릴리스 2026-08-19.0): 비식당 4,238곳
-- (SIGHT 1,347 · NATURE 1,416 · CULTURE 664 · SHOPPING 581 · ACTIVITY 217 · **NIGHT_VIEW 13**).
-- NIGHT_VIEW 는 우리 8종 중 유일하게 공유본에 0건이던 축이다 — 지금은 TourAPI 재분류로 20곳뿐이다.
--
-- **이 제약이 Overture 를 막고 있었다.** 수집기(ai/scripts/collect/collect_overture.py)와 매핑은
-- 2026-09 에 이미 있었지만 적재가 0건이었고(TRIP-888), 원인이 주소 품질이 아니라 여기였다 —
-- 문서의 source 가 'OVERTURE' 라 앱 enum·DB CHECK 양쪽에서 거부된다.
--
-- poi.source 인라인 CHECK(auto명 poi_source_check — V2.0, V2.61 에서 교체)를 다시 교체한다.
-- 값은 앱 enum `PoiSource` 와 같은 집합이고, 'OVERTURE'(8자)는 varchar(12) 안에 든다.
-- 기존 값·행 영향 없음(순증). 번호: V2.70 이 최신이고 V2.71 을 쓰는 브랜치가 없다(2026-10-14 전 ref 확인).
--
-- 라이선스: places 테마는 CDLA Permissive 2.0 — share-alike 없음, 상업 이용 자유. 다만 레코드마다
-- 원출처가 섞여 있어(Meta·Microsoft·Foursquare·AllThePlaces) 수집기가 `sources` 를 보존한다.
-- Foursquare 출처분은 NOTICE 의무가 따로 있다 — 앱 귀속 표기에 반영할 것(TRIP-886 과 같은 줄).

ALTER TABLE poi DROP CONSTRAINT poi_source_check;
ALTER TABLE poi ADD CONSTRAINT poi_source_check
  CHECK (source IN ('KAKAO_LOCAL','TOURAPI','MANUAL','LOCALDATA','OVERTURE'));
