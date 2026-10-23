import type { ReactElement } from 'react';
import {
  NavigationContext,
  NavigationRouteContext,
} from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { getToastBottoms, resetToastBottoms } from '@/shared/ui/toastBottom';
import { useAnimatedProbe } from '@/test-support/animatedProbe';
import {
  advance,
  deferOsAnswer,
  flushOsAnswer,
  moved,
  scheduleVisibleCenter,
  setWindowWidth,
  withBarIds,
  useInteractionGate,
  visibleIds,
  watchMotion,
  type BarIds,
} from '@/test-support/barMotionProbe';
import { renderedText } from '@/test-support/sheetTree';

import {
  BAR_ENTER_DELAY_MS,
  BAR_ENTER_MS,
  BAR_EXIT_MS,
  barMorphFrame,
  NAV_BAR_RESERVE,
  RECORD_BAR_SHAPE,
} from '../index';
import { RecordNavBar, type RecordNavBarProps } from './RecordNavBar';

/**
 * TRIP-1584 · 기록 3종이 쓰는 하단 바 `RecordNavBar`. 통합 버킷인 이유: 출발 탭 판독이 `@react-navigation/native` 문맥을 읽는다(node 버킷은 못 올림).
 * 모프 컨테이너 자체(컷·타이머·OS 답 순서)는 허브 테스트가 게이트고, 여기는 기록 모양에만 있는 것(칸 구성·4번째 자리 시작·입장 한 번·토스트)만 잰다.
 * 칸 누름 배선·비활성 규칙·키보드 숨김은 Screen 테스트와 TripRecordsView D·K 묶음이, 칸 이동으로 온 화면의 모프 없음은 recordBarStack 이 실물 바로 잠근다.
 * 3동작: 준비(바 + 가짜 내비게이션 스택) → 실행(가짜 시계·숨김 토글) → 단언(보이는 칸·선택·위치).
 */

const P = 'rb';
const TAB_KEYS = ['home', 'explore', 'itinerary', 'records', 'my'] as const;
const IDS: BarIds = {
  root: P,
  capsule: `${P}-capsule`,
  back: `${P}-back`,
  survivor: `${P}-tab-records`,
  startCells: ['home', 'explore', 'itinerary', 'my'].map(
    (key) => `${P}-start-${key}`
  ),
  start5: TAB_KEYS.map((key) =>
    key === 'records' ? `${P}-tab-records` : `${P}-start-${key}`
  ),
  final: [
    `${P}-back`,
    `${P}-tab-records`,
    `${P}-tab-reflection`,
    `${P}-tab-summary`,
  ],
  fresh: [`${P}-back`, `${P}-tab-reflection`, `${P}-tab-summary`],
};
const TAB_RECORDS = IDS.survivor;
const TAB_SUMMARY = `${P}-tab-summary`;

withBarIds(IDS);
afterEach(() => resetToastBottoms()); // 토스트 레지스트리는 모듈 싱글턴 — 파일 최상위에서 비운다

// 내비게이션 스택 흉내 — 허브 DT 묶음과 같은 방식(스택 상태 + 이 화면의 route).
type StubRoute = {
  key: string;
  name: string;
  state?: { index?: number; routes: { name: string }[] };
};
const HERE: StubRoute = { key: 'here', name: 'trips/[tripId]/records/index' };
const tabsRoute = (index: number): StubRoute => ({
  key: 'tabs-1',
  name: '(tabs)',
  state: {
    index,
    routes: ['index', 'explore', 'itinerary', 'records', 'my'].map((name) => ({
      name,
    })),
  },
});

function tree(
  props: Partial<RecordNavBarProps> = {},
  stack?: StubRoute[]
): ReactElement {
  const bar = (
    <RecordNavBar
      testIDPrefix={P}
      active="records"
      onBack={jest.fn()}
      {...props}
    />
  );
  if (!stack) return bar;
  return (
    <NavigationContext.Provider
      value={{ getState: () => ({ routes: stack }) } as never}
    >
      <NavigationRouteContext.Provider value={HERE as never}>
        {bar}
      </NavigationRouteContext.Provider>
    </NavigationContext.Provider>
  );
}

const selectedIds = (ids: string[]) =>
  ids.filter(
    (id) => screen.getByTestId(id).props.accessibilityState?.selected === true
  );

describe('RecordNavBar · 구성 (AC-1·2)', () => {
  it('뒤로 → 기록 → 회고 → 요약 순이고 글자는 칸 이름 셋뿐이다 (INV-3)', () => {
    render(tree({ active: 'summary' }));

    expect(visibleIds()).toEqual(IDS.final);
    expect(selectedIds(IDS.final.slice(1))).toEqual([TAB_SUMMARY]);
    expect(renderedText(screen.root).split('\n')).toEqual([
      '기록',
      '회고',
      '요약',
    ]);
  });
});

