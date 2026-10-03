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
import * as Linking from 'expo-linking';

import { buildAppNavUrl, buildWebNavUrl } from '@/features/execution';
import { server } from '@/mocks/server';
import type { Itinerary, VisitCheck } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-1189 · i01 다음 예정지 [길찾기] 배선 — 실 페이지 + 실제 HTTP(MSW) + expo-linking 목.
 * (US-ONTRIP-03 · BR-U4-39 — 실제 길안내는 외부 지도앱에 위임, 복귀하면 같은 허브.)
 *
 * 외부 앱이 실제로 열리는지는 jest 가 원리적으로 못 본다 — openURL 호출 인자·횟수까지만 굳힌다(실기 확인 항목).
 * 기존 허브 통합 파일(LiveItineraryPage.integration.test.tsx)은 건드리지 않고 이 관점만 따로 둔다.
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
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: (...args: unknown[]) => mockBack(...args),
    setParams: (...args: unknown[]) => mockSetParams(...args),
    canGoBack: () => true,
  },
}));

jest.mock('@/shared/photo', () => ({
  pickPhotoAsset: jest.fn(),
  resolvePhotoUri: jest.fn(),
}));

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));
const mockOpenURL = Linking.openURL as jest.Mock;

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => setAccessToken('a'));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  jest.clearAllMocks();
  mockOpenURL.mockReset();
});
afterAll(() => server.close());

const slotOf = (poiId: string, over: Record<string, unknown> = {}) => ({
  poiId,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo: `장소-${poiId}`,
  distanceRange: '약 1.2km · 도보 추정',
  openingHours: null,
  tags: [],
  lat: 35.1,
  lng: 129.1,
  ...over,
});

const doneVisit = (poiId: string): VisitCheck => ({
  visitCheckId: `v-${poiId}`,
  poiId,
  slotKey: `${TODAY}#${poiId}`,
  arrivedAt: '2026-08-20T09:00:00',
  completedAt: '2026-08-20T09:50:00',
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T09:50:05Z',
});

function seed(slots: unknown[], visits: VisitCheck[] = []) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json({
        tripId: TRIP_ID,
        title: '부산 여행',
        startDate: TODAY,
        endDate: '2026-08-22',
        party: 2,
        destinations: [{ seq: 1, region: '부산', nights: 2 }],
        status: 'PLANNED',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      })
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json({
        itineraryId: 'it1',
        tripId: TRIP_ID,
        status: 'PLANNED',
        solveMode: 'FULL',
        generationMode: 'AI',
        isFallback: false,
        generationState: 'COMPLETE',
        days: [{ date: TODAY, slots }],
      } as unknown as Itinerary)
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits })
    ),
    http.get(`${BASE}/trips/:tripId/triggers`, () =>
      HttpResponse.json({ triggers: [] })
    )
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderHub() {
  render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
  );
}

const dirId = (poiId: string) =>
  `execution-live-slot-directions-${TODAY}#${poiId}`;
const noticeId = (poiId: string) =>
  `execution-live-slot-directions-notice-${TODAY}#${poiId}`;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

