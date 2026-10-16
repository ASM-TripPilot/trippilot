import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, Pressable, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
} from '@/features/execution/index.view';

import * as probe from '@/test-support/fabAnchorProbe';
import {
  expectHeightLimited,
  expectPinsInBand,
  type NativeRegion,
} from '@/test-support/fitBandAsserts';
import {
  closestScrollView,
  fireChipLayout,
  stubScrollTo,
} from '@/test-support/sheetTree';

import { LiveHubView, type LiveHubSlot } from './LiveHubView';

/**
 * TRIP-746 · AC-1·AC-2·AC-4 · Seed Q1·Q2 — i01 여행중 허브 **순수 뷰**(pages · api import 0).
 *
 * 무엇을 보장하나:
 *  - 골격: 전면 지도(셸) 위 좌상단 뒤로가기 + 일자 칩, 시트 헤더 한 줄
 *    "부산 여행 · 2일차 · 6월 11일(목) · 5곳", 카드 5장, 시트 윗변을 따라가는 연필 FAB
 *    (`execution-live-replan-fab` — 자리 계약은 TRIP-1083 HF 절).
 *  - 부재: 탭바·세그먼트·방패 FAB·옛 헤더·지도 세그먼트·다음 길찾기·레일 시각 열. 수동 [도착]은
 *    `onPressArrive` 를 받고 진행 중 슬롯이 없을 때만 예정 카드에 선다(TRIP-1021 HV9).
 *  - 배선: 뒤로·칩·[방문 완료] 가 콜백으로 이어진다. [사진]/[메모]는 페이지가 콜백을 줄 때만 관람 중
 *    카드에 서고 각자 제 콜백을 부른다(TRIP-1070). 안 주면 없다(TRIP-939 AC-6).
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
  alternatives: [],
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
  it('탭바·세그먼트·방패 FAB·옛 헤더·지도 세그먼트·수동 [도착](미주입)·다음 길찾기·레일 시각이 없다', () => {
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
    // TRIP-1021 재조준 — 옛 `execution-arrive-manual-*` 는 사라진 이름이라 늘 0(공허). 새 [도착] 이름으로 센다.
    expect(
      screen.queryAllByTestId(/^execution-live-slot-arrive-/)
    ).toHaveLength(0);
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

  it('TRIP-939 AC-6: 사진·메모 콜백을 안 주면 활성 카드에 [사진]·[메모]·"준비 중" 힌트가 없고 [방문 완료]는 있다', () => {
    // 준비·실행: 사진·메모 콜백 없이 허브를 그린다.
    renderHub();

    // 단언(부재): 누를 곳 없는 두 버튼과 옛 힌트가 없다.
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
    // 짝 앵커: [방문 완료]는 남는다.
    expect(screen.getByTestId('execution-arrive-complete')).toBeOnTheScreen();
  });

  // TRIP-1203 — 콜백이 누른 카드의 poiId 를 받고 안내가 {poiId, text} 로 바뀌었다. 완료 카드 버튼은 아래 HD 절.
  it('TRIP-1070 AC-1: 관람 중 카드의 [사진]·[메모]는 고정 testID 한 쌍이고, 누르면 그 poiId 로 제 콜백만 부른다', () => {
    // 준비 — 사진·메모 콜백 + 관람 중 카드(museum)에 붙인 안내.
    const onPressPhoto = jest.fn();
    const onPressMemo = jest.fn();
    renderHub({
      onPressPhoto,
      onPressMemo,
      photoNotice: {
        poiId: 'museum',
        text: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
      },
    });

    // 단언 — 5장 중 관람 중 카드 1장에만 고정 한 쌍이 선다.
    expect(screen.getAllByTestId('execution-arrive-photo')).toHaveLength(1);
    expect(screen.getAllByTestId('execution-arrive-memo')).toHaveLength(1);
    expect(
      screen.getByTestId('execution-arrive-photo-notice')
    ).toHaveTextContent('사진 접근 권한이 없어 사진을 불러올 수 없어요');

    // 실행·단언 — 각자 제 콜백만, 인자는 그 카드의 poiId.
    fireEvent.press(screen.getByTestId('execution-arrive-photo'));
    expect(onPressPhoto).toHaveBeenCalledTimes(1);
    expect(onPressPhoto).toHaveBeenLastCalledWith('museum');
    expect(onPressMemo).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('execution-arrive-memo'));
    expect(onPressMemo).toHaveBeenCalledTimes(1);
    expect(onPressMemo).toHaveBeenLastCalledWith('museum');
    expect(onPressPhoto).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('execution-arrive-soon-hint')).toBeNull();
  });
});

// ── TRIP-987 A · 슬롯 이름 → i10 (US-ONTRIP-02 · TRIP-939) ─────────────────────
// 뷰는 목적지를 모른다 — `onPressSlotName(poiId)` 를 받으면 카드마다 이름 진입을 열고, 안 받으면
// 어느 카드에도 '›' 가 없다. 라우트 조립(`/trips/{id}/live/place/{poiId}`)은 페이지 몫(통합 I9).

const SLOT_NAME = /^execution-live-slot-name-2026-06-11#/;
const SLOT_CHEVRON = /^execution-live-slot-chevron-2026-06-11#/;

function isTouchable(node: ReactTestInstance): boolean {
  return (
    typeof node.props.onStartShouldSetResponder === 'function' ||
    typeof node.props.onClick === 'function'
  );
}

describe('LiveHubView · HV8 슬롯 이름 진입 (TRIP-987 A-1·A-2·A-4)', () => {
  it('HV8a 이름을 누르면 그 카드의 poiId 로 onPressSlotName 이 불린다 — done·active·upcoming 5장 전부', () => {
    const onPressSlotName = jest.fn();
    renderHub({ onPressSlotName });

    expect(screen.getAllByTestId(SLOT_CHEVRON)).toHaveLength(5);
    const pois = ['gamcheon', 'gwangalli', 'museum', 'jeonpo', 'haeundae'];
    pois.forEach((poiId, index) => {
      fireEvent.press(
        screen.getByTestId(`execution-live-slot-name-${DATE}#${poiId}`)
      );
      expect(onPressSlotName).toHaveBeenCalledTimes(index + 1);
      expect(onPressSlotName).toHaveBeenLastCalledWith(poiId);
    });
  });

  it("HV8b onPressSlotName 을 안 넘기면 어느 카드에도 '›' 가 없고 이름은 누를 수 없다 (TRIP-939)", () => {
    renderHub();

    const names = screen.getAllByTestId(SLOT_NAME);
    expect(names).toHaveLength(5);
    names.forEach((name) => expect(isTouchable(name)).toBe(false));
    expect(screen.queryAllByTestId(SLOT_CHEVRON)).toHaveLength(0);
  });

  it('HV8c [방문 완료]는 이름 진입을 부르지 않고, 이름 진입은 [방문 완료]를 부르지 않는다 (A-4)', () => {
    const onPressSlotName = jest.fn();
    const handlers = renderHub({ onPressSlotName });

    fireEvent.press(screen.getByTestId('execution-arrive-complete'));
    expect(handlers.onPressComplete).toHaveBeenCalledTimes(1);
    expect(onPressSlotName).not.toHaveBeenCalled();

    fireEvent.press(
      screen.getByTestId(`execution-live-slot-name-${DATE}#museum`)
    );
    expect(onPressSlotName).toHaveBeenCalledWith('museum');
    expect(handlers.onPressComplete).toHaveBeenCalledTimes(1);
  });
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

  it('지도에 5슬롯 핀과 현재위치 점을 그린다', () => {
    renderHub({ currentLocation: { lat: 35.16, lng: 129.13 } });

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

  it('HP4 알약 글자는 정확히 "AI에게 맡기기"·"직접 수정"이다', () => {
    renderHub();

    fireEvent.press(screen.getByTestId(FAB));

    // 완전 일치 — ✦ 를 글자로 그리면 "✦ AI에게 맡기기" 가 돼 실패한다(02a ★4, Seed ④ SVG).
    expect(screen.getByTestId(PILL_AI)).toHaveTextContent('AI에게 맡기기');
    expect(screen.getByTestId(PILL_MANUAL)).toHaveTextContent('직접 수정');
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

  it('HP8 열린 채로 다른 곳(일자 칩)을 눌러도 메뉴는 닫히지 않는다', () => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(FAB));
    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));

    // 칩 press 는 그대로 통한다 — 가로막는 백드롭이 없다(실제 터치 차단 여부는 6-b, 02a ★8).
    expect(handlers.onSelectDay).toHaveBeenCalledWith(2);
    // 바깥 탭으로 닫지 않는다(× 또는 알약으로만).
    expect(screen.getAllByTestId(PILL_ANY)).toHaveLength(2);
    expectFabOpenFace();
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
const sheetHost = probe.sheetHost;

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
  // TRIP-939 AC-6 — [사진]은 운영 화면에서 사라져 숨김 경로에서도 빠진다.
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

  it('HT3b 숨김은 버튼의 원래 동작을 먹지 않는다 — 칩·[방문 완료]가 각자 일을 한다', () => {
    const handlers = renderWithPill();

    fireEvent.press(screen.getByTestId('execution-live-daychip-2'));
    fireEvent.press(screen.getByTestId('execution-arrive-complete'));

    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
    expect(handlers.onSelectDay).toHaveBeenCalledWith(2);
    expect(handlers.onPressComplete).toHaveBeenCalledTimes(1);
    // 사진 콜백을 안 줬으므로 [사진]은 없다(TRIP-939 AC-6 · TRIP-1070 주입 시에만).
    expect(screen.queryByTestId('execution-arrive-photo')).toBeNull();
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

describe('🔴 LiveHubView · TRIP-991 오버레이 접근성 (AC-1·AC-2·AC-4)', () => {
  it('뒤로는 "뒤로" 버튼으로 읽히고, 누르면 onBack 이 1회 불린다', () => {
    const handlers = renderHub();

    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back).toHaveProp('testID', 'execution-live-back');

    fireEvent.press(back);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('일자 칩은 "N일차" 버튼으로 읽히고, 활성 일차(2일차)만 selected 다', () => {
    renderHub();

    expect(
      screen.getByRole('button', { name: '2일차', selected: true })
    ).toHaveProp('testID', 'execution-live-daychip-1');
    expect(screen.getByRole('button', { name: '1일차' })).toHaveProp(
      'testID',
      'execution-live-daychip-0'
    );
    expect(screen.getByRole('button', { name: '1일차' })).not.toBeSelected();
    expect(screen.getByRole('button', { name: '3일차' })).not.toBeSelected();
  });
});

// ── TRIP-1021 #059 · 예정 카드 수동 [도착] (AC-1·AC-3 · Seed Q1) ────────────────
//
// 뷰는 "오늘인가"를 모른다(페이지가 오늘 탭일 때만 `onPressArrive` 를 넘긴다). 뷰가 정하는 것은 하나 —
// 진행 중(active) 슬롯이 있으면 어느 카드에도 [도착]을 주지 않는다(deriveVisitProgress 가 active 를
// 하나만 인정해, 두 번째 도착은 앞 슬롯을 '예정'으로 되돌려 보이게 만든다 — 브리프 Q1).

const ARRIVE_ANY = /^execution-live-slot-arrive-/;
const arriveId = (poiId: string) =>
  `execution-live-slot-arrive-${DATE}#${poiId}`;
/** 진행 중을 뺀 픽스처 — museum 을 예정으로 돌린다(done 2 · upcoming 3). */
const NO_ACTIVE: LiveHubSlot[] = SLOTS.map((entry) =>
  entry.state === 'active' ? { ...entry, state: 'upcoming' as const } : entry
);

