import { useState } from 'react';
import { router, Stack, Tabs, useLocalSearchParams } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { useRecordBarNav, useTripSummary } from '@/features/reflection';
import { TripSummaryPage } from '@/pages/record/trip-summary';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { RecordNavBar, type RecordBarTab } from '@/widgets/bottom-nav-bar';
import { holdReduceMotionOn } from '@/test-support/barMotionProbe';

/**
 * TRIP-1584 · 기록 3종(j01·j03·j04) 사이 칸 이동이 **실제 스택**에서 어떻게 쌓이고 걷히는가 (AC-8·10, Q4).
 * `renderRouter`(목 없이 진짜 라우터를 돌리는 테스트용 가짜 앱)에 앱과 같은 라우트 이름을 세우고, 화면마다 실물 `RecordNavBar` + `useRecordBarNav` 를 달아 칸을 누른다.
 *
 * 🧪 실측: `dismissTo(href)` 는 그 라우트가 스택에 **있으면** 위를 걷어내고 파라미터(`[date]`·`?day=`)를 새 href 로 바꾸지만, **없으면 push 가 아니라 맨 위 화면을
 * 바꿔치기**한다 → 앞으로 가는 칸을 dismissTo 로 하면 [(tabs), j04] 에서 기록 칸이 (tabs) 바로 위에 앉아 입장 모프가 다시 돈다. 규칙: 스택에 있으면 dismissTo, 없으면 push.
 * 3동작: 준비(가짜 앱) → 실행(칸 누르기) → 단언(루트 스택 라우트 이름·파라미터, 시작 칸 유무).
 */

jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: jest.fn(),
}));

// W1 묶음(실물 TripSummaryPage)용 — 지도·위치·여행 조회는 이 파일에 QueryClient/네이티브가 없어 무해 스텁으로 막는다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));
jest.mock('@/shared/location', () => ({
  isLocationAutomationEnabled: () => false,
  useTripRoutes: () => ({ routes: [] }),
  distanceSourceByDate: jest.fn(),
}));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));

const TRIP = 't1';
const DAY = '2026-10-01';
const SUMMARY_DATE = '2026-10-02';
const REC = 'rec';
const REF = 'ref';
const SUM = 'sum';

const summaryReturns = (value: object) =>
  jest.mocked(useTripSummary).mockReturnValue({
    envelope: undefined,
    summary: undefined,
    source: undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
    ...value,
  });

/** 화면 하나 = 실물 바 + 칸 이동 훅. 화면마다 접두가 달라 쌓인 화면의 바가 서로 안 섞인다. */
function BarScreen({
  prefix,
  active,
  recordsDay,
  reflectionDate,
}: {
  prefix: string;
  active: RecordBarTab;
  recordsDay?: string;
  reflectionDate?: string;
}) {
  const nav = useRecordBarNav({ tripId: TRIP, recordsDay, reflectionDate });
  return <RecordNavBar testIDPrefix={prefix} active={active} {...nav} />;
}
function RecordsScreen() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  return (
    <BarScreen prefix={REC} active="records" reflectionDate={day ?? DAY} />
  );
}
function ReflectionScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  return (
    <BarScreen
      prefix={REF}
      active="reflection"
      recordsDay={date}
      reflectionDate={date}
    />
  );
}
function SummaryScreen() {
  return (
    <BarScreen prefix={SUM} active="summary" reflectionDate={SUMMARY_DATE} />
  );
}
function Empty() {
  return null;
}

const ROUTES = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/index': Empty,
  '(tabs)/records': Empty,
  'trips/[tripId]/records/index': RecordsScreen,
  'trips/[tripId]/records/reflection/[date]': ReflectionScreen,
  'trips/[tripId]/records/summary': SummaryScreen,
};

const SHORT: Record<string, string> = {
  '(tabs)': 'tabs',
  'trips/[tripId]/records/index': 'j01',
  'trips/[tripId]/records/reflection/[date]': 'j03',
  'trips/[tripId]/records/summary': 'j04',
};
/** 루트 스택에 쌓인 화면들 — 이름 뒤에 파라미터(`day`·`date`)가 있으면 `:값`. */
function stack(app: ReturnType<typeof renderRouter>): string[] {
  const routes = app.getRouterState()?.routes[0]?.state?.routes ?? [];
  return routes.map((route) => {
    const params = (route.params ?? {}) as { day?: string; date?: string };
    const extra = params.day ?? params.date;
    return `${SHORT[route.name] ?? route.name}${extra ? `:${extra}` : ''}`;
  });
}
/** 칸을 누른다(400ms 연타 창이 지난 것으로 친다). */
const tap = (id: string) => {
  resetPressGuard();
  act(() => fireEvent.press(screen.getByTestId(id)));
};
/** 탭 위에서 화면을 연다 — 마이크로태스크까지 흘려 OS 「동작 줄이기」 답(켜짐)이 반영돼 바가 최종 구조가 된 뒤 돌려준다. */
async function openFromTab(href: string) {
  const app = renderRouter(ROUTES, { initialUrl: '/' });
  await act(async () => router.push(href as never));
  return app;
}
const hasStartCells = (prefix: string) =>
  screen.queryByTestId(`${prefix}-start-home`) !== null;

