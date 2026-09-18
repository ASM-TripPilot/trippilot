-- TRIP-219 — POI 표시용 사진·태그. d04(2열 사진 그리드)·d02(썸네일·태그 칩)가 그릴 원본.
-- image_url NULL = 미확보. 서버가 모를 때 임의 기본 이미지를 지어내지 않는다(클라가 자리만 비운다).
-- tags 는 열린 집합(감성 골목·야경·카페…)이라 preference_set(V1.5)과 달리 CHECK 제약을 두지 않는다.
-- 값 부재가 POI 를 목록에서 빼는 사유가 아니다(BR-U1-06 취지) — 그래서 둘 다 조회 조건에 쓰지 않는다.

ALTER TABLE poi
  ADD COLUMN image_url text,
  ADD COLUMN tags      text[] NOT NULL DEFAULT '{}';
