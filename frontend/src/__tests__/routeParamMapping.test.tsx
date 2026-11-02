import type { ComponentType } from 'react';
import { render } from '@testing-library/react-native';

/**
 * 라우트 파라미터 → 페이지 props 변환 표. 라우트 파일은 `useLocalSearchParams` 를 읽어 페이지에 넘기는 얇은 위임인데,
 * 이름 바꾸기(`day→initialDate`·`applied→appliedSessionId`·`date→initialDate`)와 문자열 신호 내리기(`fresh='1'→true`·
 * `replan='1'→true`·`mode==='edit'` 거르기)가 빠지면 양쪽 페이지 테스트가 다 green 인 채 흐름이 끊긴다.
 * 옛 7파일(`draftRouteDayPassthrough`·`manualRouteFreshPassthrough`·`generatingRouteModePassthrough`·`itineraryEditRoute`·
 * `tripBasesRoute`·`liveHubRoute`·`planbManualRoute`)을 한 표로 합쳤다 — 출처 티켓: #1235 W2 · TRIP-1038 C · TRIP-1006 ·
 * TRIP-1233 · TRIP-1011 · TRIP-1082 · TRIP-754 · TRIP-1195 · TRIP-753.
 *
 * 무엇을 보장하나: 행마다 페이지가 받은 props 전체를 `toEqual` 로 잰다 — 모르는 키·옛 이름(`date`·`variant`·`stray`)이
 * 새거나 기본값을 지어내면(`mode ?? 'FULLY_AI'` — 재진입이 생성을 다시 쏜다, #083) red 다.
 * (개념) `toEqual` 은 값이 undefined 인 키를 없는 키와 같게 본다 — "넘기지 않는다"와 "undefined 로 넘긴다"는 같은 행이다.
 *
 * 3동작 뼈대: 준비=주소 파라미터 → 실행=라우트 렌더 → 단언=페이지가 받은 props.
 */

let mockParams: Record<string, string | undefined> = {};
const mockPageProps: { page: string; props: Record<string, unknown> }[] = [];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockParams }),
}));

function mockSpyPage(page: string) {
  return (props: Record<string, unknown>) => {
    mockPageProps.push({ page, props });
    return null;
  };
}

jest.mock('@/pages/itinerary/itinerary-draft', () => ({
  DraftPage: mockSpyPage('DraftPage'),
}));
jest.mock('@/pages/itinerary/itinerary-manual', () => ({
  ManualPlanPage: mockSpyPage('ManualPlanPage'),
}));
jest.mock('@/pages/itinerary/itinerary-generating', () => ({
  GeneratingPage: mockSpyPage('GeneratingPage'),
}));
jest.mock('@/pages/itinerary/itinerary-edit', () => ({
  ItineraryEditPage: mockSpyPage('ItineraryEditPage'),
}));
jest.mock('@/pages/trip/trip-new-step2', () => ({
  TripBasesPage: mockSpyPage('TripBasesPage'),
}));
jest.mock('@/pages/live/live-itinerary', () => ({
  LiveItineraryPage: mockSpyPage('LiveItineraryPage'),
}));

/* eslint-disable import/first -- 목 뒤에 라우트를 불러야 목이 물린다. */
import ItineraryDraftRoute from '@routes/trips/[tripId]/itinerary/draft';
import ManualPlanRoute from '@routes/trips/[tripId]/itinerary/manual/index';
import ItineraryGeneratingRoute from '@routes/trips/[tripId]/itinerary/generating';
import ItineraryEditRoute from '@routes/trips/[tripId]/itinerary/edit';
import TripBasesRoute from '@routes/trips/[tripId]/bases';
import LiveRoute from '@routes/trips/[tripId]/live/index';
import PlanbManualRoute from '@routes/trips/[tripId]/planb/manual';
/* eslint-enable import/first */

beforeEach(() => {
  mockPageProps.length = 0;
});

type Row = [
  label: string,
  Route: ComponentType,
  params: Record<string, string>,
  page: string,
  expected: Record<string, unknown>,
];

const T = { tripId: 'trip-1' };

