-- V2.80 poi_public 의 tags 에서 지도 앱 평판 파생 태그(`인기1`~`인기5`·`평점높음`)를 뺀다 (TRIP-1537)
-- 근거: 이 태그는 리뷰 수·별점에서 뽑은 구간이라 AI 점수·후보 선별에만 쓴다. 도우미 NL2SQL 은 이 뷰의 tags 로 거르고 결과 행에 싣는다 —
--       그대로 두면 사용자가 "인기5 태그인 곳"을 물을 수 있다. 앱 API 쪽 같은 규칙은 코드의 PublicTags(placedata.domain) — 둘을 함께 고친다.
-- 열 이름·타입·순서는 그대로(CREATE OR REPLACE VIEW 제약). 권한·security_barrier 도 그대로 남는다. 원 순서를 지킨다(WITH ORDINALITY).
CREATE OR REPLACE VIEW poi_public WITH (security_barrier) AS
SELECT poi_id,
       name_ko                    AS name,
       category,
       split_part(address, ' ', 1) AS sido,
       region                     AS sigungu,
       address,
       ARRAY(SELECT t.tag
               FROM unnest(tags) WITH ORDINALITY AS t(tag, ord)
              WHERE t.tag !~ '^인기[1-5]$' AND t.tag <> '평점높음'
              ORDER BY t.ord)     AS tags,
       saved_count,
       (image_url IS NOT NULL AND opening_hours IS NOT NULL) AS rich
FROM poi
WHERE data_status = 'ACTIVE';
