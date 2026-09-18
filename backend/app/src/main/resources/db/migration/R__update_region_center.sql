-- R__ 반복 — 지역 대표 좌표(TRIP-384). **생성물이 아니라 파생 계산이다.**
--
-- 왜 필요한가: 숙소를 등록하지 않은 여행은 앵커가 하나도 없고, AI 가 그것을 422 로 거절한다
-- ("anchors 최소 1개 필요 — 후보 풀 기준점(숙소 앵커) 없음"). 백엔드는 그 실패를 폴백으로 받는데,
-- 폴백은 must_visit 만으로 일정을 만들므로 필수 방문지가 없으면 **일정이 통째로 빈다**.
-- 정본은 숙소 없는 생성을 허용한다(BR-U1-40 · BR-U1-47 · US-SCHED-11).
--
-- 왜 우리 데이터로 계산하나: 좌표를 외부에서 받아오면 키·쿼터가 또 생긴다. 이미 가진 숙소 12,782곳과
-- POI 1,133곳이 전국에 흩어져 있어, 그 무게중심이 "사람이 실제로 가는 곳"의 중심이다 —
-- 행정 경계의 기하 중심보다 여행 앵커로 낫다(경계 중심은 산·바다일 수 있다).
--
-- **실행 순서에 의존한다.** Flyway 반복 마이그레이션은 설명 문자열 순이라
-- seed_region_catalog → seed_stay → seed_stub_pois → update_region_center 로 돈다.
-- 파일명을 바꾸면 좌표가 빈 채로 계산된다 — 그 회귀를 IT 가 잡는다.

WITH pts AS (
  SELECT region_code, lat, lng FROM stay WHERE region_code IS NOT NULL
  UNION ALL
  SELECT region_code, lat, lng FROM poi WHERE region_code IS NOT NULL AND data_status = 'ACTIVE'
)
UPDATE region r
   SET lat = c.lat, lng = c.lng, updated_at = now()
  FROM (
    -- 코드 접두사로 모은다 — 시도(2자리)는 그 안 시군구(5자리)를 전부 포함한다.
    SELECT r2.region_code, avg(p.lat) AS lat, avg(p.lng) AS lng
      FROM region r2 JOIN pts p ON p.region_code LIKE r2.region_code || '%'
     GROUP BY r2.region_code
  ) c
 WHERE c.region_code = r.region_code;

-- 데이터가 한 건도 없는 **목적지**는 시도 중심으로 채운다. 거친 값이지만 앵커가 아예 없는 것보다 낫다
-- — 없으면 그 지역 여행이 빈 일정이 된다. 현재 과천시·의성군 2곳이 해당한다.
-- 행정구(selectable=false)는 채우지 않는다 — 목적지로 고를 수 없어 앵커가 필요 없다.
UPDATE region r
   SET lat = s.lat, lng = s.lng, updated_at = now()
  FROM region s
 WHERE r.lat IS NULL AND r.selectable
   AND s.region_code = r.sido_code AND s.lat IS NOT NULL;
