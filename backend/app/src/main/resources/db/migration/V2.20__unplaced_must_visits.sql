-- 넣지 못한 필수 방문지 보고 영속(계약 M2 · AI TRIP-350).
--
-- V2.13(candidates_summary)과 같은 문제다: AI 가 돌려준 보고가 도메인 변환에서 버려지면
-- 생성 직후 화면에만 보이고 **재조회하면 사라진다**. 사용자는 "내가 넣은 곳이 왜 없지"를
-- 다시 물을 방법이 없다.
--
-- 판정은 AI 소유다 — 백엔드는 그대로 보관·전달하고 재계산하지 않는다.
-- 형태: [{"poiId":"<uuid>","reasonCode":"OUT_OF_RANGE|WINDOW_CONFLICT|NO_FEASIBLE_SLOT|UNKNOWN"}]
-- 빈 배열 = 전부 배치됨(필드 없던 옛 응답과 같은 뜻).
ALTER TABLE itinerary ADD COLUMN unplaced_must_visits jsonb NOT NULL DEFAULT '[]'::jsonb;
