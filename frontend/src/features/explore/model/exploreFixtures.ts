import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { PlaceDataStatus, PoiCategory } from '@/shared/api/generated/schemas';

/**
 * dev 프리뷰(`_dev/preview`) 전용 픽스처 — `homeFixtures.ts` 선례와 같은 자리.
 *
 * 왜 있나: d04·d02 의 **results 얼굴**은 딥링크로 실화면에 들어가서는 볼 수 없다. 백엔드가
 * 401 이면 d04 는 항상 `error` 로, 세션이 없으면 d02 는 항상 게스트 안내로 떨어진다.
 * 프리뷰가 props 에 이 값을 직접 넣어 그 얼굴을 그린다.
 *
 * ⚠️ `imageUrl` 은 전부 `null` 이다 — 이것이 **지금 프로덕션의 실제 모습**이다. 서버 시드도
 * 수집 게이트도 값을 채우지 않고(TRIP-219 `c5139e9`), 클라가 외부 URL 을 지어내는 것은
 * INV-1 이 막는다. 회색 자리로 보이는 것은 구현 실패가 아니다.
 */

const place = (
  poiId: string,
  nameKo: string,
  category: PoiCategory,
  region: string,
  tags: string[],
  savedCount: number,
  dataStatus: PlaceDataStatus = PlaceDataStatus.ACTIVE
): Place => ({
  poiId,
  nameKo,
  category,
  lat: 35.1,
  lng: 129.0,
  region,
  openingHours: null,
  imageUrl: null,
  tags,
  savedCount,
  dataStatus,
});

/** 2열 그리드가 3행 차도록 6장. 카테고리·태그·저장수를 흩어 카드 변형을 한눈에 본다. */
export const PREVIEW_PLACES: Place[] = [
  place('p-1', '감천문화마을', PoiCategory.명소, '사하구', ['감성 골목'], 1284),
  place(
    'p-2',
    '광안리 해변',
    PoiCategory.자연,
    '수영구',
    ['바다', '야경'],
    2077
  ),
  place('p-3', '전포 카페거리', PoiCategory.카페, '부산진구', ['카페'], 934),
  place('p-4', '자갈치시장', PoiCategory.맛집, '중구', ['미식'], 1502),
  place('p-5', '황령산 전망대', PoiCategory.야경, '남구', ['야경'], 611),
  place('p-6', '해운대 블루라인', PoiCategory.명소, '해운대구', ['바다'], 1810),
];

/** 담긴 상태 2장 — 하트 채움 + "담음" 배지 + 하단 CTA 숫자를 동시에 보이게 한다. */
export const PREVIEW_SAVED_POI_IDS: string[] = ['p-2', 'p-4'];

/**
 * d02 목록. `savedAt` 오름차순이 담은 순서이고 순번 배지 1..N 이 그 뜻이다.
 * 폐업·미검증을 한 건씩 섞어 `dataStatus` 배지 두 종을 프리뷰에서 확인할 수 있게 한다
 * (담기 목록은 ACTIVE 가 아닌 것도 포함한다 — 계약 스키마 설명).
 */
export const PREVIEW_SAVED_PLACES: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T09:00:00Z',
    place: PREVIEW_PLACES[1],
  },
  {
    savedPlaceId: 'sp-2',
    savedAt: '2026-08-02T10:30:00Z',
    place: PREVIEW_PLACES[3],
  },
  {
    savedPlaceId: 'sp-3',
    savedAt: '2026-08-03T14:15:00Z',
    place: place(
      'p-7',
      '초량 이바구길',
      PoiCategory.명소,
      '동구',
      ['감성 골목'],
      402,
      PlaceDataStatus.UNVERIFIED
    ),
  },
  {
    savedPlaceId: 'sp-4',
    savedAt: '2026-08-04T18:40:00Z',
    place: place(
      'p-8',
      '옛 백제병원 카페',
      PoiCategory.카페,
      '동구',
      ['카페'],
      158,
      PlaceDataStatus.CLOSED
    ),
  },
];
