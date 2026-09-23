import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot/model';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
} from '@/features/execution/ui/ExecutionGlyphs';

import { LiveHubView, type LiveHubSlot } from './LiveHubView';

/**
 * TRIP-746 · AC-1·AC-2·AC-4 · Seed Q1·Q2 — i01 여행중 허브 **순수 뷰**(pages · api import 0).
 *
 * 무엇을 보장하나:
 *  - 골격: 전면 지도(셸) 위 좌상단 뒤로가기 + 일자 칩, 시트 헤더 한 줄
 *    "부산 여행 · 2일차 · 6월 11일(목) · 5곳", 카드 5장, 우하단 연필 FAB(`execution-live-replan-fab`).
 *  - 부재: 탭바·세그먼트·방패 FAB·옛 헤더·지도 세그먼트·수동 [도착]·다음 길찾기·레일 시각 열.
 *  - 배선: 뒤로·칩·[방문 완료] 가 콜백으로, [사진]/[메모] 가 "준비 중" 힌트로 이어진다.
 *  - TRIP-747 수정 알약: 연필 FAB 는 이동하지 않고 제자리 토글이다 — 열면 × 얼굴 + 흰 알약 2개
 *    (`AI에게 맡기기`·`직접 수정`), 알약을 누르면 메뉴가 닫히고 그 콜백만 1회 불린다(BR-U4-10 진입).
 *    딤이 없고 바깥 탭으로는 닫히지 않는다(Seed ③). 초기 열림은 `initialEditMenuOpen`(프리뷰 입구).
 *  - 셸 가산 사용: 3스냅 + 초기 스냅(0/1/2) 전달, 지도 조작 가능(잠그지 않음), 현재위치 점·상태 핀.
 *  - TRIP-748 트리거 표면: 알약은 시트가 아니라 지도 위(일자 칩 아래)에 서고, 영향 카드는 배지로
 *    표시되며, 카드 아래 배너 슬롯은 없다. 알약은 시트 스크롤·끌기·지도 탭·다른 버튼으로 로컬 숨김(D3) —
 *    열린 수정 알약 메뉴는 그대로 둔다(HP9 공존).
 *
 * ⚠️ 원리적 사각(02a ★1·★2): 스냅별로 무엇이 보이는지는 통과형 시트 목이 못 본다(5카드는 늘 렌더) —
 *   넘긴 index·snapPoints 까지만 잠근다. 실전환·FAB 가림·핸들 모양은 AC-V2(6-b).
 * 3동작: 준비(Figma 5곳 픽스처) → 실행(렌더·press) → 단언(testID 트리·문구·콜백).
 */

const DATE = '2026-06-11';
const DAYS = [{ date: '2026-06-10' }, { date: DATE }, { date: '2026-06-12' }];

const mkSlot = (
  poiId: string,
  nameKo: string,
  startAt: string,
  lat: number,
  lng: number,
  openingHours: string | null = null
): ItineraryDaysItemSlotsItem => ({
  poiId,
  startAt,
  endAt: startAt,
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo,
  distanceRange: '약 1.2km',
  openingHours,
  lat,
  lng,
  tags: [],
});

const SLOTS: LiveHubSlot[] = [
  {
    state: 'done',
    slot: mkSlot('gamcheon', '감천문화마을', '09:30:00', 35.0975, 129.0106),
    photos: [{ uri: 'file:///g1.jpg' }, { uri: 'file:///g2.jpg' }],
    memo: '골목마다 알록달록한 벽화. 전망대에서 인증샷 남겼다.',
  },
  {
    state: 'done',
    slot: mkSlot('gwangalli', '광안리 해변', '11:00:00', 35.1532, 129.1186),
    photos: [{ uri: 'file:///w1.jpg' }, { uri: 'file:///w2.jpg' }],
    memo: '바람이 좋았다. 백사장 산책하고 커피 한 잔 마셨다.',
  },
  {
    state: 'active',
    slot: mkSlot('museum', '부산시립미술관', '13:00:00', 35.1667, 129.137),
  },
  {
    state: 'upcoming',
    slot: mkSlot(
      'jeonpo',
      '전포 카페거리',
      '15:00:00',
      35.1555,
      129.0636,
      '11:00 - 22:00'
    ),
  },
  {
    state: 'upcoming',
    slot: mkSlot(
      'haeundae',
      '해운대 해변',
      '17:00:00',
      35.1587,
      129.1604,
      '24시간 개방'
    ),
  },
];

const CARD_ROOT = /^execution-live-slot-2026-06-11#[^#]+$/;

