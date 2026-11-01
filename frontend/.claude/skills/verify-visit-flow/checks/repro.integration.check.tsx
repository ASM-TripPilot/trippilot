/**
 * 모델 반례 재현 — 실제 LiveItineraryPage(+ 실제 useVisitCheck) 를 MSW 가짜 서버 위에서 단계별로 돌린다.
 * 가짜 서버는 backend archive VisitCheckService 규칙(S1~S3)만 흉내 낸다: 기록이 있는 슬롯 도착 409, open 만 완료·건너뜀.
 * 리포에 두지 않는다(작업 폴더 전용).
 */
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { server } from '@/mocks/server';
import type { VisitCheck } from '@/shared/api/index.schemas';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useVisitCheck } from '@/features/check-visit';
import { liveItinerary, liveSlot, liveTrip, liveVisit } from '@/test-support/liveHubFixtures';
import { recordsHandler, tripRecord } from '@/test-support/tripRecordsFixtures';
import { newTestQueryClient } from '@/test-support/queryRender';
import { createGate } from '@/test-support/mswHookHarness';
import { resetToast } from '@/test-support/toastHarness';
import { LiveItineraryPage } from '@/pages/live/live-itinerary/ui/LiveItineraryPage';

jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
  readIdSet: jest.fn().mockResolvedValue([]),
  writeIdSet: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn(),
    setParams: jest.fn(), canGoBack: () => true, dismissTo: jest.fn(),
  },
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: jest.fn(),
}));
jest.mock('@/shared/photo', () => ({ pickPhotoAsset: jest.fn(), resolvePhotoUri: jest.fn() }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const T = '2026-08-20T04:00:00Z';
const ARRIVE_FAILED = '도착을 기록하지 못했어요. 다시 눌러 주세요.';
const arriveId = (poiId: string) => `execution-live-slot-arrive-${TODAY}#${poiId}`;
// renderHook 이 screen 을 훅 트리로 바꾸므로, 페이지 렌더 결과(page)로 찾는다.
let page: ReturnType<typeof render>;
const q = () => page;
const statusOf = (poiId: string) => q().getByTestId(`execution-live-slot-status-${TODAY}#${poiId}`);
const cardOf = (poiId: string) => q().getByTestId(`execution-live-slot-${TODAY}#${poiId}`);
const noticeOf = (poiId: string) => q().queryByTestId(`execution-live-slot-action-notice-${TODAY}#${poiId}`);
const COMPLETE_BTN = 'execution-arrive-complete';

// ── 가짜 서버(S1~S3) ────────────────────────────────────────────────────────
type Row = { id: string; poiId: string; arrivedAt: string | null; completedAt: string | null; skippedAt: string | null };
let rows: Map<string, Row>;
let plan: string[];
let hits: string[];
let completeGate: ReturnType<typeof createGate> | null;
let completeNetFail: boolean;

const toVisit = (r: Row): VisitCheck =>
  liveVisit({ visitCheckId: r.id, poiId: r.poiId, slotKey: `${TODAY}#${r.poiId}`, arrivedAt: r.arrivedAt, completedAt: r.completedAt, skippedAt: r.skippedAt, updatedAt: T });
const open = () => [...rows.values()].filter((r) => r.arrivedAt && !r.completedAt && !r.skippedAt).map((r) => r.poiId).sort();
const byId = (id: string) => [...rows.values()].find((r) => r.id === id);
const conflict = () => HttpResponse.json({ code: 'VISIT_ALREADY_RECORDED' }, { status: 409 });

const fakeServer = [
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(liveTrip())),
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(liveItinerary([{ date: TODAY, slots: plan.map((p, i) => liveSlot(p, `장소 ${p}`, `${13 + i}:00:00`)) }]))
  ),
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () => HttpResponse.json({ visits: [...rows.values()].map(toVisit) })),
  http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
    const body = (await request.json()) as { poiId: string };
    hits.push(`arrive ${body.poiId}`);
    if (rows.has(body.poiId)) return conflict(); // S1 — 그 슬롯에 기록이 있으면 409
    const r: Row = { id: `v-${body.poiId}`, poiId: body.poiId, arrivedAt: T, completedAt: null, skippedAt: null };
    rows.set(body.poiId, r);
    return HttpResponse.json(toVisit(r), { status: 201 });
  }),
  http.post(`${BASE}/trips/:tripId/visits/:id/complete`, async ({ params }) => {
    hits.push(`complete ${params.id}`);
    if (completeGate) await completeGate.opened;
    if (completeNetFail) return HttpResponse.error();
    const r = byId(String(params.id));
    if (!r || r.completedAt || r.skippedAt) return conflict(); // S2
    r.completedAt = T;
    return HttpResponse.json(toVisit(r));
  }),
  http.post(`${BASE}/trips/:tripId/visits/:id/skip`, ({ params }) => {
    hits.push(`skip ${params.id}`);
    const r = byId(String(params.id));
    if (!r || r.completedAt || r.skippedAt) return conflict(); // S3
    r.skippedAt = T;
    return HttpResponse.json(toVisit(r));
  }),
];

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  rows = new Map();
  plan = ['p1', 'p2', 'p3'];
  hits = [];
  completeGate = null;
  completeNetFail = false;
  client = newTestQueryClient({ gcTime: 0 });
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  setAccessToken('a');
  server.use(
    recordsHandler(() => HttpResponse.json(tripRecord([], TRIP_ID))),
    http.get(`${BASE}/me/location-consent`, () => HttpResponse.json({ legalConsent: false })),
    ...fakeServer
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
  clearAccessToken();
  resetToast();
});
afterAll(() => server.close());

