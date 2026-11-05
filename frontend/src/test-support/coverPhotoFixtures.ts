import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';

import type {
  ActualVisit,
  TripRecord,
  VisitPhoto,
} from '@/shared/api/index.schemas';

import { BASE } from './apiBase';

/**
 * TRIP-1781 · 여행 표지 기기 사진 통합 테스트 공용 조각 — 훅(`useTripCoverPhoto`)·j04 요약·j06 공유 카드 세 통합 파일이 같이 쓴다.
 * 초심자용: "records"는 여행 전체의 방문 목록(방문마다 사진 **개수** `photoCount`), "사진 메타"는 방문 하나의 사진 목록(주소가 아니라
 * 기기 앨범 id `localAssetId` 와 찍은 기기 `deviceId`). 서버에는 사진 파일이 없다.
 *
 * `server` 는 인자로 받는다(이 파일이 `@/mocks/server` 를 import 하지 않는다 — `mswItinerary` 와 같은 모양).
 */

export const COVER_TRIP_ID = 'trip-1';
/** 이 기기 id — 각 테스트 파일이 `@/shared/storage` 의 `getInstallId` 를 이 값으로 목한다. */
export const THIS_DEVICE = 'me';
export const OTHER_DEVICE = 'someone-else';

export function visitOf(
  id: string,
  photoCount: number,
  over: Partial<ActualVisit> = {}
): ActualVisit {
  return {
    visitCheckId: id,
    poiId: `poi-${id}`,
    spontaneous: false,
    photoCount,
    hasMemo: false,
    updatedAt: '2026-06-11T10:00:00Z',
    ...over,
  };
}

/** 하루짜리 기록 — 방문 배열 순서가 곧 도착 순서(서버 계약). */
export function recordOf(
  visits: ActualVisit[],
  tripId: string = COVER_TRIP_ID
): TripRecord {
  return {
    tripId,
    days: [
      {
        date: '2026-06-11',
        planned: [],
        actual: visits,
        unvisitedSlotKeys: [],
      },
    ],
    changes: [],
  };
}

export function photoOf(
  localAssetId: string,
  deviceId: string = THIS_DEVICE,
  sortOrder = 0
): VisitPhoto {
  return {
    visitPhotoMetaId: `meta-${localAssetId}`,
    localAssetId,
    deviceId,
    sortOrder,
  };
}

export type Reply<T> = T | Response | Promise<T | Response>;

async function toResponse<T>(reply: Reply<T>): Promise<Response> {
  const body = await reply;
  return body instanceof Response ? body : HttpResponse.json(body as object);
}

/**
 * 여행 기록 + 방문별 사진 메타 핸들러를 건다(기본 빈 기록 핸들러 `mocks/handlers.ts` 를 덮는다).
 * `photos` 에 없는 방문 id 를 부르면 404 — 테스트가 "묻지 않아야 할 방문"을 물었다는 신호로 읽는다.
 */
export function serveCoverPhotos(
  server: SetupServer,
  {
    record,
    photos = {},
  }: {
    record: () => Reply<TripRecord>;
    photos?: Record<string, () => Reply<VisitPhoto[]>>;
  }
): void {
  server.use(
    http.get(`${BASE}/trips/:tripId/records`, () => toResponse(record())),
    http.get(
      `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
      async ({ params }) => {
        const make = photos[String(params.visitCheckId)];
        if (!make) return new HttpResponse(null, { status: 404 });
        const reply = await make();
        if (reply instanceof Response) return reply;
        return HttpResponse.json({ items: reply, count: reply.length });
      }
    )
  );
}
