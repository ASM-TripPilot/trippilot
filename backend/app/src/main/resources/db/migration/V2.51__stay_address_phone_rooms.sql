-- 숙소 주소·전화번호·객실 수.
--
-- **새로 수집하는 값이 아니다.** LOCALDATA 원본에 이미 있는데 시드 생성기가 읽고 버리던 값이다
-- (`gen_stay_seed.py` 가 주소를 region_code 뽑는 데만 쓰고 문자열을 흘려보냈다). 외부 호출 0회.
--
-- V2.50 다음. 열린 PR 중 db/migration 을 쓰는 것이 없음을 확인했다(2026-09-23).
--
-- **전부 nullable 이고, NULL 은 "없음"이 아니라 "모름"이다.** 같은 함정을 amenities 에서 이미
-- 겪었다 — 빈 배열이 "편의시설 없는 숙소"로 읽혀 응답이 `amenitiesKnown` 으로 따로 알려야 했다.
-- 여기서는 칸마다 채움률이 달라 NULL 자체가 그 뜻을 갖는다(화면은 칸을 비우면 된다).
--
-- LOCALDATA 실측(2026-08-17 자 · 시드 수록 12,782곳):
--   주소 12,782 (100%) · 전화 7,005 (54.8%) · 객실 12,723 (99.5%)
-- 후속 출처(TOURAPI 등)가 이 칸을 안 줄 수 있어 NOT NULL 로 묶지 않는다.
ALTER TABLE stay
  ADD COLUMN address varchar(200),   -- 도로명 우선, 없으면 지번. 원본 최대 89자
  ADD COLUMN phone   varchar(20),    -- 정규화된 표시형 '02-1670-8876'. 최대 13자
  ADD COLUMN rooms   integer;        -- 양실+한실 합. 원본 최대 1,326

-- **0 은 넣지 않는다.** 원본에서 양실·한실이 둘 다 비어 있는 행이 59건 있는데, 합을 그대로 쓰면
-- 0 이 되어 "객실 0개인 숙소"가 화면에 나간다. 생성기가 NULL 로 넘기고, 이 제약이 그 규칙을
-- 생성기 바깥에서 지킨다 — 생성기가 회귀하면 시드가 조용히 틀리는 대신 큰 소리로 실패한다.
ALTER TABLE stay ADD CONSTRAINT ck_stay_rooms_positive CHECK (rooms IS NULL OR rooms > 0);