// 지도 핀 물방울 색(shared/map MapView 의 raw hex — SVG 는 className 을 못 받는다).
const PIN_PRIMARY = '#FF385C';
const PIN_SUCCESS = '#0E9384';
const PIN_MUTED_SOFT = '#9AA1AB';

type Overrides = Partial<Parameters<typeof LiveHubView>[0]>;

function renderHub(overrides: Overrides = {}) {
  const handlers = {
    onBack: jest.fn(),
    onSelectDay: jest.fn(),
    onPressAiReplan: jest.fn(),
    onPressManualEdit: jest.fn(),
    onPressComplete: jest.fn(),
  };
  render(
    <LiveHubView
      tripTitle="부산 여행"
      days={DAYS}
      activeDayIndex={1}
      slots={SLOTS}
      initialSnapIndex={2}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

/** 통과형 시트 목에 실린 {index, snapPoints} (합성·호스트 두 겹 — 개수는 세지 않는다, SH5 선례). */
function sheetProps(): { index: number; snapPoints: unknown[] }[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => ({
      index: node.props.index as number,
      snapPoints: node.props.snapPoints as unknown[],
    }));
}

describe('LiveHubView · HV1 골격 (AC-1)', () => {
  it('지도 셸 위에 뒤로가기·일자 칩 3개(2일차 선택)·헤더 한 줄·카드 5장·연필 FAB 가 선다', () => {
    renderHub();

    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-live-back')).toBeOnTheScreen();

    // 일자 칩 — 라벨 "N일차", 선택은 2일차(index 1)만.
    expect(screen.getByTestId('execution-live-daychip-0')).toHaveTextContent(
      '1일차'
    );
    expect(screen.getByTestId('execution-live-daychip-1')).toHaveTextContent(
      '2일차'
    );
    expect(screen.getByTestId('execution-live-daychip-2')).toHaveTextContent(
      '3일차'
    );
    expect(screen.queryByTestId('execution-live-daychip-3')).toBeNull();
    expect(screen.getByTestId('execution-live-daychip-1')).toBeSelected();
    expect(screen.getByTestId('execution-live-daychip-0')).not.toBeSelected();
    expect(screen.getByTestId('execution-live-daychip-2')).not.toBeSelected();

    // 헤더 — 한 leaf 에 여행명·일차·날짜·곳 수(완전 일치).
    expect(screen.getByTestId('execution-live-sheet-header')).toHaveTextContent(
      '부산 여행 · 2일차 · 6월 11일(목) · 5곳'
    );

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.getByTestId('execution-live-replan-fab')).toBeOnTheScreen();
  });
});

describe('LiveHubView · HV2 부재 (AC-2)', () => {
  it('탭바·세그먼트·방패 FAB·옛 헤더·지도 세그먼트·수동 [도착]·다음 길찾기·레일 시각이 없다', () => {
    renderHub();

    // 짝 앵커 — 카드 5장이 실제로 있다(빈 렌더 공허 통과 차단, 02a ★5).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);

    const gone = [
      'shell-tabbar-root',
      'execution-live-segment-itinerary',
      'execution-live-segment-map',
      'execution-live-watchlist-fab',
      'execution-live-map',
      'execution-live-header-title',
      'execution-live-header-subtitle',
      'execution-arrive-next-nav',
      'execution-arrive-next-distance',
    ];
    gone.forEach((testID) => expect(screen.queryByTestId(testID)).toBeNull());
    expect(screen.queryAllByTestId(/^execution-arrive-manual-/)).toHaveLength(
      0
    );
    expect(screen.queryAllByTestId(/^execution-live-segment-/)).toHaveLength(0);
    expect(
      screen.queryAllByTestId(/^execution-live-slot-distance-/)
    ).toHaveLength(0);
    // 옛 영업시간 leaf·시각범위 배지(02a §1-2) — 5-b 참고-2 보강. `09:30–10:50` 배지는 아래
    // "`09:30` 정확히 1개" 셈에 안 걸리므로(완전 일치) testID 로 따로 센다.
    expect(screen.queryAllByTestId(/^execution-live-slot-hours-/)).toHaveLength(
      0
    );
    expect(screen.queryAllByTestId(/^execution-live-slot-range-/)).toHaveLength(
      0
    );

    // 레일 시각 열 부재 — 단독 "HH:mm" 텍스트는 done 카드 우측 leaf 뿐이다(각 1개). active·upcoming
    // 시각은 상태줄 문장 안에만 있어 단독 leaf 로는 0개(02a ★4 — 중첩 Text 면 이 셈이 깨진다).
    expect(screen.getAllByText('09:30')).toHaveLength(1);
    expect(screen.getAllByText('11:00')).toHaveLength(1);
    expect(screen.queryAllByText('13:00')).toHaveLength(0);
    expect(screen.queryAllByText('15:00')).toHaveLength(0);
    expect(screen.queryAllByText('17:00')).toHaveLength(0);
  });
});

