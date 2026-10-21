-- poi_public 에 `rich`(사진·영업시간이 다 있는가) 칸을 더한다 — 도우미 NL2SQL 결과가 가나다순·사업자 법인명으로 채워지던 것.
--
-- V2.78 — 착수 시점 최신(V2.77) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-20).
--
-- 저장 수(saved_count)는 대부분 0 이라 "ORDER BY saved_count DESC" 는 동점뿐이고, 동점 안의 순서는 DB 마음이다 — 테스트 화면
-- "서울 카페"가 감꽃당·광장싸롱·그레도제빵사·개뿔·고센인코퍼레이티드(ㄱ 순)로 나왔다. 반경 탐색은 같은 자리에서 대표사진·영업시간을
-- 다 갖춘 곳(BE `isDataFull` = dataQuality FULL)을 앞에 둔다. 그 신호를 **시각 없이** 불리언 하나로 연다 — 영업시간 원문은 여전히
-- 이 뷰에 없다(INV-2). 열은 맨 뒤에 붙인다(CREATE OR REPLACE VIEW 는 기존 열의 이름·순서를 바꿀 수 없다). 권한은 그대로 남는다.
CREATE OR REPLACE VIEW poi_public WITH (security_barrier) AS
SELECT poi_id,
       name_ko                    AS name,
       category,
       split_part(address, ' ', 1) AS sido,
       region                     AS sigungu,
       address,
       tags,
       saved_count,
       (image_url IS NOT NULL AND opening_hours IS NOT NULL) AS rich
FROM poi
WHERE data_status = 'ACTIVE';
