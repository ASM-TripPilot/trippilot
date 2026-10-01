import type { Trip } from '@/shared/api/generated/schemas';

/**
 * `GET /trips/{tripId}` 응답 픽스처(Trip 스키마 필수 필드 전부) — j01 방문 기록 통합 테스트 공용.
 *
 * TRIP-1085 부터 j01 페이지가 시트 헤더 여행명(`title`)을 얻으려고 이 GET 을 쏜다. 통합 테스트는
 * MSW `onUnhandledRequest: 'error'` 라 파일마다 핸들러가 있어야 한다 — 모양을 한 곳에 둔다.
 */
export function tripRecordsTrip(title = '부산 여행', tripId = 't1'): Trip {
  return {
    tripId,
    title,
    startDate: '2026-08-20',
    endDate: '2026-08-22',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 3,
  };
}