const ROWS: Row[] = [
  // h11 초안 — 재계획 자동 반영 뒤 다시 짠 날(day)로 연다(#1235 W2).
  [
    'draft · day 그대로',
    ItineraryDraftRoute,
    { ...T, day: '2026-10-15' },
    'DraftPage',
    { ...T, reveal: false, day: '2026-10-15' },
  ],
  [
    'draft · day 없음',
    ItineraryDraftRoute,
    T,
    'DraftPage',
    { ...T, reveal: false },
  ],
  // 직접 짜기 — 비우기 확인의 fresh=1 → startFresh (TRIP-1038 C).
  [
    'manual · fresh=1 → startFresh',
    ManualPlanRoute,
    { ...T, fresh: '1' },
    'ManualPlanPage',
    { ...T, startFresh: true },
  ],
  [
    'manual · fresh 없음',
    ManualPlanRoute,
    T,
    'ManualPlanPage',
    { ...T, startFresh: false },
  ],
  // 생성 중 — mode 기본값을 지어내지 않는다(관찰 모드 · TRIP-1006), replan='1' → boolean.
  [
    'generating · mode 없음 = 관찰 모드',
    ItineraryGeneratingRoute,
    T,
    'GeneratingPage',
    { ...T, replan: false },
  ],
  [
    'generating · mode 그대로',
    ItineraryGeneratingRoute,
    { ...T, mode: 'CO_PLAN' },
    'GeneratingPage',
    { ...T, mode: 'CO_PLAN', replan: false },
  ],
  [
    'generating · targetDate 그대로',
    ItineraryGeneratingRoute,
    { ...T, mode: 'FULLY_AI', targetDate: '2026-10-15' },
    'GeneratingPage',
    { ...T, mode: 'FULLY_AI', targetDate: '2026-10-15', replan: false },
  ],
  [
    "generating · replan='1' → true",
    ItineraryGeneratingRoute,
    { ...T, replan: '1', targetDate: '2026-10-15' },
    'GeneratingPage',
    { ...T, targetDate: '2026-10-15', replan: true },
  ],
  // h12 편집 — date → initialDate, 다른 키는 흘리지 않는다(TRIP-1233).
  [
    'edit · date → initialDate',
    ItineraryEditRoute,
    { ...T, date: '2026-06-11', stray: 'x' },
    'ItineraryEditPage',
    { ...T, initialDate: '2026-06-11' },
  ],
  ['edit · date 없음', ItineraryEditRoute, T, 'ItineraryEditPage', T],
  // i07 여행 중 편집 — 같은 페이지를 inTrip 으로, 옛 variant 는 흘리지 않는다(TRIP-753 · TRIP-1233).
  [
    'planb/manual · inTrip, variant 안 샘',
    PlanbManualRoute,
    { ...T, variant: 'error' },
    'ItineraryEditPage',
    { ...T, inTrip: true },
  ],
  [
    'planb/manual · date → initialDate',
    PlanbManualRoute,
    { ...T, variant: 'error', date: '2026-08-21' },
    'ItineraryEditPage',
    { ...T, inTrip: true, initialDate: '2026-08-21' },
  ],
  // 거점 — mode 가 정확히 'edit' 일 때만 편집 모드(TRIP-1082).
  [
    'bases · mode=edit',
    TripBasesRoute,
    { ...T, mode: 'edit' },
    'TripBasesPage',
    { ...T, mode: 'edit' },
  ],
  ['bases · mode 없음(h04 입구)', TripBasesRoute, T, 'TripBasesPage', T],
  [
    'bases · mode 가 edit 아님',
    TripBasesRoute,
    { ...T, mode: 'wizard' },
    'TripBasesPage',
    T,
  ],
  // 여행 중 허브 — applied → appliedSessionId(TRIP-754), day → initialDate(TRIP-1195).
  [
    'live · applied → appliedSessionId',
    LiveRoute,
    { ...T, applied: 's1' },
    'LiveItineraryPage',
    { ...T, appliedSessionId: 's1' },
  ],
  [
    'live · day → initialDate',
    LiveRoute,
    { ...T, day: '2026-08-21' },
    'LiveItineraryPage',
    { ...T, initialDate: '2026-08-21' },
  ],
  ['live · 둘 다 없음', LiveRoute, T, 'LiveItineraryPage', T],
];

it.each(ROWS)('%s', (_label, Route, params, page, expected) => {
  // 준비
  mockParams = params;

  // 실행
  render(<Route />);

  // 단언
  expect(mockPageProps).toHaveLength(1);
  expect(mockPageProps[0].page).toBe(page);
  expect(mockPageProps[0].props).toEqual(expected);
});
