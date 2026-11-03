import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { getToastBottoms, resetToastBottoms } from '@/shared/ui/toastBottom';
import { useToastBottom } from '@/shared/ui/useToastBottom';

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
afterEach(() => jest.useRealTimers());

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
