import type { ReflectionStats } from '@/shared/api/index.schemas';

/**
 * TRIP-571 · missingParts — 부분 데이터면 누락을 명시한다(BR-U5-34, 조용히 칸을 지우지 않는다).
 *
 * 무엇을 보장하나:
 *  - `photoCount === 0` → `hidePhotoGrid=true`(사진 그리드 자리에 "사진 없음").
 *  - `visitCount < 2` → `distanceDash=true`(거리 "—").
 *  - `mapNotice` 는 늘 `{reason, title, body}` 다(TRIP-1118). 방문 ≤1 → few-visits(권한 무관) / 방문 ≥2 ·
 *    권한 거부 → permission / 그 밖(허용·모름·미주입) → no-route(BR-U5-55 실동선 미실장). 보일지 말지는
 *    페이지의 얼굴 판정이 정한다(default 얼굴엔 박스 없음).
 *
 * ★ `distanceKm` 은 required number(null 없음)라 "—"는 값이 아니라 **판정 플래그**(distanceDash)로 낸다 —
 * VISIT_LINE 근사가 방문점 2개 이상을 이어야 성립하므로 1곳 이하는 이동 거리가 무의미(01b Q2). statsCard 는
 * raw 숫자만 담고, 대시 판정은 여기서 한다.
 */

/** 단말 위치 권한 3값 — 조회 실패·미결정(undetermined)은 "모름"이라 권한 사유를 말하지 않는다(Seed Q3). */
export type LocationPermissionState = 'granted' | 'denied' | 'unknown';

export type MapNoticeReason = 'few-visits' | 'permission' | 'no-route';

export interface MapNotice {
  reason: MapNoticeReason;
  title: string;
  body: string;
}

/** 지도 자리 사유 문구(브리프 보수안 — 아침 판단 Q1 대상). */
const MAP_NOTICES: Record<MapNoticeReason, MapNotice> = {
  'few-visits': {
    reason: 'few-visits',
    title: '동선 없음',
    body: '방문 기록이 2곳 미만이에요',
  },
  permission: {
    reason: 'permission',
    title: '위치 권한 꺼짐',
    body: '위치 권한이 꺼져 있어 이동 경로를 기록하지 않아요',
  },
  'no-route': {
    reason: 'no-route',
    title: '동선 지도 없음',
    body: '실제 이동 경로 지도는 아직 지원하지 않아요',
  },
};

export interface MissingParts {
  hidePhotoGrid: boolean;
  mapNotice: MapNotice;
  distanceDash: boolean;
}

export function missingParts(
  stats: ReflectionStats,
  permission: LocationPermissionState = 'unknown'
): MissingParts {
  const fewVisits = stats.visitCount < 2;
  const reason: MapNoticeReason = fewVisits
    ? 'few-visits'
    : permission === 'denied'
      ? 'permission'
      : 'no-route';
  return {
    hidePhotoGrid: stats.photoCount === 0,
    mapNotice: MAP_NOTICES[reason],
    distanceDash: fewVisits,
  };
}
