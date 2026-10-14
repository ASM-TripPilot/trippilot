import type { ImageSourcePropType } from 'react-native';

import { REGION_COVERS } from '../config/regionCovers';
import type { TripDestination } from '../model';

/**
 * 여행 카드·홈 히어로의 지역 커버 — 첫 목적지(seq 최소)의 `regionCode` 로 번들 이미지를 찾는다.
 * 시군구 그림이 없으면 같은 시도(앞 2자리) 그림으로, 그마저 없거나(서울·부산·제주 밖) 코드가 없으면
 * null — 호출부가 지금처럼 그라데이션으로 폴백한다(이름만 받은 옛 여행·동명이지역 포함).
 */
export function pickRegionCover(
  destinations: readonly Pick<TripDestination, 'seq' | 'regionCode'>[] | undefined
): ImageSourcePropType | null {
  if (!destinations || destinations.length === 0) return null;
  const first = destinations.reduce((a, b) => (b.seq < a.seq ? b : a));
  const code = first.regionCode?.trim();
  if (!code) return null;
  return REGION_COVERS[code] ?? REGION_COVERS[code.slice(0, 2)] ?? null;
}
