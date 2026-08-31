import type { ReflectionStats } from '@/shared/api/generated/schemas';

/**
 * TRIP-571 · missingParts — 부분 데이터면 누락을 명시한다(BR-U5-34, 조용히 칸을 지우지 않는다).
 *
 * 무엇을 보장하나:
 *  - `photoCount === 0` → `hidePhotoGrid=true`(사진 그리드 자리에 "사진 없음").
 *  - `visitCount < 2` → `mapNotice`(지도 자리 사유 문자열, 비지 않음) + `distanceDash=true`(거리 "—").
 *  - 데이터가 충분하면(방문 2+·사진 1+) 세 신호 모두 꺼진다(mapNotice=null).
 *
 * ★ `distanceKm` 은 required number(null 없음)라 "—"는 값이 아니라 **판정 플래그**(distanceDash)로 낸다 —
 * VISIT_LINE 근사가 방문점 2개 이상을 이어야 성립하므로 1곳 이하는 이동 거리가 무의미(01b Q2). statsCard 는
 * raw 숫자만 담고, 대시 판정은 여기서 한다.
 */

/** 지도 자리 사유 — Figma data-insufficient 카피(6-b 픽셀 소관, 여기선 "비지 않음"만 계약). */
const MAP_NOTICE = '위치 기록 없음 · GPS 미동으로 지도를 만들 수 없어요';

export interface MissingParts {
  hidePhotoGrid: boolean;
  mapNotice: string | null;
  distanceDash: boolean;
}

export function missingParts(stats: ReflectionStats): MissingParts {
  const noRoute = stats.visitCount < 2;
  return {
    hidePhotoGrid: stats.photoCount === 0,
    mapNotice: noRoute ? MAP_NOTICE : null,
    distanceDash: noRoute,
  };
}