describe('LiveHubView · HV9 수동 [도착] (TRIP-1021 AC-1·AC-3 · Q1)', () => {
  it('HV9a 진행 중이 없으면 예정 카드마다 [도착]이 서고, 누르면 그 poiId 로 1회 불린다', () => {
    const onPressArrive = jest.fn();
    const handlers = renderHub({ slots: NO_ACTIVE, onPressArrive });

    // 예정 3장(museum·jeonpo·haeundae)에만 — done 2장에는 없다.
    for (const poiId of ['museum', 'jeonpo', 'haeundae']) {
      expect(screen.getByTestId(arriveId(poiId))).toBeOnTheScreen();
    }
    for (const poiId of ['gamcheon', 'gwangalli']) {
      expect(screen.queryByTestId(arriveId(poiId))).toBeNull();
    }

    fireEvent.press(screen.getByTestId(arriveId('jeonpo')));

    expect(onPressArrive).toHaveBeenCalledTimes(1);
    expect(onPressArrive).toHaveBeenCalledWith('jeonpo');
    expect(handlers.onPressComplete).not.toHaveBeenCalled();
  });

  it('HV9b 진행 중 슬롯이 있으면 onPressArrive 를 받아도 어느 카드에도 [도착]이 없다', () => {
    renderHub({ onPressArrive: jest.fn() });

    // 짝 앵커 — 카드 5장이 있고, 예정 카드도 실제로 있다(부재가 빈 렌더에서 공허하게 통과하지 않게).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(
      screen.getByTestId(`execution-live-slot-status-${DATE}#jeonpo`)
    ).toHaveTextContent('예정');
    expect(screen.queryAllByTestId(ARRIVE_ANY)).toHaveLength(0);
  });

  it('HV9c onPressArrive 를 안 넘기면 진행 중이 없어도 [도착]이 없다', () => {
    renderHub({ slots: NO_ACTIVE });

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.queryAllByTestId(ARRIVE_ANY)).toHaveLength(0);
  });
});