describe('RecordNavBar · 입장 모프와 출발 탭 (AC-4·5·7·11)', () => {
  const probe = useAnimatedProbe();
  useInteractionGate();

  it.each([
    ['home', 0],
    ['records', 3],
  ] as const)(
    '탭 바 위(출발 탭 %s)에서 들어오면 첫 프레임이 홈·탐색·일정·기록(4번째)·마이 5칸이고 분홍은 출발 탭 하나다',
    (key, index) => {
      deferOsAnswer(); // OS 답 대기 중엔 시작 5칸 그대로 선다
      render(tree({}, [tabsRoute(index), HERE]));

      expect(visibleIds()).toEqual(IDS.start5);
      expect(selectedIds(IDS.start5)).toEqual([
        key === 'records' ? TAB_RECORDS : `${P}-start-${key}`,
      ]);
    }
  );

  // 새 매개(4번째 자리·새 칸 2개)를 위치 계산이 쓰는지 — 허브 값(3번째·새 칸 3)이 남으면 컷·교체 순간 기록 칸이 튄다. 폭 490 은 330 고정도 잡는다.
  it('[화면 폭 490] 입장·퇴장 내내 기록 칸의 보이는 중심이 기록 모양 단계 함수가 말하는 자리를 따라간다', async () => {
    const spy = setWindowWidth(490);
    try {
      probe.setReduceMotion(false);
      const width = 490 - 60;
      render(tree({}, [tabsRoute(0), HERE]));
      await flushOsAnswer();

      const follow = (
        direction: 'enter' | 'exit',
        frames: number,
        delay: number
      ) =>
        watchMotion(frames, 16, (ms) => {
          const values = [-8, 0, 8].map(
            (d) =>
              barMorphFrame(
                direction,
                Math.max(0, ms - delay + d),
                width,
                RECORD_BAR_SHAPE
              ).scheduleCenterX
          );
          const center = scheduleVisibleCenter(width);
          expect(center).toBeGreaterThanOrEqual(Math.min(...values) - 0.75);
          expect(center).toBeLessThanOrEqual(Math.max(...values) + 0.75);
        });
      follow(
        'enter',
        Math.ceil((BAR_ENTER_DELAY_MS + 352) / 16),
        BAR_ENTER_DELAY_MS
      );
      watchMotion(40);
      fireEvent.press(screen.getByTestId(IDS.back));
      follow('exit', 25, 0);
    } finally {
      spy.mockRestore();
    }
  });

  // TRIP-1591 — 목적지가 늘 기록 탭이라 끝 모양(기록 분홍 5칸)이 출발과 무관하다: 다른 탭에서 왔어도, 탭 바 위가 아닌 진입(스택에 (tabs) 없음)이어도 역순을 재생한다.
  it.each([
    ['출발 탭이 기록', [tabsRoute(3), HERE]],
    ['출발 탭이 홈', [tabsRoute(0), HERE]],
    ['출발 탭 없음(탭 바 위가 아닌 진입)', undefined],
  ] as const)(
    '뒤로 · %s: 역순 재생이 끝난 뒤 정확히 1회, 끝 모양은 기록이 분홍인 5칸',
    async (_label, stack) => {
      probe.setReduceMotion(false);
      const onBack = jest.fn();
      render(tree({ onBack }, stack && [...stack]));
      await flushOsAnswer();
      watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + BAR_ENTER_MS + 100) / 16));

      fireEvent.press(screen.getByTestId(IDS.back));
      expect(moved(watchMotion(20))).toBe(true); // 즉시 이동이 아니라 퇴장 모션이 흐른다(20×16ms)
      expect(onBack).not.toHaveBeenCalled();
      advance(BAR_EXIT_MS - 20 * 16 - 1);
      expect(onBack).not.toHaveBeenCalled();
      advance(1);
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(selectedIds(IDS.start5)).toEqual([TAB_RECORDS]);
    }
  );

  // TRIP-1600 — 뒤로의 도착지가 탭이 아니면(알림함·도우미 등에서 연 기록 묶음) 5칸 탭 바로 접히는 역순 모프 없이 곧장 이동한다 —
  // 탭 바 모양으로 접혔다가 탭 바 없는 화면으로 바뀌는 0.4초 어색함을 없앤다. 도착지가 탭이면 위 TRIP-1591 대로 역순 재생.
  it('뒤로 · exitToTab=false(도착지가 탭이 아님): 모프 없이 누르는 즉시 1회, 시작 5칸이 나타나지 않는다', async () => {
    // 준비 — 동작 줄이기 끔, 탭 바 위가 아닌 진입.
    probe.setReduceMotion(false);
    const onBack = jest.fn();
    render(tree({ onBack, exitToTab: false }));
    await flushOsAnswer();
    watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + BAR_ENTER_MS + 100) / 16));

    // 실행 — 뒤로.
    fireEvent.press(screen.getByTestId(IDS.back));

    // 단언 — 바로 이동하고, 5칸 탭 바 사본이 그려지지 않는다.
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(IDS.start5[0])).toBeNull();
  });

  it('숨겼다 다시 나타나도(편집 모드 hidden) 입장 모프를 다시 재생하지 않고 곧장 최종 모양이다 · 토스트 바닥 신고는 보일 때만(Q7)', async () => {
    probe.setReduceMotion(false);
    expect(getToastBottoms()).toEqual([]); // 앵커 — 그리기 전엔 신고가 없다
    const stack = [tabsRoute(0), HERE];
    const view = render(tree({}, stack));
    await flushOsAnswer();
    watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + BAR_ENTER_MS + 100) / 16));
    expect(visibleIds()).toEqual(IDS.final);

    expect(getToastBottoms()).toEqual([NAV_BAR_RESERVE]);

    view.rerender(tree({ hidden: true }, stack));
    expect(screen.queryByTestId(P)).toBeNull();
    expect(getToastBottoms()).toEqual([]);
    view.rerender(tree({ hidden: false }, stack));

    expect(visibleIds()).toEqual(IDS.final);
    expect(moved(watchMotion(40))).toBe(false);
  });
});
