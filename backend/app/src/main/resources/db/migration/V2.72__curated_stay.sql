-- 큐레이션 숙소 — 트립닷컴 제휴 Promotion Center 의 도시별 인기 목록(Hot Sellers)을 옮겨 담는다.
--
-- **stay(정본)와 따로 둔다.** stay 는 LOCALDATA 인허가 정본(이름·좌표·주소)이라 사진·OTA 호텔 ID 가
-- 없고, 여기는 반대로 트립닷컴이 고른 소수에 사진·호텔 ID 가 붙는다. 한 테이블에 섞으면 탐색 결과에
-- 같은 호텔이 두 출처로 겹쳐 뜬다. 경계 키는 stay 와 같은 합성 규약 "TRIPCOM:{hotel_id}" 를 쓴다 —
-- 아웃바운드(affiliate_click.stay_id)가 그 키 하나로 이름을 찾고 호텔 상세 딥링크를 만든다.
--
-- **평점·가격은 담지 않는다.** 평점은 앱 안에 두지 않고(BR-U1-18), Promotion Center 가격은 실시간 값이
-- 아니라 표시하면 틀린 가격이 된다(INV-U1-05). 이미지는 파일을 저장하지 않고 tripcdn URL 만 담는다.
--
-- ⚠ **출시 조건 — 트립닷컴 서면 승인.** 제휴 계약서(Online Cooperation Agreement) 3.2.4 는 홍보 콘텐츠를
-- "자체 콘텐츠와 함께" 노출하는 것을, 3.2.2 는 트립닷컴 이미지·데이터의 표시를 **사전 서면 승인** 없이
-- 금지한다. 제휴 어시스턴트 봇은 "Promotion Center 호텔 이미지는 써도 된다"고 답했지만(2026-10-16)
-- 봇 답변은 계약을 대신하지 못한다. 승인 전에는 이 목록을 사용자 화면에 띄우지 않는다.
--
-- 행은 반복 시드(R__seed_curated_stay.sql)가 통째로 갈아 끼운다 — 순위는 트립닷컴이 바꾸는 값이다.
CREATE TABLE curated_stay (
  city             varchar(40)  NOT NULL,   -- 표시용 도시명('서울') — 조회 키
  rank             integer      NOT NULL CHECK (rank >= 1),
  tripcom_hotel_id varchar(20)  NOT NULL UNIQUE,
  name             varchar(200) NOT NULL,
  address          varchar(300),            -- null = 모름
  image_url        varchar(500) NOT NULL CHECK (image_url LIKE 'https://%'),  -- 평문 http 는 iOS ATS 가 조용히 막는다
  PRIMARY KEY (city, rank)
);

COMMENT ON TABLE curated_stay IS
  '도시별 큐레이션 숙소(트립닷컴 Promotion Center Hot Sellers). 반복 시드가 갈아 끼운다 — 앱은 읽기만.';
