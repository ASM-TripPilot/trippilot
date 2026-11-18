import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { router, Stack } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { getToastBottoms, resetToastBottoms } from '@/shared/ui/toastBottom';
import { useToastBottom } from '@/shared/ui/useToastBottom';
import { answerReduceMotionSynchronously } from '@/test-support/animatedProbe';
import { useInteractionGate } from '@/test-support/barMotionProbe';
import {
  BAR_ENTER_DELAY_MS,
  BAR_ENTER_MS,
  BAR_EXIT_MS,
  RecordNavBar,
} from '@/widgets/bottom-nav-bar';
import { resetBarExitForTests } from '@/widgets/bottom-nav-bar/index.exit';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TabsLayout = require('@routes/(tabs)/_layout').default;

/**
 * TRIP-1731 · 안 보이는 탭은 얼린다(`freezeOnBlur`).
 *
 * 무엇을 보장하나: 홈을 띄운 뒤 다른 탭으로 가면, 홈이 읽는 데이터가 바뀌어도 홈은 다시 그려지지 않는다.
 * 돌아오면 최신 값으로 그려진다. 홈이 신고한 토스트 바닥(FAB 높이)은 떠나 있는 동안 빠진다.
 *
 * (개념) `renderRouter` = expo-router 가 주는 테스트용 진짜 라우터. 목 없이 실제 `(tabs)/_layout.tsx` 를 꽂는다.
 * jest 는 플랫폼이 ios 라 react-native-screens 가 켜져 있어 얼림(react-freeze)이 실제로 돈다(5-b 탐침 실측).
 * 얼림은 `setTimeout(0)` 한 번 뒤에 걸리므로(react-native-screens `DelayedFreeze`) 가짜 타이머를 흘린다.
 */

// 홈이 구독하는 외부 저장소 — 쿼리 캐시 갱신의 대역.
let value = 0;
const listeners = new Set<() => void>();
const store = {
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get: () => value,
  set: (next: number) => {
    value = next;
    listeners.forEach((cb) => cb());
  },
};
let homeRenders = 0;

const HOME_FAB_TOP = 208;
const EXPLORE_TOP = 70;

function Home() {
  const v = useSyncExternalStore(store.subscribe, store.get);
  homeRenders += 1;
  useToastBottom(HOME_FAB_TOP);
  return <Text testID="home-value">{`v${v}`}</Text>;
}
function Explore() {
  useToastBottom(EXPLORE_TOP);
  return null;
}
const Empty = () => null;

const ROUTES = {
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': Home,
  '(tabs)/explore': Explore,
  '(tabs)/itinerary': Empty,
  '(tabs)/records': Empty,
  '(tabs)/my': Empty,
};

async function goTo(href: string) {
  await act(async () => router.navigate(href as never));
  await act(async () => jest.advanceTimersByTime(50)); // DelayedFreeze 의 setTimeout(0)
}

beforeEach(() => {
  value = 0;
  homeRenders = 0;
  resetToastBottoms();
  jest.useFakeTimers();
});
afterEach(() => {
  resetBarExitForTests(); // TRIP-1831 — 퇴장 저장소(모듈 싱글턴)는 파일 최상위에서 비운다
  jest.useRealTimers();
});

it('다른 탭에 있는 동안 홈 데이터가 바뀌어도 홈은 다시 그리지 않고, 돌아오면 최신 값으로 그린다', async () => {
  // 준비: 홈을 띄우고 탐색 탭으로 간다
  renderRouter(ROUTES, { initialUrl: '/' });
  await goTo('/explore');
  const rendersBefore = homeRenders;

  // 실행: 떠나 있는 동안 데이터 두 번 갱신
  await act(async () => store.set(1));
  await act(async () => store.set(2));

  // 단언: 떠나 있는 동안 홈 렌더 0회(끄면 2회 — 뮤테이션 실측)
  expect(homeRenders - rendersBefore).toBe(0);

  // 실행·단언: 돌아오면 최신 값
  await goTo('/');
  expect(
    screen.getByTestId('home-value', { includeHiddenElements: true })
  ).toHaveTextContent('v2');
});