describe('LiveHubView · HV3 배선 (AC-1·AC-4 · Seed Q2)', () => {
  // TRIP-747: FAB 는 더 이상 이동 콜백이 아니다(토글) — FAB 배선은 아래 HP 묶음이 잠근다.
  it('뒤로·칩·[방문 완료] press 가 각 콜백을 부른다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId('execution-live-back'));
    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));
    fireEvent.press(screen.getByTestId('execution-arrive-complete'));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectDay).toHaveBeenCalledWith(2);
    expect(handlers.onPressComplete).toHaveBeenCalledTimes(1);
  });

  it('[사진]을 누르면 오류 없이 "준비 중" 힌트가 드러난다 (BR-U4-38)', () => {
    const handlers = renderHub();

    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();

    fireEvent.press(screen.getByTestId('execution-arrive-photo'));

    expect(screen.getByTestId('execution-arrive-soon-hint')).toBeOnTheScreen();
    expect(handlers.onPressComplete).not.toHaveBeenCalled();
  });
});

describe('LiveHubView · HV4 3스냅 (AC-7 전제)', () => {
  it.each([0, 1, 2])(
    'initialSnapIndex=%i 이면 시트가 그 index 와 3스냅을 받는다',
    (snap) => {
      renderHub({ initialSnapIndex: snap });

      const all = sheetProps();
      expect(all.length).toBeGreaterThan(0);
      all.forEach(({ index, snapPoints }) => {
        expect(index).toBe(snap);
        expect(snapPoints).toHaveLength(3);
      });
    }
  );
});

describe('LiveHubView · HV5 지도 (Seed Q1 · 브리프 골격)', () => {
  // no-dynamic-env-var 회피 — 선언과 대입 분리(MapView.test 선례). 키가 있어야 map-native 가 뜬다(★2).
  const KEY_NAME = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
  let original: string | undefined;
  original = process.env[KEY_NAME];
  beforeEach(() => {
    process.env[KEY_NAME] = 'test-naver-client-id';
  });
  afterEach(() => {
    if (original === undefined) delete process.env[KEY_NAME];
    else process.env[KEY_NAME] = original;
  });

  it('지도는 잠기지 않고(제스처 4종 on) 5슬롯 핀과 현재위치 점을 그린다', () => {
    renderHub({ currentLocation: { lat: 35.16, lng: 129.13 } });

    const map = screen.getByTestId('map-native');
    [
      'isScrollGesturesEnabled',
      'isZoomGesturesEnabled',
      'isRotateGesturesEnabled',
      'isTiltGesturesEnabled',
    ].forEach((toggle) => expect(map.props[toggle]).toBe(true));

    [1, 2, 3, 4, 5].forEach((n) =>
      expect(screen.getByTestId(`map-marker-pin-${n}`)).toBeOnTheScreen()
    );
    expect(screen.getByTestId('map-current-location')).toBeOnTheScreen();
  });

  // 5-b 경고-1 보강 — 핀이 "있다"만이 아니라 슬롯 진행 상태를 옮겨 받았는지 본다. 색은 SVG
  // fill/stroke 리터럴로만 관측된다(MapView.test AC-1 방법). 상태마다 교차 부재를 함께 걸어
  // "전부 한 색" 뮤테이션을 막는다. 픽스처: ①② done · ③ active · ④⑤ upcoming.
  it('핀이 진행 상태를 따른다 — ①② 초록+체크, ③ 분홍, ④⑤ 회색 테두리', () => {
    renderHub();

    const pin = (n: number) => screen.getByTestId(`map-marker-pin-${n}`);
    const byFill = (n: number, color: string) =>
      within(pin(n)).UNSAFE_queryAllByProps({ fill: color }).length;
    const byStroke = (n: number, color: string) =>
      within(pin(n)).UNSAFE_queryAllByProps({ stroke: color }).length;
    const check = (n: number) =>
      within(pin(n)).queryByTestId(`map-marker-check-${n}`);

    [1, 2].forEach((n) => {
      expect(check(n)).not.toBeNull();
      expect(byFill(n, PIN_SUCCESS)).toBeGreaterThan(0);
      expect(byFill(n, PIN_PRIMARY)).toBe(0);
    });

    expect(byFill(3, PIN_PRIMARY)).toBeGreaterThan(0);
    expect(check(3)).toBeNull();
    expect(byStroke(3, PIN_MUTED_SOFT)).toBe(0);

    [4, 5].forEach((n) => {
      expect(byStroke(n, PIN_MUTED_SOFT)).toBeGreaterThan(0);
      expect(check(n)).toBeNull();
      expect(byFill(n, PIN_PRIMARY)).toBe(0);
      expect(byFill(n, PIN_SUCCESS)).toBe(0);
    });
  });
});

