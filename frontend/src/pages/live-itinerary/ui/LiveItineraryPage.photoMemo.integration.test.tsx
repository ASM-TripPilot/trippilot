import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Itinerary, VisitCheck } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-1070 · i01 허브 관람 중 카드의 [사진]·[메모] 개통 — 실 페이지 + 실제 HTTP(MSW).
 *
 * 무엇을 보장하나:
 *  - AC-1  관람 중 방문이 있으면 [사진]·[메모]가 서고, 옛 "준비 중" 힌트는 없다.
 *  - AC-2  [사진] → 앨범에서 1장 → `POST …/visits/{관람 중 방문}/photos` 1회, 본문엔 자산 번호·설치 식별자.
 *  - AC-3  [메모] → 이동하지 않고 허브 위 메모 시트가 열린다(TRIP-1117 이 TRIP-1070 결정 1(c) "j01 그날로
 *          이동"을 뒤집었다). 여는 것만으로는 저장 요청이 없다 — 저장·실패·표시 계약은
 *          `LiveItineraryPage.memoSheet.integration.test.tsx`.
 *  - AC-8  좌표는 서버의 GPS 기록 동의(`gpsRecordingOptIn`)가 켜졌을 때만 싣는다. 동의 조회가 실패하면 끈 것으로.
 *  - AC-9·10·12  취소는 조용히, 권한 거부·자산 번호 없음·피커 실패·저장 실패는 카드 아래 안내 한 줄로.
 *  - F6  허브는 사진 목록을 조회하지 않고, 화면을 열 때 동의를 미리 조회하지도 않는다(누른 뒤에만).
 *
 * 왜 이렇게 테스트하나:
 *  - 앨범(`@/shared/photo`)은 네이티브라 가짜로 바꾸고, 서버 요청은 MSW 로 실제 경로·본문을 본다.
 *  - 동의 픽스처는 `legalConsent` 와 `gpsRecordingOptIn` 을 **서로 반대로** 둔다 — 같은 값이면 엉뚱한
 *    필드를 읽어도 통과한다(02a ★3). 켜짐 → 좌표 있음 짝이 없으면 "항상 끔" 구현이 통과한다(★4).
 *
 * (개념) `server.events.on('request:start')` = 실제로 나간 요청을 "메서드 경로" 로 적는 관찰자 ·
 *   `findByTestId` = 나타날 때까지 기다렸다 찾기 · `settle()` = 비동기 일이 끝나도록 잠깐 기다리기.
 * 3동작: 준비(일정·관람 중 방문·앨범 응답) → 실행(버튼 누르기) → 단언(요청 경로·본문·안내 문구·이동).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    setParams: jest.fn(),
  },
}));