beforeEach(() => {
  resetPressGuard();
  summaryReturns({ envelope: { ready: true } });
  holdReduceMotionOn(); // OS 동작 줄이기 켜짐 — 모션 없이 최종 구조·즉시 이동. 모션 시간 흐름은 위젯 테스트가 잰다
});

describe('RecordNavBar + 실제 라우터 · 칸 이동 스택 (AC-8·10)', () => {
  it('탭 → 기록 → 회고 → 요약은 한 장씩 쌓이고, 되돌아가는 칸은 걷어내며 날짜를 싣는다 — 칸 이동으로 온 화면은 입장 모프가 없다', async () => {
    const app = await openFromTab(`/trips/${TRIP}/records`);
    expect(stack(app)).toEqual(['tabs', 'j01']);

    tap(`${REC}-tab-reflection`); // 앞으로 가는 칸 = push (아직 스택에 없다)
    expect(stack(app)).toEqual(['tabs', 'j01', `j03:${DAY}`]);
    expect(hasStartCells(REF)).toBe(false);

    tap(`${REF}-tab-summary`);
    expect(stack(app)).toEqual(['tabs', 'j01', `j03:${DAY}`, 'j04']);
    expect(hasStartCells(SUM)).toBe(false);

    tap(`${SUM}-tab-reflection`); // 되돌아가는 칸 = dismissTo (j03 이 스택에 있다) — 날짜만 바뀐다
    expect(stack(app)).toEqual(['tabs', 'j01', `j03:${SUMMARY_DATE}`]);

    tap(`${REF}-tab-records`); // j03 의 기록 칸은 자기 날짜를 싣는다
    expect(stack(app)).toEqual(['tabs', `j01:${SUMMARY_DATE}`]);
  });

  it('탭에서 바로 j04 로 온 뒤 기록 칸을 누르면 j04 를 바꿔치지 않고 그 위에 쌓인다 — 뒤로는 j04 로 돌아온다', async () => {
    const app = await openFromTab(`/trips/${TRIP}/records/summary`);
    expect(stack(app)).toEqual(['tabs', 'j04']);

    tap(`${SUM}-tab-records`);
    expect(stack(app)).toEqual(['tabs', 'j04', 'j01']);
    expect(hasStartCells(REC)).toBe(false); // 아래가 (tabs) 였다면 입장 모프가 다시 돌았을 자리

    tap(`${REC}-back`);
    expect(stack(app)).toEqual(['tabs', 'j04']);
  });
});

// 5-b W1 — j04 는 얼굴(요약 대기 ↔ 요약 있음)이 바뀌어도 하단 바가 같은 인스턴스여야 한다. 바를 얼굴마다 다른 트리 자리에 두면 얼굴이 바뀌는 순간
// 지웠다 새로 만들어져 "입장 한 번" 기억이 사라지고 홈 5칸부터 모프가 한 번 더 돈다(기록 탭 달력 → j04 의 흔한 경로).
describe('실물 TripSummaryPage · 얼굴이 바뀌어도 하단 바는 같은 인스턴스다 (W1)', () => {
  let rerenderRoute: () => void = () => {};
  function SummaryRoute() {
    const [, force] = useState(0);
    rerenderRoute = () => force((n) => n + 1);
    return <TripSummaryPage tripId={TRIP} />;
  }
  const BAR = 'reflection-summary-bottom-bar';

  it('탭 위에서 열려 모프를 마친 뒤 요약이 도착해 얼굴이 바뀌어도 바 노드가 그대로이고 5칸으로 되돌아가지 않는다', async () => {
    summaryReturns({ isPending: true });
    renderRouter(
      { ...ROUTES, 'trips/[tripId]/records/summary': SummaryRoute },
      { initialUrl: '/' }
    );
    await act(async () =>
      router.push(`/trips/${TRIP}/records/summary` as never)
    );
    expect(screen.getByTestId('reflection-summary-pending')).toBeOnTheScreen();
    const before = screen.getByTestId(BAR);
    expect(screen.queryByTestId(`${BAR}-start-home`)).toBeNull(); // 모프를 마친 최종 구조

    summaryReturns({
      envelope: { ready: true },
      summary: {
        narrative: '좋은 여행',
        highlights: [],
        stats: {
          totalVisits: 0,
          totalDistanceKm: 0,
          distanceSource: 'VISIT_LINE',
          totalPhotos: 0,
          hasLocationData: false,
        },
        source: 'RULE',
        generatedAt: '2026-10-01T00:00:00Z',
      },
    });
    await act(async () => rerenderRoute());

    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen(); // 얼굴이 실제로 바뀌었다
    expect(screen.getByTestId(BAR) === before).toBe(true); // 같은 인스턴스(지웠다 새로 만들지 않았다)
    expect(screen.queryByTestId(`${BAR}-start-home`)).toBeNull();
  });
});