describe('LiveHubView · HV6 카드 아래 배너 슬롯 삭제 (TRIP-748 AC-6)', () => {
  it('renderSlotBanner 를 억지로 넘겨도 배너 노드를 그리지 않는다', () => {
    const renderSlotBanner = jest.fn(() => (
      <Text testID="fake-banner">비 예보 · 17시 이후 비</Text>
    ));
    // 삭제된 prop 이라 타입에 없다 — 런타임 무시를 보려고 object 스프레드로 넣는다(02a ★15).
    renderHub({ ...({ renderSlotBanner } as object) });

    // 짝 앵커 — 허브가 실제로 그려졌다.
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.queryByTestId('fake-banner')).toBeNull();
    expect(renderSlotBanner).not.toHaveBeenCalled();
  });
});

describe('LiveHubView · HV7 레일 점 (5-b 경고-1 보강)', () => {
  // 레일 점엔 testID 가 없다 — 대신 어떤 글리프 컴포넌트가 그려졌는지를 트리 순서대로 읽는다.
  // 세 글리프는 레일에서만 쓰이므로(카드는 entities 라 features 글리프를 못 문다) 전체 트리에서
  // 찾아도 레일 점만 잡힌다. 순서까지 비교해야 done↔upcoming 맞바꿈도 잡힌다(개수만 세면 2·1·2 그대로).
  const RAIL_STATE = new Map<unknown, string>([
    [RailDoneGlyph, 'done'],
    [RailActiveGlyph, 'active'],
    [RailUpcomingGlyph, 'upcoming'],
  ]);

  it('슬롯마다 상태에 맞는 점이 카드 순서대로 하나씩 선다', () => {
    renderHub();

    const railStates = screen.UNSAFE_root.findAll((node) =>
      RAIL_STATE.has(node.type)
    ).map((node) => RAIL_STATE.get(node.type));

    expect(railStates).toEqual([
      'done',
      'done',
      'active',
      'upcoming',
      'upcoming',
    ]);
  });
});

// ── TRIP-747 · 수정 알약 열림 ────────────────────────────────────────────────

const FAB = 'execution-live-replan-fab';
const PILL_AI = 'execution-live-edit-pill-ai';
const PILL_MANUAL = 'execution-live-edit-pill-manual';
const PILL_ANY = /^execution-live-edit-pill-(ai|manual)$/;
const PRIMARY = '#FF385C';

/** 알약 서브트리에서 SVG 색 prop(fill|stroke)이 primary 인 노드 수 — 대소문자 무시(02a ★6). */
function primaryCount(testID: string, prop: 'fill' | 'stroke'): number {
  return screen
    .getByTestId(testID)
    .findAll(
      (node) =>
        typeof node.props?.[prop] === 'string' &&
        (node.props[prop] as string).toUpperCase() === PRIMARY
    ).length;
}

/** FAB 가 닫힘(연필) 얼굴인지 — 이름·글리프 두 신호를 함께 본다(02a ★3·★5). */
function expectFabClosedFace(): void {
  const fab = screen.getByTestId(FAB);
  expect(fab).toHaveAccessibleName('일정 수정');
  expect(within(fab).getByTestId(`${FAB}-pencil`)).toBeOnTheScreen();
  expect(within(fab).queryByTestId(`${FAB}-close`)).toBeNull();
}

function expectFabOpenFace(): void {
  const fab = screen.getByTestId(FAB);
  expect(fab).toHaveAccessibleName('닫기');
  expect(within(fab).getByTestId(`${FAB}-close`)).toBeOnTheScreen();
  expect(within(fab).queryByTestId(`${FAB}-pencil`)).toBeNull();
}

const EDIT_CONTROL = /^execution-live-(replan-fab|edit-pill-(ai|manual))$/;

const isEditControlNode = (node: ReactTestInstance): boolean =>
  typeof node.props?.testID === 'string' &&
  EDIT_CONTROL.test(node.props.testID as string);

/**
 * 트리(합성·호스트 전부)에서 onPress 를 가진 노드 중 FAB·알약이 아닌 것 — 자기·조상·자손 어디에도
 * FAB·알약 testID 가 없어야 한다(EditPill 합성 같은 감싸개도 빠진다). 순서는 트리 순회 순이라 같은
 * props 로 다시 그리면 i번째가 같은 노드다(HP9).
 */