const mockPick = jest.fn();
const mockResolveUri = jest.fn();
jest.mock('@/shared/photo', () => ({
  pickPhotoAsset: () => mockPick(),
  resolvePhotoUri: (id: string) => mockResolveUri(id),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const PHOTOS_POST = `POST /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
const PHOTOS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
const CONSENT_GET = 'GET /api/v1/me/location-consent';

const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';
const COPY_NO_ASSET_ID =
  '선택한 사진을 불러올 수 없어요. 사진 전체 접근을 허용해 주세요';
const COPY_FAILED = '사진을 불러올 수 없어요';
const COPY_SAVE_FAILED = '사진을 기록하지 못했어요. 다시 시도해 주세요';

const PICKED_ASSET = {
  localAssetId: 'asset-1',
  deviceId: 'dev-A',
  takenAt: '2026-08-20T04:30:00.000Z',
  exifLat: 35.1532,
  exifLng: 129.1186,
};

const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: TODAY,
        slots: [
          {
            poiId: 'p1',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '감천문화마을',
            distanceRange: null,
            openingHours: null,
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

const trip = () => ({
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: TODAY,
  endDate: '2026-08-22',
  party: 2,
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

/** p1 에 도착했고 아직 완료 전 — 허브에서 관람 중 카드가 된다. */
const arrivedVisit = (): VisitCheck => ({
  visitCheckId: 'v1',
  poiId: 'p1',
  slotKey: `${TODAY}#p1`,
  arrivedAt: '2026-08-20T13:00:00',
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T13:00:05Z',
});

const consent = (legalConsent: boolean, gpsRecordingOptIn: boolean) => ({
  osPermissionMirror: 'GRANTED',
  legalConsent,
  gpsRecordingOptIn,
  capabilities: {
    localLocationUse: legalConsent,
    serverLocationService: legalConsent,
    gpsTrackRetention: gpsRecordingOptIn,
  },
});

let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;
let photoBodies: Record<string, unknown>[] = [];
let photoStatus = 201;
let consentResponse: () => Response;

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 비동기 일(앨범 응답 → 요청)이 끝나도록 잠깐 기다린다 — "요청 0회" 단언이 공허해지지 않게. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  observedHits = [];
  photoBodies = [];
  photoStatus = 201;
  consentResponse = () => HttpResponse.json(consent(true, true));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mockPush.mockReset();
  mockPick.mockReset().mockResolvedValue({
    kind: 'picked',
    asset: PICKED_ASSET,
  });
  mockResolveUri.mockReset().mockResolvedValue(null);
  setAccessToken('a');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [arrivedVisit()] })
    ),
    http.get(`${BASE}/me/location-consent`, () => consentResponse()),
    http.post(
      `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
      async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        photoBodies.push(body);
        if (photoStatus !== 201) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: photoStatus }
          );
        }
        return HttpResponse.json(
          {
            visitPhotoMetaId: 'ph-new',
            localAssetId: body.localAssetId,
            deviceId: body.deviceId,
            takenAt: body.takenAt ?? null,
            exifLat: null,
            exifLng: null,
            sortOrder: 0,
          },
          { status: 201 }
        );
      }
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  client.clear();
});
afterAll(() => server.close());

async function renderHub() {
  render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
  return screen.findByTestId('execution-arrive-photo');
}

describe('🔴 AC-1 · 관람 중 카드에 [사진]·[메모]가 선다', () => {
  it('L1 도착·미완료 방문이 있으면 [사진]·[메모]가 [방문 완료] 옆에 있고, "준비 중" 힌트는 없다', async () => {
    await renderHub();

    expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-arrive-memo')).toBeOnTheScreen();
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
  });
});

describe('🔴 AC-2 · [사진] → 앨범에서 고른 사진의 메타가 관람 중 방문에 붙는다', () => {
  it('L2 1장을 고르면 POST …/visits/v1/photos 가 1회, 본문에 자산 번호와 설치 식별자가 있다', async () => {
    const photo = await renderHub();

    fireEvent.press(photo);

    await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
    expect(photoBodies[0]).toMatchObject({
      localAssetId: 'asset-1',
      deviceId: 'dev-A',
    });
    expect(mockPick).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC-3 · [메모] → 허브를 떠나지 않고 메모 시트가 열린다 (TRIP-1117 · 결정 1(c) 번복)', () => {
  it('L3 [메모]를 누르면 이동은 0회, 허브 위에 메모 시트가 열리고, 여는 것만으로는 메모 저장 요청이 없다', async () => {
    await renderHub();

    fireEvent.press(screen.getByTestId('execution-arrive-memo'));
    await settle();

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('live-memo-sheet')).toBeOnTheScreen();
    expect(observedHits.filter((hit) => hit.endsWith('/memo')).length).toBe(0);
    expect(mockPick).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-8 · 좌표는 GPS 기록 동의가 켜졌을 때만 싣는다 (BR-U5-12 · INV-U5-04)', () => {
  it.each([
    [
      '법적 동의만 켜짐 · GPS 기록 꺼짐 → 좌표 없음',
      () => HttpResponse.json(consent(true, false)),
      false,
    ],
    [
      '법적 동의 꺼짐 · GPS 기록 켜짐 → 좌표 있음',
      () => HttpResponse.json(consent(false, true)),
      true,
    ],
    [
      '동의 조회 실패(500) → 끈 것으로 보고 좌표 없음',
      () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom' } },
          { status: 500 }
        ),
      false,
    ],
  ])('L4 %s', async (_label, response, expectCoords) => {
    consentResponse = response;
    const photo = await renderHub();

    fireEvent.press(photo);

    // 동의 조회가 실패해도 사진 기록은 막지 않는다 — POST 는 나간다.
    await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
    const body = photoBodies[0] ?? {};
    if (expectCoords) {
      expect(body).toMatchObject({ exifLat: 35.1532, exifLng: 129.1186 });
    } else {
      expect(body).not.toHaveProperty('exifLat');
      expect(body).not.toHaveProperty('exifLng');
    }
  });
});

describe('🔴 AC-9·AC-10·AC-12 · 실패 경로 — 취소는 조용히, 나머지는 안내 한 줄', () => {
  it('L5 앨범에서 취소하면 요청도 안내도 없다', async () => {
    mockPick.mockResolvedValue({ kind: 'canceled' });
    const photo = await renderHub();

    fireEvent.press(photo);
    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
    await settle();

    expect(hitCount(PHOTOS_POST)).toBe(0);
    expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
  });

  it.each([
    ['사진 권한 거부', 'denied', COPY_DENIED],
    ['자산 번호 없음(선택한 사진만 허용)', 'no-asset-id', COPY_NO_ASSET_ID],
    ['피커 실패(재빌드 전 앱)', 'failed', COPY_FAILED],
  ])(
    'L6 %s → 카드 아래 안내가 뜨고 요청은 0회다',
    async (_label, kind, copy) => {
      mockPick.mockResolvedValue({ kind });
      const photo = await renderHub();

      fireEvent.press(photo);

      expect(
        await screen.findByTestId('execution-arrive-photo-notice')
      ).toHaveTextContent(copy);
      await settle();
      expect(hitCount(PHOTOS_POST)).toBe(0);
      expect(hitCount(CONSENT_GET)).toBe(0);
    }
  );

  it('L7 사진 기록 요청이 실패하면(500) 저장 실패 안내가 뜬다', async () => {
    photoStatus = 500;
    const photo = await renderHub();

    fireEvent.press(photo);

    expect(
      await screen.findByTestId('execution-arrive-photo-notice')
    ).toHaveTextContent(COPY_SAVE_FAILED);
    expect(hitCount(PHOTOS_POST)).toBe(1);
  });

  it('L8 안내가 뜬 뒤 [사진]을 다시 누르면 안내가 지워진다', async () => {
    mockPick.mockResolvedValueOnce({ kind: 'denied' });
    const photo = await renderHub();
    fireEvent.press(photo);
    expect(
      await screen.findByTestId('execution-arrive-photo-notice')
    ).toHaveTextContent(COPY_DENIED);

    // 실행 — 두 번째는 취소.
    mockPick.mockResolvedValueOnce({ kind: 'canceled' });
    fireEvent.press(screen.getByTestId('execution-arrive-photo'));
    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(2));
    await settle();

    expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
  });
});

describe('🔴 F6 · 허브는 사진 목록을 조회하지 않고, 동의는 누른 뒤에만 읽는다', () => {
  it('L9 화면을 연 뒤 동의 조회 0회 · 사진을 붙인 뒤에도 사진 목록 조회 0회', async () => {
    const photo = await renderHub();
    await settle();

    // 단언 — 누르기 전엔 동의를 조회하지 않는다.
    expect(hitCount(CONSENT_GET)).toBe(0);

    fireEvent.press(photo);
    await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
    await settle();

    // 단언 — 동의는 누른 뒤 1회, 사진 목록 조회는 처음부터 끝까지 0회.
    expect(hitCount(CONSENT_GET)).toBe(1);
    expect(hitCount(PHOTOS_GET)).toBe(0);
  });
});