// ── TRIP-1083 · 수정 FAB 가 시트 윗변을 따라간다 ─────────────────────────────
//
// FAB 묶음 래퍼(`execution-live-fab-anchor`, reanimated Animated.View)의 윗변 y =
//   max(오버레이 줄 하단 + 8, 시트 윗변 − 8 − 52)   (Figma 4702:2688·2833·2982·3131)
// 시트 윗변은 셸이 gorhom 에 넘긴 SharedValue 상자(`animatedPosition`)다 — 통과형 목이 그 prop 을
// host 에 그대로 남기므로 테스트가 `.value` 를 직접 써서 "시트가 움직였다"를 흉내 낸다(02a ★7).
// ⚠️ 관측은 getAnimatedStyle + 가짜 타이머로만 — host `props.style` 은 첫 렌더 값에 굳는다(02a ★1·★2).
// 실제 드래그 추종·마운트 첫 프레임·좁은 화면 넘침은 6-b(AC-V1~V4).

const ANCHOR = 'execution-live-fab-anchor';
const OVERLAY_ROW = 'execution-live-overlay-row';

const flushFrames = probe.flushFrames;
const moveSheet = probe.moveSheet;

/** 오버레이 줄(뒤로+일자 칩)이 기기에서 잰 자리 — 하단 = y + height. */
function layoutOverlay(y: number, height: number): void {
  probe.layoutOverlay(OVERLAY_ROW, { y, height, width: 280 });
}

