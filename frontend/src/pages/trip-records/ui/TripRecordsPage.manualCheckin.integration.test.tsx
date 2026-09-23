import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * 🔴 TRIP-761 · AC-1·AC-2·AC-3·AC-4·AC-5 — j01 manual-checkin **모드 seam + arrive 배선**(완료조건).
 *
 * 위치 권한이 없으면(수동 체크인 모드) 페이지가 expo-location 권한을 읽어 `manualCheckin` 을 화면·카드로
 * 내리고, UPCOMING 카드의 "방문 체크" press 를 `arrive({source:'MANUAL', poiId})` 로 배선한다.
 *
 * 무엇을 보장하나(관측 가능한 결과만):
 *  - 🔴 AC-1·AC-3·AC-4  denied → 배너·⊘ 배지·"방문 체크" pill 이 실 라우트에서 뜬다(모드 판정=페이지).
 *  - 🔴 AC-2  denied → 안내문이 manual 카피(법 문구 "(좌표 자동기록 비활성)" 포함)로 교체되고 default 는 사라진다.
 *  - 🟢 AC-1·AC-3·AC-4 무회귀  granted → 세 표면 전부 부재 + 안내문은 현행 default(일반 모드 무변경).
 *  - 🔴 AC-5  denied + pill press → POST /trips/:tripId/visits 가 `{source:'MANUAL', poiId}` 로 **정확히 1회** 나간다.
 *
 * ★모드 seam(02a §4-★6): 페이지가 `getForegroundPermissionsAsync`(LocationPage 선례)를 읽어 `!granted` 면
 *   manual 모드로 판정. integration 은 그 목의 반환값(denied/granted)으로 모드를 강제한다(프리뷰는 prop 직접).
 * ★arrive=재사용(02a §4-★4): "방문 체크"는 새 HTTP 가 아니라 기존 `postTripsTripIdVisits`(arrive) 를 쓴다 —
 *   POST 본문의 `source:'MANUAL'` 을 정확 단언한다(`ArriveRequestSource.MANUAL` 스키마 실존, BR-U4-36).
 *   arrive 는 무효화 대신 응답으로 낙관 레코드를 교체하므로 POST 는 1회뿐(useVisitCheck 비대칭).
 * ★별 파일(02a §4-★9): 기존 `TripRecordsPage.integration.test.tsx`(759, expo-location 목 없음)를 안 건드린다 —
 *   expo-location 목은 파일 전역이라 얹으면 blast-radius 가 커진다. 신 파일로 격리(무회귀 명료).
 * ★카드 소스(02a §4-★8): UPCOMING 카드는 **방문 쿼리**의 세 timestamp null 레코드(v-up)에서 온다(itinerary
 *   슬롯 아님) — 픽스처가 그날 UPCOMING 방문 1건을 넣어야 ○○ 카페 카드·pill 이 뜬다.
 *
 * (개념) `getForegroundPermissionsAsync`=권한을 "다시 묻지 않고 현재 상태만 조회"(LocationPage 선례) ·
 *   `findByTestId`=비동기 등장 대기 후 조회(권한 effect + 쿼리 완료까지) · `objectContaining({...})`=본문의
 *   부분집합 일치(slotKey 등 추가 필드 허용, seed §3-a 는 source·poiId 만 확정) · `waitFor`=조건 만족까지 폴링.
 */

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY = '2026-08-20';

// OS 권한 seam — expo-location 을 통째로 가짜로 바꿔 denied/granted 를 주입한다(LocationPage.integration 선례).
// jest 는 팩토리 밖 변수를 `mock*` 이름일 때만 허용하므로 지연 래퍼로 참조한다.
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

// 스토리지·라우터는 페이지 마운트가 건드리므로 목킹(기존 records integration 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

// 지도 히어로가 네이티브 지도를 태우므로 관찰 목으로 갈아끼운다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// getForegroundPermissionsAsync 응답(LocationPermissionResponse 부분집합) — granted 만 모드 판정에 쓴다.
const DENIED = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
} as const;
const GRANTED = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
} as const;

// 사용자 가시 카피 = 계약(brief §화면·IO 실측). MANUAL_NOTICE 는 법 문구 "(좌표 자동기록 비활성)" 을 담는다.
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';
const DEFAULT_NOTICE = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

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
    days: [{ date: DAY, slots: [daySlot('p3', '○○ 카페')] }],
  };
}

