-- 추천 근거·후보 요약 영속(TRIP-306 · BR-U2-04 영속 항 · BR-U2-05).
-- 지금까지 AI 응답의 explanations·candidates_summary 가 도메인 변환에서 버려져,
-- 생성 직후 화면에만 보이고 재조회하면 사라졌다(갭 G-U3-7).

-- 슬롯별 추천 이유. 문구는 시각·소요시간을 언급하지 않는다(BR-U2-09) — 집행은 AI 프롬프트 책임이고
-- 경계에서 문자열 검사는 하지 않는다.
ALTER TABLE visit_slot ADD COLUMN placement_reason varchar(500);

-- 후보 충분성 {level, poolSize, shortfallCategories}. 판정은 AI 소유 — 백엔드는 그대로 보관·전달한다.
ALTER TABLE itinerary ADD COLUMN candidates_summary jsonb;