const anchorTop = () => probe.anchorTop(ANCHOR);

// TRIP-1321 · BR-U8-50·51 — 여행 중 허브의 ✦ 도우미는 수정 FAB 앵커 열의 맨 위(수정 FAB 위 12).
// 앵커 윗변이 ✦ 몫(56+12)만큼 올라가 수정 FAB 자리는 그대로다. 실제 드래그 추종·터치는 6-b 실기.
describe('LiveHubView · ✦ 도우미 FAB 앵커 열 (TRIP-1321)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function Fab() {
    return <View testID="assistant-fab" />;
  }

  it('시트 윗변 380 이면 앵커 윗변은 380 − 8 − 52 − (56 + 12) = 252 (수정 FAB 는 그대로 320 에)', () => {
    renderHub({ initialSnapIndex: 1, assistantFab: <Fab /> });
    layoutOverlay(15, 40);
    moveSheet(380);
    expect(anchorTop()).toBe(252);
  });

  it('메모 시트가 열리면(fabHidden) ✦ 도 함께 빠진다(BR-U8-53)', () => {
    renderHub({ fabHidden: true, assistantFab: <Fab /> });
    expect(screen.queryByTestId('assistant-fab')).toBeNull();
  });
});

describe('LiveHubView · HF 수정 FAB 시트 윗변 앵커 (TRIP-1083)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('HF2 시트 윗변이 380 → 816 → 500 으로 움직이면 FAB 윗변이 매번 8+52 위(320 → 756 → 440)로 따라간다 (AC-1)', () => {
    renderHub({ initialSnapIndex: 1 });
    layoutOverlay(15, 40);

    moveSheet(380); // 중간 스냅(Figma 4702:2833)
    expect(anchorTop()).toBe(320);

    moveSheet(816); // 닫힘 스냅(Figma 4702:2688)
    expect(anchorTop()).toBe(756);

    moveSheet(500); // 끄는 중간 — 스냅이 아닌 값에서도 따라간다
    expect(anchorTop()).toBe(440);
  });

  it('HF3 펼침(윗변 122)에서는 오버레이 줄 하단 55 + 8 = 63 에서 멈춘다 — 추종값 62 로 올라가지 않는다 (AC-2)', () => {
    renderHub({ initialSnapIndex: 2 });
    layoutOverlay(15, 40);

    moveSheet(122); // 펼침 스냅(Figma 4702:2982)

    expect(anchorTop()).toBe(63);
  });

  it('HF4 하한은 잰 오버레이 줄을 따른다 — 하단 99 면 107, 시트는 그대로 두고 하단 55 로 다시 재면 63 (AC-2)', () => {
    renderHub({ initialSnapIndex: 2 });
    layoutOverlay(59, 40);

    moveSheet(122);
    expect(anchorTop()).toBe(107);

    layoutOverlay(15, 40);
    expect(anchorTop()).toBe(63);
  });

  it('HF5 상태바가 있어도(safeTop 47) 시트 윗변 값을 그대로 쓴다 — 380 → 320, 펼침 122 → 오버레이 하단 95 + 8 = 103 (AC-1 · 브리프 맹점 4)', () => {
    render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 47, bottom: 34, left: 0, right: 0 }}
      >
        <LiveHubView
          tripTitle="부산 여행"
          days={DAYS}
          activeDayIndex={1}
          slots={SLOTS}
          initialSnapIndex={1}
          onBack={jest.fn()}
          onSelectDay={jest.fn()}
          onPressAiReplan={jest.fn()}
          onPressManualEdit={jest.fn()}
        />
      </SafeAreaInsetsContext.Provider>
    );
    // 실기처럼 오버레이 줄은 safeTop 47 + 셸 pt-sm 8 = 55 에서 시작한다.
    layoutOverlay(55, 40);

    moveSheet(380);
    expect(anchorTop()).toBe(320);

    moveSheet(122);
    expect(anchorTop()).toBe(103);
  });

  it('HF9 시트 위치가 한 번도 들어오기 전(첫 렌더)엔 FAB 가 화면 아래쪽 — 창 높이 − 8 − 52 에서 시작한다 (03b 참고-1)', () => {
    renderHub({ initialSnapIndex: 1 });
    flushFrames();

    // moveSheet 를 부르지 않는다 — 초기값만으로 정해지는 첫 자리.
    expect(anchorTop()).toBe(Dimensions.get('window').height - 8 - 52);
  });
});

