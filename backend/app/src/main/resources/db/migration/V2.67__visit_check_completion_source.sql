-- 방문 실적에 완료 출처와 자동 억제 표식을 단다(U10 M-U10-a **1단계**, TRIP-1402).
--
-- V2.67 — 착수 시점 최신(V2.66) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-14).
--
-- **CHECK `(completed_at IS NULL) = (completion_source IS NULL)` 은 여기 넣지 않는다**(2단계, TRIP-1408).
-- 롤링 배포 창에는 새 파드가 이 마이그레이션을 돌린 뒤에도 옛 파드가 요청을 받는다. 옛 코드는 완료를 쓸 때
-- 출처를 채우지 않으므로 CHECK 가 그 쓰기를 거절해 그 창의 수동 [방문 완료]가 500 이 된다(shared-infrastructure §U10.4).
-- `NOT VALID` 는 기존 행 검사만 건너뛸 뿐 새 쓰기는 검사하므로 이 창을 막지 못한다. 옛 파드가 사라진 다음 배포에서
-- 재백필과 함께 건다.

-- 완료 출처(DEC-U10-6). 완료가 있을 때만 있다(INV-U10-3). 자동 완료 두 갈래와 수동.
ALTER TABLE visit_check ADD COLUMN completion_source varchar(20)
  CHECK (completion_source IN ('AUTO_GEOFENCE_EXIT', 'AUTO_NEXT_ARRIVAL', 'MANUAL'));

-- 자동 도착을 되돌린 시각. 값이 있는 그날 그 슬롯에는 자동 쓰기를 거절한다(INV-U10-10). 수동 도착은 이 행을 재사용한다.
ALTER TABLE visit_check ADD COLUMN auto_suppressed_at timestamptz;

-- 지금까지의 완료는 전부 수동이다 — 자동 완료 경로가 0 이었다.
UPDATE visit_check SET completion_source = 'MANUAL' WHERE completed_at IS NOT NULL AND completion_source IS NULL;

COMMENT ON COLUMN visit_check.source IS '도착 출처(AUTO_GEOFENCE·MANUAL). 완료 출처는 completion_source 다(DEC-U10-6).';
