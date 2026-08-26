-- 방문 사진 **메타**(U5 · TRIP-542). 바이너리는 여기에도 어디에도 없다.
--
-- 번호 근거: develop 최신이 V2.28 이고 V2.31·V2.32 는 TRIP-547(알림)이 가져갔다.
-- V2.29·V2.30 은 비워 둔다 — 앞 번호를 뒤늦게 채우면 이미 V2.31 을 적용한 환경에서 Flyway 가 거부한다.
--
-- **INV-U5-03 — 서버에 사진 바이너리를 저장하지 않는다**(DEC-U5-9).
-- `storage_key`·`url`·`bytes` 류 컬럼을 **만들지 않는다.** 만들어 두면 다음 사이클이 채운다.
-- 화면은 기기 로컬 자산을 직접 렌더하고, 서버는 "어느 자산이 어느 방문에 붙었나"만 안다.

CREATE TABLE visit_photo_meta (
  visit_photo_meta_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_check_id      uuid NOT NULL REFERENCES visit_check(visit_check_id) ON DELETE CASCADE,
  -- 기기 로컬 자산 식별자(iOS PHAsset localIdentifier · Android MediaStore id).
  -- 기기 안에서만 뜻이 있는 값이라 다른 기기에서는 못 연다 — 그래서 device_id 를 함께 남긴다(BR-U5-15).
  local_asset_id      varchar(200) NOT NULL,
  device_id           varchar(64)  NOT NULL,
  taken_at            timestamptz,
  -- INV-U5-04 위치 동의(gps_recording_opt_in)가 없으면 **받지도 저장하지도 않는다.**
  -- 사진에 좌표가 박혀 있어도 서버는 안 받는다 — 판정은 요청 시점의 동의 상태로 한다.
  exif_lat            double precision,
  exif_lng            double precision,
  sort_order          int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- 같은 기기의 같은 자산을 한 방문에 두 번 붙일 수 없다. 화면이 중복 선택을 걸러도
  -- 재시도·동시 요청이 통과하므로 DB 가 판정한다.
  CONSTRAINT ux_visit_photo_meta_asset UNIQUE (visit_check_id, device_id, local_asset_id)
);

-- 방문별 목록·개수 조회의 유일한 경로. 정렬까지 인덱스가 덮는다.
CREATE INDEX ix_visit_photo_meta_visit ON visit_photo_meta (visit_check_id, sort_order);