function outsidePressables(): ReactTestInstance[] {
  return screen.root.findAll((node) => {
    if (typeof node.props?.onPress !== 'function') return false;
    for (let up: ReactTestInstance | null = node; up; up = up.parent) {
      if (isEditControlNode(up)) return false;
    }
    return node.findAll(isEditControlNode).length === 0;
  });
}

function describeNode(node: ReactTestInstance): string {
  const type =
    typeof node.type === 'string'
      ? node.type
      : ((node.type as { displayName?: string; name?: string }).displayName ??
        (node.type as { name?: string }).name ??
        '?');
  return `${type} testID=${String(node.props.testID)} className=${String(node.props.className)}`;
}

describe('LiveHubView · HP 수정 알약 토글 (TRIP-747 AC-1)', () => {
  it('HP1 처음엔 닫혀 있다 — 연필 FAB 만 있고 알약은 0개', () => {
    renderHub();

    // 짝 앵커 — 허브가 실제로 그려졌다(빈 렌더 공허 통과 차단).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expectFabClosedFace();
    expect(screen.queryAllByTestId(PILL_ANY)).toHaveLength(0);
  });

  it('HP2 FAB 를 누르면 제자리에서 알약 2개(AI → 직접 수정 순)가 열리고 FAB 는 × 가 된다 — 어떤 콜백도 안 불린다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(FAB));

    expect(screen.getAllByTestId(PILL_ANY).map((n) => n.props.testID)).toEqual([
      PILL_AI,
      PILL_MANUAL,
    ]);
    expectFabOpenFace();
    // FAB 는 이동하지 않는다 — 라우트 콜백은 물론 다른 콜백도 0회(02a ★2).
    expect(handlers.onPressAiReplan).not.toHaveBeenCalled();
    expect(handlers.onPressManualEdit).not.toHaveBeenCalled();
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(handlers.onSelectDay).not.toHaveBeenCalled();
    expect(handlers.onPressComplete).not.toHaveBeenCalled();
  });

  it('HP3 열린 FAB(×)를 다시 누르면 알약이 사라지고 연필로 돌아온다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(FAB));
    fireEvent.press(screen.getByTestId(FAB));

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.queryAllByTestId(PILL_ANY)).toHaveLength(0);
    expectFabClosedFace();
    expect(handlers.onPressAiReplan).not.toHaveBeenCalled();
    expect(handlers.onPressManualEdit).not.toHaveBeenCalled();
  });

  it('HP4 알약 글자는 정확히 "AI에게 맡기기"·"직접 수정"이고, ✦·연필 글리프는 분홍(primary)이다', () => {
    renderHub();

    fireEvent.press(screen.getByTestId(FAB));

    // 완전 일치 — ✦ 를 글자로 그리면 "✦ AI에게 맡기기" 가 돼 실패한다(02a ★4, Seed ④ SVG).
    expect(screen.getByTestId(PILL_AI)).toHaveTextContent('AI에게 맡기기');
    expect(screen.getByTestId(PILL_MANUAL)).toHaveTextContent('직접 수정');
    // ✦ 는 채움(fill), 연필은 선(stroke) — 흰 연필 톤 재사용이면 0개로 실패한다(02a ★6).
    expect(primaryCount(PILL_AI, 'fill')).toBeGreaterThan(0);
    expect(primaryCount(PILL_MANUAL, 'stroke')).toBeGreaterThan(0);
  });
});

describe('LiveHubView · HP 알약 콜백 (TRIP-747 AC-2 · Seed ②)', () => {
  it('HP5 [AI에게 맡기기]를 누르면 AI 콜백만 1회 불리고 메뉴가 닫힌다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(FAB));
    fireEvent.press(screen.getByTestId(PILL_AI));

    expect(handlers.onPressAiReplan).toHaveBeenCalledTimes(1);
    expect(handlers.onPressManualEdit).not.toHaveBeenCalled();
    // 메뉴 닫힘은 두 신호 — 알약 0개 + FAB 연필 복귀(02a ★3).
    expect(screen.queryAllByTestId(PILL_ANY)).toHaveLength(0);
    expectFabClosedFace();
  });

  it('HP6 [직접 수정]을 누르면 직접 수정 콜백만 1회 불리고 메뉴가 닫힌다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(FAB));
    fireEvent.press(screen.getByTestId(PILL_MANUAL));

    expect(handlers.onPressManualEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onPressAiReplan).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId(PILL_ANY)).toHaveLength(0);
    expectFabClosedFace();
  });
});

