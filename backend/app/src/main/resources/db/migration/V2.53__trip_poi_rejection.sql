-- 거절 이력 (TRIP-964) — 사용자가 밀어낸 POI 를 여행 단위로 누적한다.
--
-- V2.52 다음. 열린 PR 중 db/migration 을 쓰는 것이 없음을 확인했다(2026-09-27).
--
-- **배제가 아니라 강등의 재료다.** 하드 제외(excluded_poi_ids)로 처리하면 반복 시 후보 풀이
-- 마르고 사용자가 마음을 바꿔도 돌아갈 수 없다 — AI 가 이 이력을 점수 강등으로만 쓴다(#747).
--
-- **횟수가 1급 값이다.** 집합만 저장하면 "처음"과 "세 번째"가 구분되지 않아 반복 강등
-- 계단(1회 −0.15 → 3회+ −0.25, AI 설정 소유)이 성립하지 않는다. 같은 (여행, POI, 종류)는
-- 행 하나에 count 증가 — upsert 가 규약이다.
--
-- 수명은 **여행이 끝날 때까지**(사용자 결정 2026-09-26) — 계정 전역 영속이 아니라 trip 스코프.
-- 여행이 지워지면 함께 지워진다(CASCADE — change_log_entry·itinerary_revision 과 같은 패턴).
CREATE TABLE trip_poi_rejection (
  trip_id    uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  poi_id     uuid        NOT NULL,
  -- SWAPPED_OUT = 슬롯 교체로 빠짐(가장 명확한 거절, 강등 큼) · REGENERATED = 재생성 직전 배치(약함)
  kind       varchar(20) NOT NULL CHECK (kind IN ('SWAPPED_OUT', 'REGENERATED')),
  count      int         NOT NULL DEFAULT 1 CHECK (count >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, poi_id, kind)
);

COMMENT ON TABLE trip_poi_rejection IS
  '여행별 POI 거절 이력(TRIP-964). AI 요청의 rejections 로 실려 점수 강등에 쓰인다 — 강등 폭은 AI 설정 소유.';
