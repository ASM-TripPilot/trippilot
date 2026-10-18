-- R__ 반복 시드 — 큐레이션 숙소(curated_stay). 손으로 고치는 시드다(생성기 없음).
--
-- 출처: 트립닷컴 제휴 Promotion Center(/partners/tools/pmCenter/main) · 서울 · Hot Sellers 15곳 (2026-10-16).
-- 호텔 ID 는 각 호텔 [Promote] 의 짧은 링크를 풀어 얻었고(hotelid 파라미터), 이름·주소는
-- kr.trip.com 호텔 상세에서 확인했다. 이미지는 목록 썸네일의 tripcdn 이미지 ID 에 960×660 접미사를 붙였다
-- (`_R_960_660` 은 실측 규칙이지 공개 문서가 아니다 — 깨지면 접미사를 떼면 원본이 나온다).
--
-- **통째로 갈아 끼운다**(DELETE → INSERT). upsert 는 목록에서 빠진 호텔을 못 지운다 — 순위 밖으로 밀린
-- 호텔이 계속 뜬다(anti-patterns: 생성 시드 삭제 규칙). 이 테이블을 참조하는 FK 는 없다.
-- 갱신: Promotion Center 에서 다시 받아 아래 VALUES 를 바꾸면 체크섬이 바뀌어 다음 배포에 재실행된다.

DELETE FROM curated_stay;

INSERT INTO curated_stay (city, rank, tripcom_hotel_id, name, address, image_url) VALUES
  ('서울',  1, '4645968',   '호텔 베뉴지',                         '서울특별시 종로구 청계천로 117',   'https://ak-d.tripcdn.com/images/0220c120008e41eyq937E_R_960_660.jpg'),
  ('서울',  2, '106072133', '맹그로브 동대문',                     '서울특별시 중구 퇴계로 334',       'https://ak-d.tripcdn.com/images/1mc6l12000cqpc0e1CE4E_R_960_660.jpg'),
  ('서울',  3, '124449530', '호텔 더 보타닉 세운 명동',            '서울특별시 중구 을지로19길 23-1',  'https://ak-d.tripcdn.com/images/1mc2312000humez29A34E_R_960_660.jpg'),
  ('서울',  4, '81074621',  '로이넷호텔 서울 마포',                '서울특별시 마포구 마포대로 67',    'https://ak-d.tripcdn.com/images/0201d120009gwqxxzAD16_R_960_660.jpg'),
  ('서울',  5, '83924501',  '스탠포드 호텔 명동',                  '서울특별시 중구 남대문로 84',      'https://ak-d.tripcdn.com/images/02001120009pkk42o9939_R_960_660.jpg'),
  ('서울',  6, '1687209',   '밀리오레 호텔 서울 명동',             '서울특별시 중구 퇴계로 115',       'https://ak-d.tripcdn.com/images/0226l120009ztwybr375A_R_960_660.jpg'),
  ('서울',  7, '988714',    '로얄호텔서울 명동',                   '서울특별시 중구 명동길 61',        'https://ak-d.tripcdn.com/images/1mc4712000eq4g05y577D_R_960_660.jpg'),
  ('서울',  8, '17312071',  '페어필드 바이 메리어트 서울',         '서울특별시 영등포구 경인로 870',   'https://ak-d.tripcdn.com/images/1mc5s12000ap7p81yFA38_R_960_660.jpg'),
  ('서울',  9, '3147171',   '소테츠호텔즈 더 스프라지르 서울 명동', '서울특별시 중구 남대문로5길 15',   'https://ak-d.tripcdn.com/images/1mc4312000r7u4u4j410A_R_960_660.jpg'),
  ('서울', 10, '988591',    '코리아나호텔',                        '서울특별시 중구 세종대로 135',     'https://ak-d.tripcdn.com/images/220713000000ubfbb2422_R_960_660.jpg'),
  ('서울', 11, '50394894',  '나인트리 바이 파르나스 서울 동대문',   '서울특별시 중구 을지로 224',       'https://ak-d.tripcdn.com/images/1mc6412000r6ti0039EB5_R_960_660.jpg'),
  ('서울', 12, '5242733',   '호텔 스카이파크 킹스타운 동대문점',    '서울특별시 중구 장충단로13길 20',  'https://ak-d.tripcdn.com/images/200f1600000106t1219ED_R_960_660.jpg'),
  ('서울', 13, '988513',    '호텔 스카이파크 센트럴명동점',         '서울특별시 중구 명동9길 16',       'https://ak-d.tripcdn.com/images/0206d120009oz4awj5C0E_R_960_660.jpg'),
  ('서울', 14, '1341242',   '베이튼 호텔',                         '서울특별시 중구 동호로 346',       'https://ak-d.tripcdn.com/images/0225f1200080wsos13299_R_960_660.jpg'),
  ('서울', 15, '45422158',  '나인트리 바이 파르나스 서울 인사동',   '서울특별시 종로구 인사동길 49',    'https://ak-d.tripcdn.com/images/1mc1q12000r6tetam15EA_R_960_660.jpg');