it('떠나 있는 동안 홈의 토스트 바닥 신고(FAB 높이)는 빠지고, 돌아오면 다시 신고된다', async () => {
  // 준비
  renderRouter(ROUTES, { initialUrl: '/' });
  expect(getToastBottoms()).toContain(HOME_FAB_TOP);

  // 실행·단언: 다른 탭 — 홈 신고가 얼기 전에 풀린다
  await goTo('/explore');
  expect(getToastBottoms()).not.toContain(HOME_FAB_TOP);

  // 실행·단언: 복귀 — 다시 신고
  await goTo('/');
  expect(getToastBottoms()).toContain(HOME_FAB_TOP);
});

// ── TRIP-1831 · 뒤로를 누르면 이동이 먼저, 바는 탭 레이아웃의 호스트가 이어 재생한다 ─────────────────────────────────────────────
// 실제 `(tabs)/_layout.tsx` 위에 루트 스택 화면(바를 가진 상세)을 push 했다가 그 바의 뒤로를 누른다. 지키는 것: 누르는 즉시 `router.back()` 이
// 일어나 홈 탭이 돌아와 있고(종전엔 400ms 뒤), 상세가 빠진 자리에 바가 호스트로 이어서 서 있다가(낭독기엔 숨겨짐) `BAR_EXIT_MS` 뒤 걷히며 진짜 탭 바만 남는다.
// 실제 겹침 모양·모프 곡선·탭 바 투명도는 jest 가 못 본다(6-b).
describe('TRIP-1831 · 상세에서 뒤로 — 이동 즉시, 바는 호스트가 이어 재생', () => {
  // 홈에서 push 한 상세의 바는 입장 모프(시작 5칸 → 뒤로 + 칸들)를 먼저 돈다 — 진짜 InteractionManager 는 가짜 타이머 아래서 죽은 핸들을 남길 수 있어 게이트로 바꾼다.
  useInteractionGate();
  function Detail() {
    return (
      <RecordNavBar
        testIDPrefix="detail-bar"
        active="records"
        onBack={() => router.back()}
      />
    );
  }
  const WITH_DETAIL = {
    ...ROUTES,
    _layout: () => <Stack screenOptions={{ headerShown: false }} />,
    detail: Detail,
  };
  const detailBars = (includeHiddenElements: boolean) =>
    screen.queryAllByTestId('detail-bar', { includeHiddenElements });

  it('뒤로를 누르면 타이머를 흘리기 전에 홈으로 돌아와 있고, 호스트 바가 하나 서 있다가 BAR_EXIT_MS 뒤 걷힌다', async () => {
    // 준비: 모션 켬 · 홈에서 상세를 연다.
    answerReduceMotionSynchronously(false);
    const app = renderRouter(WITH_DETAIL, { initialUrl: '/' });
    await act(async () => router.push('/detail' as never));
    expect(app.getPathname()).toBe('/detail');
    await act(async () =>
      jest.advanceTimersByTime(BAR_ENTER_DELAY_MS + BAR_ENTER_MS + 200)
    ); // 입장 모프가 끝나 뒤로 원이 선다
    expect(detailBars(false)).toHaveLength(1); // 앵커 — 상세의 바(낭독 가능)가 하나

    // 실행: 뒤로.
    act(() => {
      fireEvent.press(screen.getByTestId('detail-bar-back'));
    });

    // 단언 1: 시계를 한 틱도 안 흘렸는데 이미 홈이다. 낭독 가능한 바는 없고(상세가 빠짐) 숨겨진 호스트 바가 하나 서 있다.
    expect(app.getPathname()).toBe('/');
    expect(detailBars(false)).toHaveLength(0);
    expect(detailBars(true)).toHaveLength(1);

    // 단언 2: 퇴장 시간이 지나면 호스트가 걷히고 진짜 탭 바만 남는다.
    await act(async () => jest.advanceTimersByTime(BAR_EXIT_MS));
    expect(detailBars(true)).toHaveLength(0);
    expect(screen.getByTestId('shell-tabbar-tab-home')).toBeOnTheScreen();
  });
});