describe('LiveHubView · HP 초기 열림·바깥 탭 (TRIP-747 AC-5 · Seed ①③)', () => {
  it('HP7 initialEditMenuOpen 이면 처음부터 열린 얼굴이고, FAB 로 닫을 수 있다', () => {
    const handlers = renderHub({ initialEditMenuOpen: true });

    expect(screen.getAllByTestId(PILL_ANY)).toHaveLength(2);
    expectFabOpenFace();
    expect(handlers.onPressAiReplan).not.toHaveBeenCalled();
    expect(handlers.onPressManualEdit).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(FAB));

    expect(screen.queryAllByTestId(PILL_ANY)).toHaveLength(0);
    expectFabClosedFace();
  });

  it('HP8 열린 채로 다른 곳(일자 칩)을 눌러도 메뉴는 닫히지 않고, 딤(bg-scrim)이 없다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(FAB));
    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));

    // 칩 press 는 그대로 통한다 — 가로막는 백드롭이 없다(실제 터치 차단 여부는 6-b, 02a ★8).
    expect(handlers.onSelectDay).toHaveBeenCalledWith(2);
    // 바깥 탭으로 닫지 않는다(× 또는 알약으로만).
    expect(screen.getAllByTestId(PILL_ANY)).toHaveLength(2);
    expectFabOpenFace();
    // Figma 4055:2427 에는 딤이 없다 — 짝 앵커는 바로 위 알약 2개.
    const scrims = screen.root.findAll(
      (node) =>
        typeof node.props?.className === 'string' &&
        /\bbg-scrim/.test(node.props.className as string)
    );
    expect(scrims).toHaveLength(0);
  });

  it('HP9 열린 채로 FAB·알약 말고 누를 수 있는 것을 무엇을 눌러도 메뉴는 닫히지 않는다', () => {
    renderHub();
    fireEvent.press(screen.getByTestId(FAB));
    const total = outsidePressables().length;
    // 짝 앵커 — 뒤로가기·일자 칩만으로도 4개 이상이다(빈 목록 공허 통과 차단).
    expect(total).toBeGreaterThanOrEqual(4);

    // 한 번에 하나씩, 매번 새로 그려 연 뒤 i번째만 누른다 — 앞 press 의 부작용이 섞이지 않게.
    const closedBy: string[] = [];
    for (let i = 0; i < total; i += 1) {
      screen.unmount();
      renderHub();
      fireEvent.press(screen.getByTestId(FAB));
      const target = outsidePressables()[i];
      // 이름은 누르기 전에 뜬다 — 백드롭은 눌리면 스스로 사라져 뒤에서는 props 를 못 읽는다.
      const label = describeNode(target);
      fireEvent.press(target);
      if (screen.queryAllByTestId(PILL_ANY).length !== 2) {
        closedBy.push(label);
      }
    }

    // 바깥 탭 닫기 백드롭(투명 전면 Pressable)을 깔면 그 노드 이름이 여기 찍힌다(03b 경고-1).
    expect(closedBy).toEqual([]);
  });
});

// ── TRIP-748 · 트리거 알약 자리 · 영향 카드 배지 · 로컬 숨김(D3) ──────────────
//
// 알약 노드는 페이지가 만들어 넘긴다(`triggerChip`) — 여기서는 누를 수 있는 가짜 알약으로 자리와
// 숨김만 본다(알약 모양은 TriggerChip.test, 페이지 배선은 트리거 통합이 본다).
// 숨김은 허브의 로컬 상태다: `triggerPillKey` 를 숨겼으면 안 그리고, 키가 바뀌면 다시 그린다.
// ⚠️ 통과형 시트 목은 onAnimate·onScrollBeginDrag 를 스스로 쏘지 않는다 — 넘겨진 prop 을 직접 부른다
//    (02a ★2·★3). 실제 드래그·마운트 애니메이션은 AC-V2(6-b).

const TRIGGER_PILL = 'fake-trigger-pill';
const HAEUNDAE_KEY = `${DATE}#haeundae`;
const JEONPO_KEY = `${DATE}#jeonpo`;

function fakePill(onPress: () => void) {
  return (
    <Pressable
      testID={TRIGGER_PILL}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text>비 예보 · 해운대 해변 17시</Text>
    </Pressable>
  );
}

function renderWithPill(overrides: Overrides = {}) {
  const onPressPill = jest.fn();
  const handlers = renderHub({
    triggerChip: fakePill(onPressPill),
    triggerPillKey: 'trg-1',
    ...overrides,
  });
  return { ...handlers, onPressPill };
}

/** snapPoints 를 가진 host(문자열 타입) 노드 — 시트 본체(목은 3겹, 02a ★3). */
function sheetHost(): ReactTestInstance {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  for (let up = node.parent; up; up = up.parent) out.push(up);
  return out;
}