// ── TRIP-1117 · 허브 메모 시트의 뷰 쪽 배선 ─────────────────────────────────────────
//
// 뷰는 저장을 모른다 — 페이지가 준 값만 그린다. 관람 중 슬롯의 `memo`(세션 저장본)는 관람 중 카드 메모 박스로,
// `memoNotice`(시트가 닫힌 뒤 도착한 저장 실패, Q3)는 관람 중 카드에만, `fabHidden`(메모 시트가 열림)은 수정
// FAB 를 숨긴다(Figma 4741:2833 F5). FAB 를 숨기려고 앵커를 셸 안으로 옮기면 HF8 좌표 원점이 어긋난다.

const MEMO_NOTICE = '메모를 저장하지 못했어요. 다시 시도해 주세요.';
const ACTIVE_KEY = `${DATE}#museum`;

describe('LiveHubView · HM 메모 시트 배선 (TRIP-1117)', () => {
  it('🔴 HM1 결정 2: 관람 중 슬롯에 memo 가 있으면 관람 중 카드에 박스가 선다 — done 2개와 합쳐 3개', () => {
    const slots = SLOTS.map((entry) =>
      entry.state === 'active' ? { ...entry, memo: '바다가 예뻤다' } : entry
    );

    renderHub({ slots });

    expect(
      screen.getByTestId(`execution-live-slot-memo-${ACTIVE_KEY}`)
    ).toHaveTextContent('바다가 예뻤다');
    expect(screen.getAllByTestId(/^execution-live-slot-memo-/)).toHaveLength(3);
  });

  // TRIP-1203 — memoNotice 는 {poiId, text}: 그 poiId 카드에만 선다.
  it('🔴 HM2 Q3: 관람 중 poiId 로 memoNotice 를 주면 안내 한 줄이 관람 중 카드에만 1개 선다', () => {
    renderHub({
      onPressMemo: jest.fn(),
      memoNotice: { poiId: 'museum', text: MEMO_NOTICE },
    });

    const notices = screen.getAllByTestId('execution-arrive-memo-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent(MEMO_NOTICE);
    expect(
      within(
        screen.getByTestId(`execution-live-slot-${ACTIVE_KEY}`)
      ).getByTestId('execution-arrive-memo-notice')
    ).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId(/^execution-live-slot-done-memo-notice-/)
    ).toHaveLength(0);
  });

  it('🔴 HM3 AC-15: fabHidden 이면 수정 FAB 가 없고, 안 주면 FAB 가 있다', () => {
    renderHub({ fabHidden: true });
    // 짝 앵커 — 허브는 그려졌다.
    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('execution-live-replan-fab')).toBeNull();

    screen.unmount();
    renderHub();

    expect(screen.getByTestId('execution-live-replan-fab')).toBeOnTheScreen();
  });
});

