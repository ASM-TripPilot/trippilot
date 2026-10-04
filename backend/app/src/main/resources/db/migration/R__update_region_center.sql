-- R__ 반복 — 지역 대표 좌표(TRIP-384). **생성물이 아니라 파생 계산이다.**
--
-- 왜 필요한가: 숙소를 등록하지 않은 여행은 앵커가 하나도 없고, AI 가 그것을 422 로 거절한다
-- ("anchors 최소 1개 필요 — 후보 풀 기준점(숙소 앵커) 없음"). 백엔드는 그 실패를 폴백으로 받는데,
-- 폴백은 must_visit 만으로 일정을 만들므로 필수 방문지가 없으면 **일정이 통째로 빈다**.
-- 정본은 숙소 없는 생성을 허용한다(BR-U1-40 · BR-U1-47 · US-SCHED-11).
--
-- 왜 우리 데이터로 계산하나: 좌표를 외부에서 받아오면 키·쿼터가 또 생긴다. 이미 가진 숙소 12,782곳과
-- POI 1,133곳이 전국에 흩어져 있어, 그 분포가 "사람이 실제로 가는 곳"을 가리킨다 —
-- 행정 경계의 기하 중심보다 여행 앵커로 낫다(경계 중심은 산·바다일 수 있다).
-- 시군구는 그 무게중심(①), 시도는 가장 빽빽한 곳(②)이다 — 시도는 군집이 여럿이라 평균도 산 위에 떨어진다.
--
-- **실행 순서에 의존한다.** Flyway 반복 마이그레이션은 설명 문자열 순이라
-- seed_region_catalog → seed_stay → seed_stub_pois → update_region_center 로 돈다.
-- 파일명을 바꾸면 좌표가 빈 채로 계산된다 — 그 회귀를 IT 가 잡는다.

-- ① 무게중심 — 숙소·ACTIVE POI 좌표 평균. 시도 행도 여기서 채워지지만 곧바로 ② 가 덮어쓴다.
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

-- ② 시도는 밀도 정점으로 덮어쓴다(TRIP-1225). 시도에는 군집이 여럿이라 평균이 군집 사이 빈 땅에
-- 떨어진다 — 제주는 북(제주시)·남(서귀포) 두 군집의 평균이 (33.389, 126.511) 한라산 북사면이었고
-- 2km 안에 숙소·장소가 한 건도 없었다. 시드 기준(2026-10) 16개 시도 중 10곳이 그랬다.
-- '점이 가장 많은 시군구의 중심'도 기각했다 — 펜션·관광지가 몰린 외곽으로 끌린다
-- (로컬 DB 실측: 인천→강화군·대구→동구·울산→울주군).
--
-- 방법: 점이 있는 격자 칸마다 그 칸과 이웃 8칸(3×3 창)의 점을 세어 가장 많은 창을 고르고, 그 창 안
-- 점들의 평균을 쓴다. 칸은 위도 0.02°(≈2.2km) × 경도 0.025°(위도 33~38° 에서 ≈2.2~2.3km)로 거의
-- 정사각이고, 창(≈6.7km 사방)은 시가지 하나 크기다. 칸 하나가 아니라 창으로 세는 것은 칸 경계가
-- 시가지 하나를 갈라 더 작은 군집에 지는 것을 막으려는 것이고, 창 안 평균을 쓰는 것은 좌표가 칸
-- 모서리가 아니라 점이 실제로 모인 곳에 떨어지게 하려는 것이다. 동률이면 남쪽·서쪽 칸 — 같은 데이터면
-- 늘 같은 좌표다.
WITH pts AS (   -- ① 과 같은 점 집합
  SELECT region_code, lat, lng FROM stay WHERE region_code IS NOT NULL
  UNION ALL
  SELECT region_code, lat, lng FROM poi WHERE region_code IS NOT NULL AND data_status = 'ACTIVE'
),
cell AS (       -- 시도 = 코드 앞 두 자리 — 그 안 시군구 점을 전부 포함한다
  SELECT left(region_code, 2) AS sido, lat, lng,
         floor(lat / 0.02)::int AS gy, floor(lng / 0.025)::int AS gx
    FROM pts
),
cnt AS (
  SELECT sido, gy, gx, count(*) AS n FROM cell GROUP BY sido, gy, gx
),
win AS (        -- 칸마다 3×3 창 합계
  SELECT a.sido, a.gy, a.gx, sum(b.n) AS n
    FROM cnt a JOIN cnt b
      ON b.sido = a.sido
     AND b.gy BETWEEN a.gy - 1 AND a.gy + 1
     AND b.gx BETWEEN a.gx - 1 AND a.gx + 1
   GROUP BY a.sido, a.gy, a.gx
),
peak AS (
  SELECT DISTINCT ON (sido) sido, gy, gx
    FROM win
   ORDER BY sido, n DESC, gy, gx
)
UPDATE region r
   SET lat = c.lat, lng = c.lng, updated_at = now()
  FROM (
    SELECT k.sido, avg(p.lat) AS lat, avg(p.lng) AS lng
      FROM peak k JOIN cell p
        ON p.sido = k.sido
       AND p.gy BETWEEN k.gy - 1 AND k.gy + 1
       AND p.gx BETWEEN k.gx - 1 AND k.gx + 1
     GROUP BY k.sido
  ) c
 WHERE r.region_code = c.sido;

-- 데이터가 한 건도 없는 **목적지**는 시도 중심으로 채운다. 거친 값이지만 앵커가 아예 없는 것보다 낫다
-- — 없으면 그 지역 여행이 빈 일정이 된다. 현재 과천시·의성군 2곳이 해당한다.
-- 행정구(selectable=false)는 채우지 않는다 — 목적지로 고를 수 없어 앵커가 필요 없다.
UPDATE region r
   SET lat = s.lat, lng = s.lng, updated_at = now()
  FROM region s
 WHERE r.lat IS NULL AND r.selectable
   AND s.region_code = r.sido_code AND s.lat IS NOT NULL;
