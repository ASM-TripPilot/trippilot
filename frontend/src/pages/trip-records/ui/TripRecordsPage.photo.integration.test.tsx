import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { VisitPhoto } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * TRIP-1070 · j01 방문 카드의 사진 — `+` 로 붙이고, 이 기기 사진은 실제 썸네일로 보인다.
 *
 * 무엇을 보장하나:
 *  - AC-4  도착한 방문 카드에 `+` 가 있고, 누르고 1장 고르면 POST 1회 → 다시 불러온 목록에 그 사진 칸이 는다.
 *  - AC-5  서버 사진의 기기 = 이 설치 + 앨범에서 찾음 → 실제 썸네일(`<Image>`, 앨범 주소).
 *  - AC-6  다른 기기 사진 → "다른 기기에서 찍은 사진"(썸네일 0). 같은 기기인데 못 찾음 → "사진을 불러올 수 없어요".
 *  - F5    이 설치의 식별자를 아직 모르는 동안엔 "다른 기기" 로 잘못 그리지 않는다(깜빡임 금지).
 *  - AC-8  좌표는 GPS 기록 동의가 켜졌을 때만 싣는다.
 *  - AC-9·10  취소는 조용히, 권한 거부·자산 번호 없음·피커 실패는 카드 안 안내 한 줄(다음 `+` 에 지워진다).
 *  - AC-11 저장 실패는 "업로드 실패" 칸 + [다시 시도](TRIP-760 무회귀).
 *
 * 왜 이렇게 테스트하나:
 *  - 앨범(`@/shared/photo`)과 설치 식별자(`@/shared/storage/installId`)는 네이티브라 가짜로 바꾼다.
 *    식별자는 **딥 경로**를 가짜로 잡는다 — 배럴(`@/shared/storage`)로 가져오면 아래 배럴 목에 함수가
 *    없어 깨진다(02a ★5, 배럴 재수출 금지).
 *  - 서버 사진 목록을 `serverPhotos` 한 곳에 두고 POST 가 거기에 더한다 — 재조회가 "서버값"을 읽는다.
 *
 * (개념) `within(카드)` = 그 카드 안에서만 찾기 · 정규식 testID = 상태 4종 칸을 한 번에 세기 ·
 *   deferred = 테스트가 원할 때 끝나는 약속(식별자 로딩 중 상태를 붙잡아 두려고).
 * 3동작: 준비(서버 사진·식별자·앨범 응답) → 실행(렌더·`+` 누르기) → 단언(칸 testID·요청 본문·안내 문구).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => {
  const router = {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
  };
  return { router, useRouter: () => router };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const mockPick = jest.fn();
const mockResolveUri = jest.fn();
jest.mock('@/shared/photo', () => ({
  pickPhotoAsset: () => mockPick(),
  resolvePhotoUri: (id: string) => mockResolveUri(id),
}));

const mockGetInstallId = jest.fn();
jest.mock('@/shared/storage/installId', () => ({
  getInstallId: () => mockGetInstallId(),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY = '2026-08-20';
const CARD = 'record-trip-visit-card-v-a';
const NOTICE = 'record-trip-photo-notice-v-a';
const PHOTOS_POST = `POST /api/v1/trips/${TRIP_ID}/visits/v-a/photos`;
const PHOTOS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/v-a/photos`;
const ANY_CELL =
  /^record-photo-(available|other-device|unavailable|upload-failed)-/;

const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';
const COPY_NO_ASSET_ID =
  '선택한 사진을 불러올 수 없어요. 사진 전체 접근을 허용해 주세요';
const COPY_FAILED = '사진을 불러올 수 없어요';

const asset = (localAssetId = 'asset-new') => ({
  localAssetId,
  deviceId: 'dev-A',
  takenAt: '2026-08-20T04:30:00.000Z',
  exifLat: 35.1532,
  exifLng: 129.1186,
});

const serverPhoto = (
  visitPhotoMetaId: string,
  localAssetId: string,
  deviceId: string
): VisitPhoto => ({
  visitPhotoMetaId,
  localAssetId,
  deviceId,
  takenAt: null,
  exifLat: null,
  exifLng: null,
  sortOrder: 0,
});

function daySlot(poiId: string, nameKo: string) {
  return {
    poiId,
    nameKo,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [] as string[],
  };
}

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [{ date: DAY, slots: [daySlot('p1', '광안리 해변')] }],
  };
}

function completedVisit() {
  return {
    visitCheckId: 'v-a',
    slotKey: `${DAY}#p1`,
    poiId: 'p1',
    arrivedAt: `${DAY}T14:20:00`,
    completedAt: `${DAY}T15:20:00`,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: `${DAY}T15:20:00`,
  };
}

const consent = (gpsRecordingOptIn: boolean) => ({
  osPermissionMirror: 'GRANTED',
  // GPS 기록과 반대로 둔다 — 엉뚱한 필드를 읽으면 결과가 뒤집힌다(02a ★3).
  legalConsent: !gpsRecordingOptIn,
  gpsRecordingOptIn,
  capabilities: {
    localLocationUse: !gpsRecordingOptIn,
    serverLocationService: !gpsRecordingOptIn,
    gpsTrackRetention: gpsRecordingOptIn,
  },
});

let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;
let serverPhotos: VisitPhoto[] = [];
let photoBodies: Record<string, unknown>[] = [];
let photoStatus = 201;
let gpsOptIn = true;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

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
  serverPhotos = [];
  photoBodies = [];
  photoStatus = 201;
  gpsOptIn = true;
  mockPick.mockReset().mockResolvedValue({ kind: 'picked', asset: asset() });
  mockResolveUri
    .mockReset()
    .mockImplementation(async (id: string) => `file:///photos/${id}.jpg`);
  mockGetInstallId.mockReset().mockResolvedValue('dev-A');
  setAccessToken('a');
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [completedVisit()] })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/me/location-consent`, () =>
      HttpResponse.json(consent(gpsOptIn))
    ),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: serverPhotos, count: serverPhotos.length })
    ),
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
        const created = serverPhoto(
          'ph-new',
          String(body.localAssetId),
          String(body.deviceId)
        );
        serverPhotos = [...serverPhotos, created];
        return HttpResponse.json(created, { status: 201 });
      }
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  resetPressGuard();
});
afterAll(() => server.close());

async function renderCard() {
  render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
  return screen.findByTestId(CARD);
}

describe('🔴 AC-4 · 도착한 방문 카드의 `+` 로 사진을 붙인다', () => {
  it('R1 `+` → 1장 선택 → POST 1회 → 다시 불러온 목록에 그 사진 칸이 하나 는다', async () => {
    const card = await renderCard();
    const add = await within(card).findByTestId('record-trip-photo-add');
    expect(within(card).queryAllByTestId(ANY_CELL)).toHaveLength(0);

    fireEvent.press(add);

    await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
    expect(photoBodies[0]).toMatchObject({
      localAssetId: 'asset-new',
      deviceId: 'dev-A',
    });
    expect(
      await within(card).findByTestId('record-photo-available-ph-new')
    ).toBeOnTheScreen();
    expect(within(card).queryAllByTestId(ANY_CELL)).toHaveLength(1);
  });
});

describe('🔴 AC-5·AC-6 · 사진 칸은 기기와 앨범 결과로 갈린다 (BR-U5-14/15 · INV-4)', () => {
  it('R2 이 설치에서 붙인 사진이고 앨범에서 찾으면 실제 썸네일(앨범 주소)로 그린다', async () => {
    serverPhotos = [serverPhoto('ph1', 'asset-1', 'dev-A')];
    await renderCard();

    const image = await screen.findByTestId('record-photo-thumb-image-ph1');

    expect(image.props.source).toEqual({ uri: 'file:///photos/asset-1.jpg' });
    expect(screen.getByTestId('record-photo-available-ph1')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-photo-other-device-ph1')).toBeNull();
    expect(mockResolveUri).toHaveBeenCalledWith('asset-1');
  });

  it('R3 다른 기기 사진은 "다른 기기" 칸(썸네일 0), 같은 기기인데 앨범에서 못 찾으면 "불러올 수 없어요" 칸', async () => {
    serverPhotos = [
      serverPhoto('ph-other', 'asset-2', 'dev-B'),
      serverPhoto('ph-gone', 'asset-3', 'dev-A'),
    ];
    mockResolveUri.mockImplementation(async (id: string) =>
      id === 'asset-3' ? null : `file:///photos/${id}.jpg`
    );
    await renderCard();

    expect(
      await screen.findByTestId('record-photo-other-device-ph-other')
    ).toBeOnTheScreen();
    expect(
      await screen.findByTestId('record-photo-unavailable-ph-gone')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('record-photo-thumb-image-ph-other')
    ).toBeNull();
    expect(screen.queryByTestId('record-photo-thumb-image-ph-gone')).toBeNull();
  });

  it('R4 (F5) 설치 식별자를 아직 모르는 동안엔 "다른 기기" 로 그리지 않고, 알게 되면 썸네일로 바뀐다', async () => {
    // 준비 — 식별자 로딩을 붙잡아 둔다.
    // 몇 번을 물어도 같은 약속 하나(실제 getInstallId 도 약속 하나를 기억한다).
    let release: (id: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    mockGetInstallId.mockImplementation(() => pending);
    serverPhotos = [serverPhoto('ph1', 'asset-1', 'dev-A')];
    await renderCard();
    await waitFor(() => expect(hitCount(PHOTOS_GET)).toBeGreaterThan(0));
    await settle();

    // 단언 — 서버 사진은 도착했지만 식별자를 모르므로 "다른 기기" 칸이 없다.
    expect(screen.queryByTestId('record-photo-other-device-ph1')).toBeNull();

    // 실행 — 식별자 도착.
    await act(async () => {
      release('dev-A');
    });

    expect(
      await screen.findByTestId('record-photo-available-ph1')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('record-photo-other-device-ph1')).toBeNull();
  });
});