// ── TRIP-1203 · 방문 완료 카드의 [사진]·[메모] (US-REC-02 · G-U4-7) ─────────────────────────
//
// 뷰는 방문 id 를 모른다 — 페이지가 "방문 id 를 아는 완료 슬롯"의 poiId 집합(`doneMediaPoiIds`)을 주면 그
// 완료 카드에만 [사진]·[메모]를 내린다(선례: `directionsPoiIds`). 집합을 안 주면 완료 카드엔 버튼이 없다
// (낙관 id 완료 카드는 페이지가 집합에서 뺀다, 02a §2-2). 콜백은 누른 카드의 poiId 를 받고, 안내는
// `{ poiId, text }` 로 그 카드에만 선다(`directionsNotice` 선례). 관람 중 카드는 종전 그대로다.
//
// (개념) `new Set([...])` = 중복 없는 값 모음 — `has(x)` 로 들어 있는지 본다.
// 3동작: 준비(콜백·집합·안내) → 실행(완료 카드 버튼 누르기) → 단언(카드 안 testID·콜백 인자).

const GAMCHEON_KEY = `${DATE}#gamcheon`;
const GWANGALLI_KEY = `${DATE}#gwangalli`;
const doneId = (role: string, key: string) =>
  `execution-live-slot-done-${role}-${key}`;
const DONE_ANY = /^execution-live-slot-done-/;
const cardOf = (key: string) =>
  screen.getByTestId(`execution-live-slot-${key}`);

describe('LiveHubView · HD 방문 완료 카드 [사진]·[메모] (TRIP-1203)', () => {
  it('HD1 doneMediaPoiIds 에 든 완료 카드에만 [사진]·[메모]가 서고, 누르면 그 poiId 로 제 콜백을 부른다', () => {
    // 준비 — 감천만 방문 id 를 안다고 친다.
    const onPressPhoto = jest.fn();
    const onPressMemo = jest.fn();
    renderHub({
      onPressPhoto,
      onPressMemo,
      doneMediaPoiIds: new Set(['gamcheon']),
    });

    // 단언 — 감천 카드 안에 한 쌍, 광안리(집합 밖)·예정 카드엔 없다. 관람 중 고정 한 쌍은 그대로 1개.
    const gamcheon = within(cardOf(GAMCHEON_KEY));
    expect(
      gamcheon.getByTestId(doneId('photo', GAMCHEON_KEY))
    ).toHaveTextContent('사진');
    expect(
      gamcheon.getByTestId(doneId('memo', GAMCHEON_KEY))
    ).toHaveTextContent('메모');
    expect(screen.getAllByTestId(DONE_ANY)).toHaveLength(2);
    expect(
      within(cardOf(GWANGALLI_KEY)).queryAllByTestId(DONE_ANY)
    ).toHaveLength(0);
    expect(screen.getAllByTestId('execution-arrive-photo')).toHaveLength(1);
    expect(screen.getAllByTestId('execution-arrive-memo')).toHaveLength(1);

    // 실행·단언 — [사진] → 'gamcheon', [메모] → 'gamcheon'.
    fireEvent.press(screen.getByTestId(doneId('photo', GAMCHEON_KEY)));
    expect(onPressPhoto).toHaveBeenCalledTimes(1);
    expect(onPressPhoto).toHaveBeenLastCalledWith('gamcheon');
    expect(onPressMemo).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(doneId('memo', GAMCHEON_KEY)));
    expect(onPressMemo).toHaveBeenCalledTimes(1);
    expect(onPressMemo).toHaveBeenLastCalledWith('gamcheon');
  });

  it('HD2 doneMediaPoiIds 를 안 주면 완료 카드엔 버튼이 없고, 관람 중 고정 한 쌍만 있다', () => {
    renderHub({ onPressPhoto: jest.fn(), onPressMemo: jest.fn() });

    // 짝 앵커 — 카드 5장.
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.queryAllByTestId(DONE_ANY)).toHaveLength(0);
    expect(screen.getAllByTestId('execution-arrive-photo')).toHaveLength(1);
  });

  it('HD3 photoNotice 의 poiId 가 완료 카드면 그 카드 안에만 done 안내·[설정 열기]가 서고, 누르면 설정 콜백 1회', () => {
    // 준비
    const onPressPhotoSettings = jest.fn();
    renderHub({
      onPressPhoto: jest.fn(),
      onPressMemo: jest.fn(),
      doneMediaPoiIds: new Set(['gamcheon']),
      photoNotice: {
        poiId: 'gamcheon',
        text: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
      },
      onPressPhotoSettings,
    });

    // 단언 — 감천 카드 안에만, 관람 중 고정 안내는 없다.
    const gamcheon = within(cardOf(GAMCHEON_KEY));
    expect(
      gamcheon.getByTestId(doneId('photo-notice', GAMCHEON_KEY))
    ).toHaveTextContent('사진 접근 권한이 없어 사진을 불러올 수 없어요');
    expect(
      screen.getAllByTestId(/^execution-live-slot-done-photo-notice-/)
    ).toHaveLength(1);
    expect(screen.queryByTestId('execution-arrive-photo-notice')).toBeNull();
    expect(screen.queryByTestId('execution-arrive-photo-settings')).toBeNull();

    // 실행·단언
    fireEvent.press(
      gamcheon.getByTestId(doneId('photo-settings', GAMCHEON_KEY))
    );
    expect(onPressPhotoSettings).toHaveBeenCalledTimes(1);
  });

  it('HD4 memoNotice 의 poiId 가 완료 카드면 그 카드 안에만 done 메모 안내가 1개 선다', () => {
    renderHub({
      onPressMemo: jest.fn(),
      doneMediaPoiIds: new Set(['gamcheon', 'gwangalli']),
      memoNotice: { poiId: 'gwangalli', text: MEMO_NOTICE },
    });

    const notices = screen.getAllByTestId(
      /^execution-live-slot-done-memo-notice-/
    );
    expect(notices).toHaveLength(1);
    expect(
      within(cardOf(GWANGALLI_KEY)).getByTestId(
        doneId('memo-notice', GWANGALLI_KEY)
      )
    ).toHaveTextContent(MEMO_NOTICE);
    expect(screen.queryByTestId('execution-arrive-memo-notice')).toBeNull();
  });
});