describe('i01 허브 · 다음 예정지 길찾기 (TRIP-1189)', () => {
  it('N1 첫 upcoming 카드에만 [길찾기]가 있다 (둘째 upcoming · done 에는 없다)', async () => {
    seed([slotOf('p1'), slotOf('p2'), slotOf('p3')], [doneVisit('p1')]);
    await renderHub();

    // 방문 기록이 늦게 도착한다 — p1 이 done 이 돼 p2 가 첫 upcoming 이 될 때까지 기다린다.
    expect(await screen.findByTestId(dirId('p2'))).toHaveTextContent('길찾기');
    expect(screen.queryByTestId(dirId('p3'))).toBeNull();
    expect(screen.queryByTestId(dirId('p1'))).toBeNull();
  });

  it('N2 누르면 그 장소 좌표의 네이버 앱 URL 로 openURL 한다 · 라우터는 안 건드린다 (복귀 = 같은 허브)', async () => {
    seed([slotOf('p1', { lat: 35.2, lng: 129.2, nameKo: '광안리' })]);
    mockOpenURL.mockResolvedValue(true);
    await renderHub();

    fireEvent.press(screen.getByTestId(dirId('p1')));
    await settle();

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(
      buildAppNavUrl({ lat: 35.2, lng: 129.2, nameKo: '광안리' })
    );
    [mockPush, mockReplace, mockNavigate, mockBack, mockSetParams].forEach(
      (fn) => expect(fn).not.toHaveBeenCalled()
    );
    expect(screen.getByTestId('execution-live-screen')).toBeTruthy();
    expect(screen.queryByTestId(noticeId('p1'))).toBeNull();
  });

  it('N3 앱이 없어 reject 되면 웹 지도로 연다', async () => {
    seed([slotOf('p1', { lat: 35.2, lng: 129.2, nameKo: '광안리' })]);
    mockOpenURL
      .mockRejectedValueOnce(new Error('no app'))
      .mockResolvedValueOnce(true);
    await renderHub();

    fireEvent.press(screen.getByTestId(dirId('p1')));
    await settle();

    expect(mockOpenURL).toHaveBeenCalledTimes(2);
    expect(mockOpenURL).toHaveBeenLastCalledWith(
      buildWebNavUrl({ lat: 35.2, lng: 129.2, nameKo: '광안리' })
    );
    expect(screen.queryByTestId(noticeId('p1'))).toBeNull();
  });

  it('N4 둘 다 실패하면 거리 안내를 카드에 보인다 — 침묵하지 않는다 (INV-4) · 소요시간은 없다 (INV-3)', async () => {
    seed([slotOf('p1')]);
    mockOpenURL.mockRejectedValue(new Error('none'));
    await renderHub();

    fireEvent.press(screen.getByTestId(dirId('p1')));
    await waitFor(() =>
      expect(screen.getByTestId(noticeId('p1'))).toBeTruthy()
    );

    const text = String(
      screen.getByTestId(noticeId('p1')).props.children ?? ''
    );
    expect(screen.getByTestId(noticeId('p1'))).toHaveTextContent(/1\.2km/);
    expect(text).not.toMatch(/\d\s*분|시간/);
  });

  it('N5 연타 2회에도 외부 앱은 1회 — 끝나면 다시 누를 수 있다', async () => {
    seed([slotOf('p1')]);
    let resolveOpen: (v: boolean) => void = () => undefined;
    mockOpenURL.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        })
    );
    await renderHub();

    fireEvent.press(screen.getByTestId(dirId('p1')));
    fireEvent.press(screen.getByTestId(dirId('p1')));
    await settle();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOpen(true);
    });
    mockOpenURL.mockResolvedValue(true);
    fireEvent.press(screen.getByTestId(dirId('p1')));
    await settle();
    expect(mockOpenURL).toHaveBeenCalledTimes(2);
  });

  it('N6 다음 예정지가 없으면(전부 완료) 버튼이 없다', async () => {
    seed([slotOf('p1')], [doneVisit('p1')]);
    await renderHub();

    // 방문 기록 조회가 늦게 도착한다 — done 카드가 될 때까지 기다린 뒤 부재를 본다(공허 통과 방지).
    await waitFor(() =>
      expect(
        screen.getByTestId(`execution-live-slot-visit-label-${TODAY}#p1`)
      ).toBeTruthy()
    );
    expect(screen.queryByTestId(dirId('p1'))).toBeNull();
  });

  it('N7 첫 upcoming 의 좌표가 없으면 버튼이 없다 (resolveNextDest 가 null)', async () => {
    seed([slotOf('p1', { lat: null, lng: null })]);
    await renderHub();

    expect(screen.queryByTestId(dirId('p1'))).toBeNull();
  });
});