function fireSheetAnimate(from: number, to: number): void {
  const onAnimate = sheetHost().props.onAnimate as unknown;
  if (typeof onAnimate !== 'function') {
    throw new Error('시트(BottomSheet)에 onAnimate 가 달려 있지 않다');
  }
  act(() => {
    (onAnimate as (f: number, t: number, fp: number, tp: number) => void)(
      from,
      to,
      0,
      0
    );
  });
}

function fireSheetScrollBeginDrag(): void {
  const nodes = screen.root.findAll(
    (node) => typeof node.props?.onScrollBeginDrag === 'function'
  );
  if (nodes.length === 0) {
    throw new Error(
      '시트 본문 스크롤 뷰에 onScrollBeginDrag 가 달려 있지 않다'
    );
  }
  act(() => {
    (nodes[nodes.length - 1].props.onScrollBeginDrag as (e: unknown) => void)({
      nativeEvent: {},
    });
  });
}

function fireMapTap(): void {
  const onTapMap = screen.getByTestId('map-native').props.onTapMap as unknown;
  if (typeof onTapMap !== 'function') {
    throw new Error('지도(map-native)에 onTapMap 이 달려 있지 않다');
  }
  act(() => {
    (onTapMap as (p: unknown) => void)({
      latitude: 35.16,
      longitude: 129.13,
      x: 10,
      y: 10,
    });
  });
}

/** 알약을 숨기는 경로(D3 · Seed ②) — 시트 스크롤·끌기, 지도 탭, 허브 안 다른 버튼. */
const HIDE_PATHS: [string, () => void][] = [
  ['시트 본문 스크롤 시작', fireSheetScrollBeginDrag],
  ['시트 끌기 onAnimate(1→2)', () => fireSheetAnimate(1, 2)],
  ['시트 끌기 onAnimate(0→1)', () => fireSheetAnimate(0, 1)],
  ['지도 탭', fireMapTap],
  [
    '일자 칩',
    () => fireEvent.press(screen.getByTestId('execution-live-daychip-2')),
  ],
  [
    '[방문 완료]',
    () => fireEvent.press(screen.getByTestId('execution-arrive-complete')),
  ],
  [
    '[사진]',
    () => fireEvent.press(screen.getByTestId('execution-arrive-photo')),
  ],
];

