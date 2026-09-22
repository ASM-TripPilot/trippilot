import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Text } from 'react-native';

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
 *  - 배선: 뒤로·칩·FAB·[방문 완료] 가 콜백으로, [사진]/[메모] 가 "준비 중" 힌트로 이어진다.
 *  - 셸 가산 사용: 3스냅 + 초기 스냅(0/1/2) 전달, 지도 조작 가능(잠그지 않음), 현재위치 점·상태 핀.
 *  - 748 전까지 트리거 칩·슬롯 배너 슬롯을 그대로 받는다(트리거 통합 green 유지).
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
    onPressReplan: jest.fn(),
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
  it('뒤로·칩·FAB·[방문 완료] press 가 각 콜백을 부른다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId('execution-live-back'));
    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));
    fireEvent.press(screen.getByTestId('execution-live-replan-fab'));
    fireEvent.press(screen.getByTestId('execution-arrive-complete'));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectDay).toHaveBeenCalledWith(2);
    expect(handlers.onPressReplan).toHaveBeenCalledTimes(1);
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

describe('LiveHubView · HV6 트리거 슬롯 유지 (AC-6 — 748 재배치 전)', () => {
  it('triggerChip 노드를 그리고, renderSlotBanner 를 slotKey 로 불러 그 노드를 그린다', () => {
    const renderSlotBanner = jest.fn((slotKey: string) =>
      slotKey === `${DATE}#museum` ? (
        <Text testID="fake-banner">비 예보</Text>
      ) : null
    );
    renderHub({
      triggerChip: <Text testID="fake-trigger-chip">칩</Text>,
      renderSlotBanner,
    });

    expect(screen.getByTestId('fake-trigger-chip')).toBeOnTheScreen();
    expect(screen.getByTestId('fake-banner')).toBeOnTheScreen();
    const keys = renderSlotBanner.mock.calls.map(([slotKey]) => slotKey);
    expect(new Set(keys)).toEqual(
      new Set(SLOTS.map(({ slot }) => `${DATE}#${slot.poiId}`))
    );
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