/** 기록 화면(j01)의 건너뛰기 — 같은 훅·같은 캐시 키(TripRecordsPage handleConfirmSkip 이 부르는 그대로). 같은 트리에 탐침으로 둔다. */
let j01Skip: ((id: string) => Promise<unknown>) | null = null;
function J01Probe() {
  j01Skip = useVisitCheck({ tripId: TRIP_ID, day: TODAY }).skip;
  return null;
}
async function skipInJ01(visitCheckId: string) {
  await act(async () => { await j01Skip!(visitCheckId); });
}
const renderHub = () =>
  render(<><LiveItineraryPage tripId={TRIP_ID} today={TODAY} /><J01Probe /></>, { wrapper });

describe('반례 재현', () => {
  it('R1 NoArriveOnSkipped — A 도착 → j01 에서 A 건너뛰기 → 허브 A 카드에 [도착]이 서고, 누르면 409 로 실패가 반복된다 (FM-L4-01)', async () => {
    page = renderHub();
    // 1. A [도착]
    fireEvent.press(await q().findByTestId(arriveId('p1')));
    // 2. A 도착이 기록된다
    await waitFor(() => expect(open()).toEqual(['p1']));
    await waitFor(() => expect(q().queryByTestId(arriveId('p1'))).toBeNull());
    // 3·4. 기록 화면에서 A 건너뛰기 확정 → 기록됨
    await skipInJ01('v-p1');
    expect(rows.get('p1')?.skippedAt).toBe(T);
    // 위반 상태: A 는 '예정' 칸, 진행 중이 없으니 A 카드에 [도착]
    await waitFor(() => expect(q().getByTestId(arriveId('p1'))).not.toBeNull());
    expect(statusOf('p1')).toHaveTextContent('예정');
    // 피해: 누를 때마다 서버 409 → 같은 안내
    for (let i = 0; i < 2; i++) {
      fireEvent.press(q().getByTestId(arriveId('p1')));
      await waitFor(() => expect(noticeOf('p1')).toHaveTextContent(ARRIVE_FAILED));
      await settle();
    }
    expect(hits.filter((h) => h === 'arrive p1')).toHaveLength(3);
  });

  it('R2 ReplanKeepsSkippedOut — A 건너뜀 뒤 재계획 초안이 A 를 다시 넣어 적용되면, 새 일정의 A 가 예정·[도착](409) 칸으로 남는다 (FM-L4-05 클라이언트 쪽)', async () => {
    page = renderHub();
    fireEvent.press(await q().findByTestId(arriveId('p1')));
    await waitFor(() => expect(open()).toEqual(['p1']));
    await skipInJ01('v-p1');
    // 5~7. 재계획 → 서버 초안(가정 S4: 건너뛴 곳을 다시 넣을 수 있다) → 적용. 적용은 useApplyReplan 처럼 일정 쿼리 무효화.
    plan = ['p1'];
    await act(async () => { await client.invalidateQueries({ queryKey: getGetTripsTripIdItineraryQueryKey(TRIP_ID) }); });
    await waitFor(() => expect(q().queryByTestId(`execution-live-slot-${TODAY}#p2`)).toBeNull());
    expect(statusOf('p1')).toHaveTextContent('예정');
    fireEvent.press(q().getByTestId(arriveId('p1')));
    await waitFor(() => expect(noticeOf('p1')).toHaveTextContent(ARRIVE_FAILED));
  });

  it('R3 OneOpenVisit — C 도착 → C [방문 완료](응답 대기) → A [도착] → A 도착 기록 → C 완료 네트워크 실패: 서버에 진행 중 2곳, C 는 예정·[도착](409)', async () => {
    page = renderHub();
    // 1·2. C [도착] → 기록
    fireEvent.press(await q().findByTestId(arriveId('p3')));
    await waitFor(() => expect(open()).toEqual(['p3']));
    // 3. C [방문 완료] — 응답을 문 뒤에 잡는다(완료 실패는 네트워크)
    completeGate = createGate();
    completeNetFail = true;
    await waitFor(() => expect(within(cardOf('p3')).getByTestId(COMPLETE_BTN)).not.toBeNull());
    fireEvent.press(within(cardOf('p3')).getByTestId(COMPLETE_BTN));
    await waitFor(() => expect(hits).toContain('complete v-p3'));
    // 4. 낙관 완료로 진행 중이 사라져 A 에 [도착]이 선다 — arriveBusy 는 단독 완료를 막지 않는다
    await waitFor(() => expect(q().getByTestId(arriveId('p1'))).not.toBeNull());
    fireEvent.press(q().getByTestId(arriveId('p1')));
    // 5. A 도착 기록
    await waitFor(() => expect(open()).toEqual(['p1', 'p3']));
    // 6. C 완료가 네트워크로 실패
    completeGate.release();
    await settle();
    await settle();
    expect(open()).toEqual(['p1', 'p3']);
    // 화면: A 진행 중, C 는 '예정' 칸에 [도착] → 누르면 409
    await waitFor(() => expect(statusOf('p3')).toHaveTextContent('예정'));
    completeGate = null;
    completeNetFail = false; // 네트워크가 돌아왔다
    fireEvent.press(q().getByTestId(arriveId('p3')));
    await waitFor(() => expect(hits.filter((h) => h.startsWith('complete'))).toHaveLength(2));
    // 사슬: 진행 중 A 를 먼저 완료하고 C 도착 → 서버 409. A 는 원치 않게 완료된다.
    await waitFor(() => expect(hits[hits.length - 1]).toBe('arrive p3'));
    await waitFor(() => expect(noticeOf('p3')).toHaveTextContent(ARRIVE_FAILED));
    expect(rows.get('p1')?.completedAt).toBe(T);
  });
});