describe('LiveHubView · HT 트리거 알약·배지·로컬 숨김 (TRIP-748)', () => {
  // 지도 탭 경로는 map-native 가 떠야 한다 — 선언과 대입 분리(02a ★8, HV5 선례).
  const KEY_NAME = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
  let original: string | undefined;
  original = process.env[KEY_NAME];
  beforeEach(() => {
    process.env[KEY_NAME] = 'test-naver-client-id';
  });
  afterEach(() => {
    if (original === undefined) delete process.env[KEY_NAME];
    else process.env[KEY_NAME] = original;
  });

  it('HT1 알약은 시트 헤더가 아니라 지도 위 오버레이(뒤로가기·일자 칩과 같은 층)에 선다 (AC-1)', () => {
    renderWithPill();

    // 짝 앵커 — 허브와 알약이 실제로 그려졌다.
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    const pill = screen.getByTestId(TRIGGER_PILL);

    const sheet = sheetHost();
    expect(within(sheet).queryByTestId(TRIGGER_PILL)).toBeNull();
    // 알약과 뒤로가기의 가장 가까운 공통 조상이 시트를 품지 않는다 = 둘이 지도 위 같은 오버레이에 있다.
    // 알약을 시트 header 에 두면 공통 조상이 셸 루트가 돼 시트를 품는다.
    const backAncestors = new Set(
      ancestorsOf(screen.getByTestId('execution-live-back'))
    );
    const common = ancestorsOf(pill).find((node) => backAncestors.has(node));
    expect(common).toBeDefined();
    expect(common?.findAll((node) => node === sheet)).toHaveLength(0);
  });

  it('HT1b 알약을 안 넘기면 알약이 없다 (회귀 앵커)', () => {
    renderHub();

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
  });

  it('HT2 slotBadgeLabel 이 라벨을 주는 예정 카드만 "예정" 대신 그 라벨을 보인다 (AC-5)', () => {
    const slotBadgeLabel = jest.fn((slotKey: string) =>
      slotKey === HAEUNDAE_KEY ? '비 예보' : null
    );
    renderWithPill({ slotBadgeLabel });

    expect(
      screen.getByTestId(`execution-live-slot-status-${HAEUNDAE_KEY}`)
    ).toHaveTextContent('비 예보');
    expect(
      screen.getByTestId(`execution-live-slot-status-${JEONPO_KEY}`)
    ).toHaveTextContent('예정');
  });

  it.each(HIDE_PATHS)(
    'HT3 %s → 알약이 사라진다 (D3 로컬 숨김)',
    (_name, fire) => {
      renderWithPill();
      expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();

      fire();

      expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
      // 짝 앵커 — 허브는 그대로다(화면이 통째로 사라진 것이 아니다).
      expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    }
  );

  it('HT3b 숨김은 버튼의 원래 동작을 먹지 않는다 — 칩·[방문 완료]·[사진]이 각자 일을 한다', () => {
    const handlers = renderWithPill();

    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));
    fireEvent.press(screen.getByTestId('execution-arrive-complete'));
    fireEvent.press(screen.getByTestId('execution-arrive-photo'));

    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
    expect(handlers.onSelectDay).toHaveBeenCalledWith(2);
    expect(handlers.onPressComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('execution-arrive-soon-hint')).toBeOnTheScreen();
  });

  it.each([
    ['마운트 애니메이션 onAnimate(-1→2)', -1, 2],
    ['제자리 onAnimate(2→2)', 2, 2],
  ])('HT4 %s 에는 알약이 남는다 (마운트 가드 · 02a ★2)', (_name, from, to) => {
    renderWithPill();

    fireSheetAnimate(from, to);

    expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
  });

  // 펼침(2)에선 시트가 알약을 덮는다 — 거기서 내려오는 끌기는 알약을 처음 드러내는 동작이라
  // 숨기면 한 번도 안 보인 채 사라진다(5-b 경고-2 · 오케 결정 (나)).
  it.each([
    ['펼침→중간 onAnimate(2→1)', 2, 1],
    ['펼침→접힘 onAnimate(2→0)', 2, 0],
  ])(
    'HT4c %s 에는 알약이 남는다 (펼침에서 내려오는 전이)',
    (_name, from, to) => {
      renderWithPill();

      fireSheetAnimate(from, to);

      expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
    }
  );

  it('HT4d 예외는 "펼침에서 출발"뿐이다 — 중간→접힘 onAnimate(1→0)은 여전히 숨긴다', () => {
    renderWithPill();

    fireSheetAnimate(1, 0);

    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
  });

  it('HT4b 알약 자기 자신을 누르면 숨기지 않고 목적지 콜백만 1회 부른다', () => {
    const { onPressPill } = renderWithPill();

    fireEvent.press(screen.getByTestId(TRIGGER_PILL));

    expect(onPressPill).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
  });

  it('HT5 FAB 를 누르면 수정 알약 2개가 열리고, 트리거 알약은 사라진다', () => {
    renderWithPill();

    fireEvent.press(screen.getByTestId(FAB));

    expect(screen.getAllByTestId(PILL_ANY)).toHaveLength(2);
    expectFabOpenFace();
    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
  });

  it.each(HIDE_PATHS)(
    'HT6 수정 메뉴가 열린 채 %s → 트리거 알약만 사라지고 메뉴는 열려 있다 (HP9 공존 · 02a ★1)',
    (_name, fire) => {
      // FAB 로 열면 그 press 자체가 숨김이라 경로를 따로 못 본다 — 초기 열림으로 연다.
      renderWithPill({ initialEditMenuOpen: true });
      expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
      expect(screen.getAllByTestId(PILL_ANY)).toHaveLength(2);

      fire();

      expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
      expect(screen.getAllByTestId(PILL_ANY)).toHaveLength(2);
      expectFabOpenFace();
    }
  );

  it('HT7 숨김은 트리거 키에 묶인다 — 같은 키로 다시 그려도 숨긴 채, 새 키가 오면 다시 보인다', () => {
    const base = {
      tripTitle: '부산 여행',
      days: DAYS,
      activeDayIndex: 1,
      slots: SLOTS,
      initialSnapIndex: 2,
      onBack: jest.fn(),
      onSelectDay: jest.fn(),
      onPressAiReplan: jest.fn(),
      onPressManualEdit: jest.fn(),
      onPressComplete: jest.fn(),
      triggerChip: fakePill(jest.fn()),
    };
    const { rerender } = render(
      <LiveHubView {...base} triggerPillKey="trg-1" />
    );

    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));
    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();

    // 목록 재조회처럼 같은 트리거로 다시 그린다 — 숨김 유지.
    rerender(<LiveHubView {...base} triggerPillKey="trg-1" />);
    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();

    // 새 트리거가 오면 다시 보인다(useEffect 없이 키 비교로).
    rerender(<LiveHubView {...base} triggerPillKey="trg-2" />);
    expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
  });
});
