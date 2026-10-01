import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import {
  getAnimatedStyle,
  isSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Path } from 'react-native-svg';
import type { ReactTestInstance } from 'react-test-renderer';

import { NoteGlyph } from '@/features/record/ui/RecordGlyphs';
import type { MapCenter } from '@/shared/map';
import {
  isInsideSheet,
  renderedText,
  treeIndexOf,
} from '@/test-support/sheetTree';

import { TripRecordsView, type TripRecordsViewProps } from './TripRecordsView';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-1088 · j01 「오늘의 회고」 FAB — 뷰 단위(V1~V8).
 *
 * 무엇을 보장하나:
 *  - 노출 스위치(V1): `onPressReflection` 이 오면 FAB(글자 + 흰 문서 아이콘)가 앵커 안에 서고, 없으면 둘 다 없다.
 *  - 누름(V2) · 셸 배선(V5): FAB 는 콜백을 1회 부르고, 뷰는 시트 위치 상자(SharedValue)를 셸에 넘긴다.
 *  - 추종(V3)·하한(V4): FAB 윗변 = max(칩 줄 하단 + 8, 시트 윗변 − 8 − 52) — Figma 4716:2946(시트 윗변 380 → 320).
 *  - 앵커 형태(V6): 뷰 루트 직속·셸 뒤 형제, className 없이 style 로만 자리 잡는다(Animated.View).
 *  - 무회귀(V7): 칩 줄을 뷰가 감싸도 칩 선택·뒤로가 그대로다. INV-3(V8): 소요 글자 0.
 *
 * ⚠️ 관측은 getAnimatedStyle + 가짜 타이머로만 — host `props.style` 은 첫 값에 굳는다(02a ★1·★2).
 *   실제 드래그 추종·첫 프레임·가림은 6-b(S1~S6).
 */

const FAB = 'record-trip-reflection-fab';
const ANCHOR = 'record-trip-reflection-fab-anchor';
const OVERLAY_ROW = 'record-trip-overlay-row';
const FRAME_MS = 100;
const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };

function baseProps(): TripRecordsViewProps {
  return {
    tripTitle: '부산 여행',
    dayTabs: [
      { day: '2026-06-10', label: '1일차' },
      { day: '2026-06-11', label: '2일차' },
      { day: '2026-06-12', label: '3일차' },
    ],
    activeDay: '2026-06-11',
    onSelectDay: jest.fn(),
    onPressBack: jest.fn(),
    mapCenter: CENTER,
    cards: [
      {
        visitCheckId: 'v-a',
        slotKey: '2026-06-11#p1',
        poiId: 'p1',
        nameKo: '광안리 해변',
        arrivedAt: '2026-06-11T14:20:00',
        completedAt: '2026-06-11T15:20:00',
        skippedAt: null,
        arrivedLabel: '14:20',
      },
    ],
    onPressComplete: jest.fn(),
    onPressSkip: jest.fn(),
    onPressReflection: jest.fn(),
  };
}

function renderView(overrides: Partial<TripRecordsViewProps> = {}) {
  const props = { ...baseProps(), ...overrides };
  render(<TripRecordsView {...props} />);
  return props;
}

/** 실기처럼 상태바 47 을 준다 — safeTop 을 한 번 더 더하는 구현을 드러낸다(02a ★5). */
function renderViewWithStatusBar(
  overrides: Partial<TripRecordsViewProps> = {}
) {
  const props = { ...baseProps(), ...overrides };
  render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 47, bottom: 34, left: 0, right: 0 }}
    >
      <TripRecordsView {...props} />
    </SafeAreaInsetsContext.Provider>
  );
  return props;
}

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  for (let up = node.parent; up; up = up.parent) out.push(up);
  return out;
}

/** snapPoints 를 가진 host 노드 = 시트 본체(통과형 목이 props 를 host 에 펼친다, 02a ★7 선례). */
function sheetHost(): ReactTestInstance {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}

function sheetPosition(): SharedValue<number> {
  const position = sheetHost().props.animatedPosition as unknown;
  if (!isSharedValue(position)) {
    throw new Error(
      '시트(BottomSheet)에 animatedPosition 상자가 실려 있지 않다'
    );
  }
  return position as SharedValue<number>;
}