describe('🔴 AC-8 · j01 에서도 좌표는 GPS 기록 동의가 켜졌을 때만 (BR-U5-12)', () => {
  it.each([
    ['켜짐 → 좌표 있음', true],
    ['꺼짐 → 좌표 키 없음', false],
  ])('R5 GPS 기록 동의 %s', async (_label, optIn) => {
    gpsOptIn = optIn;
    const card = await renderCard();

    fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));

    await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
    const body = photoBodies[0] ?? {};
    if (optIn) {
      expect(body).toMatchObject({ exifLat: 35.1532, exifLng: 129.1186 });
    } else {
      expect(body).not.toHaveProperty('exifLat');
      expect(body).not.toHaveProperty('exifLng');
    }
  });
});

describe('🔴 AC-9·AC-10·AC-11 · 실패 경로', () => {
  it('R6 앨범에서 취소하면 요청도 안내도 없다', async () => {
    mockPick.mockResolvedValue({ kind: 'canceled' });
    const card = await renderCard();

    fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));
    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
    await settle();

    expect(hitCount(PHOTOS_POST)).toBe(0);
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it.each([
    ['사진 권한 거부', 'denied', COPY_DENIED],
    ['자산 번호 없음(선택한 사진만 허용)', 'no-asset-id', COPY_NO_ASSET_ID],
    ['피커 실패(재빌드 전 앱)', 'failed', COPY_FAILED],
  ])(
    'R7 %s → 카드 안 안내가 뜨고 요청은 0회, 다음 `+` 에 안내가 지워진다',
    async (_label, kind, copy) => {
      mockPick.mockResolvedValueOnce({ kind });
      const card = await renderCard();
      const add = await within(card).findByTestId('record-trip-photo-add');

      fireEvent.press(add);

      expect(await within(card).findByTestId(NOTICE)).toHaveTextContent(copy);
      await settle();
      expect(hitCount(PHOTOS_POST)).toBe(0);

      // 실행 — 다시 `+`(이번엔 취소).
      mockPick.mockResolvedValueOnce({ kind: 'canceled' });
      fireEvent.press(within(card).getByTestId('record-trip-photo-add'));
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(2));
      await settle();

      expect(screen.queryByTestId(NOTICE)).toBeNull();
    }
  );

  it('R8 저장 요청이 실패하면(500) "업로드 실패" 칸과 카드 [다시 시도]가 뜬다', async () => {
    photoStatus = 500;
    mockPick.mockResolvedValue({ kind: 'picked', asset: asset('asset-9') });
    const card = await renderCard();

    fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));

    expect(
      await within(card).findByTestId('record-photo-upload-failed-asset-9')
    ).toBeOnTheScreen();
    expect(
      within(card).getByTestId('record-trip-upload-retry-v-a')
    ).toBeOnTheScreen();
  });
});