// TRIP-1260 · i01 허브 일자 칩 줄. 허브는 오늘 일차로 열리므로 6일차 이후가 오늘이면 열자마자 선택 칩이
// 화면 밖이다 — 칩만 가로 스크롤 안에 두고, back 은 고정, 선택 칩은 위치가 오면 보이게 민다.
// FAB 하한은 overlay-row 의 onLayout(y + height)로 재므로 back·칩 줄이 계속 그 행 안이어야 한다.
// ⚠️ 칩이 실제로 잘리는지·밀리는지·행 높이가 그대로인지는 6-b.
describe('🔴 LiveHubView · 일자 칩 줄 가로 스크롤 (TRIP-1260)', () => {
  const SEVEN_DAYS = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-06-${String(10 + index).padStart(2, '0')}`,
  }));

  function hub(activeDayIndex: number) {
    return (
      <LiveHubView
        tripTitle="부산 여행"
        days={SEVEN_DAYS}
        activeDayIndex={activeDayIndex}
        slots={SLOTS}
        initialSnapIndex={2}
        onBack={jest.fn()}
        onSelectDay={jest.fn()}
        onPressManualEdit={jest.fn()}
      />
    );
  }

  it('선택을 6일차로 바꾸면 그 칩(x=400)이 보이게 0 < x ≤ 400 으로 scrollTo 한다 (AC-3)', () => {
    // 준비
    const view = render(hub(0));
    const chip = screen.getByTestId('execution-live-daychip-5');
    const scroll = closestScrollView(chip);
    expect(scroll).not.toBeNull();
    const scrollTo = stubScrollTo(scroll!);
    fireChipLayout(chip, 400);
    expect(scrollTo).not.toHaveBeenCalled();

    // 실행
    view.rerender(hub(5));

    // 단언
    expect(scrollTo).toHaveBeenCalled();
    const target = scrollTo.mock.lastCall?.[0] as { x: number };
    expect(target.x).toBeGreaterThan(0);
    expect(target.x).toBeLessThanOrEqual(400);
  });

  it('6일차가 오늘이라 6일차 선택으로 열리면, 그 칩 위치(x=400)가 올 때 0 < x ≤ 400 으로 scrollTo 한다 (AC-3b)', () => {
    // 준비 — 열 때부터 6일차 선택
    render(hub(5));
    const chip = screen.getByTestId('execution-live-daychip-5');
    const scroll = closestScrollView(chip);
    expect(scroll).not.toBeNull();
    const scrollTo = stubScrollTo(scroll!);

    // 실행 — 선택 칩의 위치가 도착한다
    fireChipLayout(chip, 400);

    // 단언
    expect(scrollTo).toHaveBeenCalled();
    const target = scrollTo.mock.lastCall?.[0] as { x: number };
    expect(target.x).toBeGreaterThan(0);
    expect(target.x).toBeLessThanOrEqual(400);
  });
});

/* ──── TRIP-1416 · 허브 지도도 "시트가 안 가린 띠"에 그날 핀을 맞춘다 (Q-088) ────
 * 지금 허브는 첫 핀을 화면 한가운데에 두는 고정 줌 카메라라, 55% 시트 윗변 바로 아래에 첫 핀만 걸리고
 * 나머지는 시트 뒤로 숨는다. 셸의 핀 맞춤(`fitPins`)을 켜면 셸이 스냅 배열의 '55%' 를 아래 가림으로 삼아
 * 맞춘다(Seed Q4 — 펼침으로 진입해도 55% 기준).
 *
 * 무엇을 보장하나:
 *  - 🔴 HB1 (AC-4) region 으로 열리고 camera 는 없다 · 5핀이 아래 55% 위 · 오버레이 줄(8+40) 아래 · 상자가 세로로 꽉 참.
 *  - 🔴 HB2 (AC-4·Q4) 펼침(2) 진입도 중간(1) 진입과 같은 맞춤.
 *  - 🔴 HB3 (AC-10) 알약 숨김(지도 탭)·시트 칸 이동으로 다시 그려져도 region 은 처음 그 객체(카메라가 안 튄다).
 * ⚠️ 실제 화면 맞춤·펼침 시트 위 104pt 띠는 jest 사각 → 6-b(AC-11).
 *
 * 3동작 뼈대: 준비=키 + 5곳 픽스처 → 실행=렌더·지도 탭·시트 onChange → 단언=map-native region.
 */

const HUB_WINDOW = Dimensions.get('window');
// 허브 오버레이 줄 바닥 = 셸 pt-sm 8 + 뒤로 버튼 40(02a ★6).
const HUB_OVERLAY_ROW_BOTTOM = 8 + 40;
const HUB_PINS = SLOTS.map(({ slot }) => ({
  lat: slot.lat as number,
  lng: slot.lng as number,
}));

function hubRegion(): NativeRegion | undefined {
  return screen.getByTestId('map-native').props.region as
    NativeRegion | undefined;
}

describe('LiveHubView · 지도 핀 맞춤 (AC-4·AC-10 · Q-088)', () => {
  // TRIP-1416
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

  it('HB1 그날 5핀이 아래 55% 위·오버레이 줄 아래 띠에 들고 상자가 세로로 꽉 찬다 — 첫 핀 중심 고정 줌 camera 가 아니다', () => {
    renderHub({ initialSnapIndex: 1 });

    expect(screen.getByTestId('map-native').props.camera).toBeUndefined();
    expectPinsInBand(hubRegion(), HUB_PINS, {
      bottom: 0.55,
      topPx: HUB_OVERLAY_ROW_BOTTOM,
      screenHeight: HUB_WINDOW.height,
    });
    expectHeightLimited(
      hubRegion(),
      HUB_PINS,
      HUB_WINDOW.height / HUB_WINDOW.width
    );
  });

  it('HB2 펼침(2)으로 진입해도 중간(1) 진입과 같은 맞춤이다 (재계획 적용 직후)', () => {
    renderHub({ initialSnapIndex: 1 });
    const atHalf = hubRegion();
    expect(atHalf).toBeDefined();
    screen.unmount();

    renderHub({ initialSnapIndex: 2 });

    expect(hubRegion()).toEqual(atHalf);
  });

  it('HB3 (금지) 알약 숨김(지도 탭)·시트 칸 이동으로 다시 그려져도 region 은 처음 그 객체다', () => {
    // 준비 — 알약이 있는 허브. 앵커: region 이 있다(지금 camera 모드면 여기서 red).
    renderWithPill({ initialSnapIndex: 1 });
    const first = hubRegion();
    expect(first).toBeDefined();

    // 실행 ① — 지도 탭 → 알약 로컬 숨김(허브 상태가 바뀌어 다시 그려진다, 핀 좌표는 그대로).
    fireMapTap();
    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();

    // 단언 ①
    expect(hubRegion()).toBe(first);

    // 실행 ② — 시트가 닫힘(0)에 멈춤.
    const onChange = sheetHost().props.onChange as
      ((index: number, position: number, type: number) => void) | undefined;
    expect(onChange).toBeDefined();
    act(() => onChange?.(0, 0, 0));

    // 단언 ②
    expect(hubRegion()).toBe(first);
  });
});