/** 프레임을 흘린다 — 원인 동작과 다른 act 로 부른다(02a ★2). */
function flushFrames(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

/** 시트 윗변을 y 로 옮긴다(gorhom 이 매 프레임 하는 일). */
function moveSheet(y: number): void {
  const position = sheetPosition();
  act(() => {
    position.value = y;
  });
  flushFrames();
}

/** 칩 줄(‹ + 일차 칩)이 기기에서 잰 자리 — 하단 = y + height. */
function layoutOverlay(y: number, height: number): void {
  act(() => {
    fireEvent(screen.getByTestId(OVERLAY_ROW), 'layout', {
      nativeEvent: { layout: { x: 16, y, width: 200, height } },
    });
  });
  flushFrames();
}

function anchorStyle(): Record<string, unknown> {
  return getAnimatedStyle(screen.getByTestId(ANCHOR)) as Record<
    string,
    unknown
  >;
}

/** 앵커 윗변 y = top(없으면 0) + transform translateY 합. */
function anchorTop(): number {
  const style = anchorStyle();
  const top = typeof style.top === 'number' ? style.top : 0;
  const transform = Array.isArray(style.transform)
    ? (style.transform as Record<string, unknown>[])
    : [];
  const shift = transform.reduce<number>(
    (sum, step) =>
      sum + (typeof step.translateY === 'number' ? step.translateY : 0),
    0
  );
  return top + shift;
}

function isWhite(color: unknown): boolean {
  return /^(white|#fff|#ffffff)$/i.test(String(color));
}

describe('🔴 TRIP-1088 V1·V2 · FAB 노출 스위치와 누름', () => {
  it('V1a 콜백을 주면 앵커 안에 FAB 가 서고, 글자는 정확히 「오늘의 회고」, 아이콘은 흰 NoteGlyph(선 4개)다', () => {
    renderView();

    const anchor = screen.getByTestId(ANCHOR);
    const fab = within(anchor).getByTestId(FAB);
    expect(fab).toHaveTextContent('오늘의 회고');
    expect(within(fab).UNSAFE_getByType(NoteGlyph)).toBeTruthy();
    const paths = within(fab).UNSAFE_getAllByType(Path);
    expect(paths).toHaveLength(4);
    // 코랄 알약 위 아이콘 — 흰색이 아니면 보이지 않는다(02a ★11).
    expect(paths.map((path) => isWhite(path.props.stroke))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('V1b 콜백이 없으면 FAB 도 앵커도 없다 (뷰는 그대로 그려진다)', () => {
    renderView({ onPressReflection: undefined });

    expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
    expect(screen.queryByTestId(FAB)).toBeNull();
    expect(screen.queryByTestId(ANCHOR)).toBeNull();
    expect(screen.queryByText('오늘의 회고')).toBeNull();
  });

  it('V2 FAB 를 누르면 콜백이 1회 불린다', () => {
    const { onPressReflection } = renderView();
    expect(onPressReflection).toHaveBeenCalledTimes(0);

    fireEvent.press(screen.getByTestId(FAB));

    expect(onPressReflection).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TRIP-1088 V3·V4·V5 · FAB 가 시트 윗변에 붙어 따라가고, 칩 줄 아래에서 멈춘다', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('V5 뷰는 시트 위치 상자(SharedValue)를 셸에 넘긴다', () => {
    renderView();

    expect(isSharedValue(sheetHost().props.animatedPosition)).toBe(true);
  });

  it('V3 시트 윗변이 380 → 816 → 500 으로 움직이면 FAB 윗변이 매번 8+52 위(320 → 756 → 440)로 따라간다 (상태바 47)', () => {
    renderViewWithStatusBar();
    // 실기처럼 칩 줄은 safeTop 47 + 셸 pt-sm 8 = 55 에서 시작하고 높이 36(칩 h-[36px]).
    layoutOverlay(55, 36);

    moveSheet(380); // 중간 — Figma 4716:2833 시트 윗변 380, FAB y 320
    expect(anchorTop()).toBe(320);

    moveSheet(816); // 닫힘
    expect(anchorTop()).toBe(756);

    moveSheet(500); // 끄는 중간값 — 스냅이 아니어도 따라간다
    expect(anchorTop()).toBe(440);
  });

  it('V3b 시트 위치가 들어오기 전 첫 자리는 화면 아래쪽(창 높이 − 8 − 52)이다', () => {
    renderView();
    flushFrames();

    expect(anchorTop()).toBe(Dimensions.get('window').height - 8 - 52);
  });

  it('V4 펼침(윗변 122)에서는 칩 줄 하단 91 + 8 = 99 에서 멈추고, 칩 줄을 하단 135 로 다시 재면 143 으로 따라 내려간다', () => {
    renderViewWithStatusBar();
    layoutOverlay(55, 36);

    moveSheet(122); // 추종값 62 는 칩 줄과 겹친다
    expect(anchorTop()).toBe(99);

    layoutOverlay(99, 36); // 시트는 그대로, 칩 줄만 다시 잰다
    expect(anchorTop()).toBe(143);
  });

  it('V4b 재는 노드(record-trip-overlay-row)는 자기 onLayout 을 가진 칩 줄이고, 시트 밖이며, ⊘ 배지(mapCard)는 품지 않는다', () => {
    renderView({ manualCheckin: true });

    const row = screen.getByTestId(OVERLAY_ROW);
    expect(typeof row.props.onLayout).toBe('function');
    expect(within(row).getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    expect(isInsideSheet(row)).toBe(false);
    // 짝 — 배지는 화면에 있지만 칩 줄 밖이다(하한이 배지 높이만큼 내려가지 않게, 02a ★7).
    expect(screen.getByTestId('record-map-gps-off')).toBeOnTheScreen();
    expect(within(row).queryByTestId('record-map-gps-off')).toBeNull();
  });
});

describe('🔴 TRIP-1088 V6 · 앵커는 뷰 루트 직속·셸 뒤 형제, style 로만 자리 잡는다', () => {
  it('V6 가장 가까운 host 부모가 record-trip-view 이고 셸 안이 아니며 셸보다 뒤에 그려진다 — className 없음·absolute·오른쪽 16·bottom 없음·box-none', () => {
    renderView();

    const anchor = screen.getByTestId(ANCHOR);
    const hostParent = ancestorsOf(anchor).find(
      (node) => typeof node.type === 'string'
    );
    expect(hostParent?.props.testID).toBe('record-trip-view');
    expect(ancestorsOf(anchor).map((node) => node.props.testID)).not.toContain(
      'map-sheet-shell-root'
    );
    const shellRoot = screen.getByTestId('map-sheet-shell-root');
    expect(treeIndexOf(screen.UNSAFE_root, anchor)).toBeGreaterThan(
      treeIndexOf(screen.UNSAFE_root, shellRoot)
    );

    // reanimated Animated.View 의 className 은 기기에서 적용된다는 근거가 없다(02a ★6).
    expect(anchor.props.className).toBeUndefined();
    expect(anchor.props.pointerEvents).toBe('box-none');
    const style = anchorStyle();
    expect(style.position).toBe('absolute');
    expect(style.right).toBe(16);
    expect(style.bottom).toBeUndefined();
  });
});

describe('🔴 TRIP-1088 V7 · 칩 줄을 뷰가 감싸도 칩 선택·뒤로는 그대로다', () => {
  it('V7 활성 일자 칩만 선택돼 있고, 3일차 칩은 그 날짜를 1회 올리며, ‹ 는 뒤로를 1회 부른다', () => {
    const { onSelectDay, onPressBack } = renderView();

    expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();
    expect(screen.getByTestId('sheet-daychip-0')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('sheet-daychip-2'));
    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith('2026-06-12');
    expect(onPressBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TRIP-1088 V8 · INV-3 — FAB 가 있어도 소요·체류 글자 0', () => {
  it('V8 화면 전체 글자에 FAB 라벨은 있고 N분·N시간·소요·체류는 없다', () => {
    renderView();

    const text = renderedText(screen.UNSAFE_root);
    expect(text).toContain('오늘의 회고');
    expect(/(\d+\s*분|\d+\s*시간|소요|체류)/.test(text)).toBe(false);
  });
});