/** 미방문(UPCOMING) 방문 1건 — 세 timestamp null → 카드가 UPCOMING 으로 파생돼 "방문 체크" pill 진입점이 된다. */
function upcomingVisit() {
  return {
    visitCheckId: 'v-up',
    slotKey: `${DAY}#p3`,
    poiId: 'p3',
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: null,
    spontaneous: false,
    updatedAt: `${DAY}T00:00:00`,
  };
}

/** POST /visits 응답 — arrive 가 낙관 레코드를 이걸로 교체한다(무효화 없음). */
function createdVisit() {
  return {
    visitCheckId: 'v-created',
    slotKey: `${DAY}#p3`,
    poiId: 'p3',
    arrivedAt: `${DAY}T14:20:00`,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: `${DAY}T14:20:00`,
  };
}

/** POST /visits 로 나간 본문을 쌓는다 — AC-5 arrive 인자 트립와이어. */
const postBodies: unknown[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  postBodies.length = 0;
  mockGetForeground.mockReset();
  // 페이지가 마운트에 쏘는 GET 전부 + arrive POST 를 등록(onUnhandledRequest:'error' 라 누락 시 크래시).
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [upcomingVisit()] })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
      postBodies.push(await request.json());
      return HttpResponse.json(createdVisit());
    })
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('🔴 TRIP-761 · AC-1·AC-3·AC-4 · denied → manual 모드 표면이 뜬다', () => {
  it('C-mode-denied · 배너·⊘ 배지·"방문 체크" pill 이 실 라우트에서 present', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 준비/실행 — 권한 effect + 방문 쿼리가 끝나면 배너가 마운트된다.
    expect(await screen.findByTestId('record-gps-banner')).toBeTruthy();

    // 단언 — 세 manual 표면이 함께 뜬다(모드가 화면·카드로 하향).
    expect(screen.getByTestId('record-map-gps-off')).toBeTruthy();
    expect(screen.getByTestId('record-visit-manual-check-v-up')).toBeTruthy();
  });
});

describe('🔴 TRIP-761 · AC-2 · denied → 안내문 manual 카피로 교체', () => {
  it('C-mode-notice · manual 카피가 뜨고 default 는 사라진다(상호배타)', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 실행 — manual 모드로 전환되면 안내문이 바뀐다.
    expect(await screen.findByText(MANUAL_NOTICE)).toBeTruthy();

    // 단언 — 법 문구를 담은 manual 카피가 뜨고, 현행 default 는 부재.
    expect(screen.queryByText(DEFAULT_NOTICE)).toBeNull();
  });
});

describe('🟢 TRIP-761 · AC-1·AC-3·AC-4 무회귀 · granted → 일반 모드', () => {
  it('C-mode-granted · manual 표면 전부 부재 + 안내문은 현행 default', async () => {
    mockGetForeground.mockResolvedValue(GRANTED);

    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 실행 — 방문 카드가 그려질 때까지 대기(그 시점엔 권한 effect 도 flush 됐다).
    await screen.findByText('○○ 카페');

    // 단언 — granted 는 manual 모드가 아니므로 세 표면이 전부 없고, 안내문은 일반 default.
    expect(screen.queryByTestId('record-gps-banner')).toBeNull();
    expect(screen.queryByTestId('record-map-gps-off')).toBeNull();
    expect(screen.queryByTestId('record-visit-manual-check-v-up')).toBeNull();
    expect(screen.getByText(DEFAULT_NOTICE)).toBeTruthy();
  });
});

describe('🔴 TRIP-761 · AC-5 · "방문 체크" press → arrive({source:MANUAL}) POST', () => {
  it('C-arrive · POST /trips/:tripId/visits 가 {source:"MANUAL", poiId:"p3"} 로 정확히 1회 나간다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 준비 — manual 모드 UPCOMING 카드의 pill 이 뜰 때까지 대기.
    const pill = await screen.findByTestId('record-visit-manual-check-v-up');

    // 실행 — pill press → onPressManualCheck(poiId) → arrive({source:'MANUAL', poiId}) → POST.
    fireEvent.press(pill);

    // 단언 — POST 가 정확히 1회, 본문에 source='MANUAL' + poiId='p3'(slotKey 등 추가 필드는 허용).
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toEqual(
      expect.objectContaining({ source: 'MANUAL', poiId: 'p3' })
    );
  });
});
