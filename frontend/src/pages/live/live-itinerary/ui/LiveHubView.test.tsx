import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot';
import type { Opportunity } from '@/shared/api/index.schemas';
import { useAnimatedProbe } from '@/test-support/animatedProbe';
import {
  BAR_ROOT,
  FINAL_IDS,
  flushOsAnswer,
  holdReduceMotionOn,
  lastSample,
  moved,
  scheduleVisibleCenter,
  setWindowWidth,
  START5_IDS,
  START_CELLS,
  START_HOME,
  START_RECORDS,
  structureSteady,
  useInteractionGate,
  visibleIds,
  watchMotion,
} from '@/test-support/barMotionProbe';
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

import {
  BAR_ENTER_DELAY_MS,
  BAR_EXIT_MS,
  barMorphFrame,
} from '../model/barMorph';
import {
  LIVE_BAR_SIDE,
  LIVE_BOTTOM_BAR_RESERVE,
} from '../model/editPopupLayout';
import { getToastBottoms, resetToastBottoms } from '@/shared/ui/toastBottom';
import { LiveHubView, type LiveHubSlot } from './LiveHubView';

/**
 * TRIP-746 · AC-1·AC-2·AC-4 · Seed Q1·Q2 — i01 여행중 허브 **순수 뷰**(pages · api import 0).
 *
 * 무엇을 보장하나:
 *  - 골격: 전면 지도(셸) 위 일자 칩 줄, 시트 헤더 한 줄 "부산 여행 · 2일차 · 6월 11일(목) · 5곳", 카드 5장,
 *    화면 아래 내비 바(둥근 뒤로 + 일정·수정·챗봇·행사 4칸 — TRIP-1522 v2, HN·HE·HF·HS·HC 묶음).
 *  - 부재: 탭바·세그먼트·방패 FAB·옛 헤더·지도 세그먼트·다음 길찾기·레일 시각 열. 수동 [도착]은
 *    `onPressArrive` 를 받고 진행 중 슬롯이 없을 때만 예정 카드에 선다(TRIP-1021 HV9).
 *  - 배선: 뒤로·칩·[방문 완료] 가 콜백으로 이어진다. [사진]/[메모]는 페이지가 콜백을 줄 때만 관람 중
 *    카드에 서고 각자 제 콜백을 부른다(TRIP-1070). 안 주면 없다(TRIP-939 AC-6).
 *  - TRIP-1522 하단 내비 바: 일정이 기본 활성, 수정 칸은 이동 없이 칸 위 팝업을 열고(항목이 이동), 행사 칸은 기회가 있을 때만 활성+점이며 누르면 바 위
 *    카드가 열린다. 팝업·카드는 `floating` 하나라 동시에 안 열리고, 층은 명시 열거 경로로만 닫힌다(시트 완전 내림 포함 — 펼침에서 곧장 −1 도).
 *    시트는 `['55%', 펼침px]` 두 칸 + 끌어내려 완전 닫힘(−1)이고 시트가 내려가도 바는 똑같다. 일정 칸은 시트가 내려가 있을 때만 중간 칸(0)을 요청한다.
 *  - TRIP-748 트리거 표면: 알약은 시트가 아니라 지도 위(일자 칩 아래)에 서고, 영향 카드는 배지로
 *    표시되며, 카드 아래 배너 슬롯은 없다. 알약은 시트 스크롤·끌기·지도 탭·다른 버튼으로 로컬 숨김(D3) —
 *    어느 바 칸도 알약을 숨기지 않는다(TRIP-1522 Q-D).
 *
 * ⚠️ 원리적 사각(02a ★5): 스냅별로 무엇이 보이는지는 통과형 시트 목이 못 본다(5카드는 늘 렌더) —
 *   넘긴 index·snapPoints 까지만 잠근다. 실전환·바와 시트의 겹침·핸들 모양·카드 터치는 6-b.
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
    onPressChatbot: jest.fn(),
    onPressComplete: jest.fn(),
  };
  render(
    <LiveHubView
      tripTitle="부산 여행"
      days={DAYS}
      activeDayIndex={1}
      slots={SLOTS}
      initialSnapIndex={1}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

// ── TRIP-1522 · 하단 내비 바 공용 이름 ─────────────────────────────────────────
const BAR = 'execution-live-bottom-bar';
const BAR_BACK = 'execution-live-back';
const BAR_EVENT = 'execution-live-bar-event';
const BAR_DOT = 'execution-live-bar-event-dot';
const BAR_CHATBOT = 'execution-live-bar-chatbot';
// v2 — 칸은 [일정·수정·챗봇·행사]. v1 의 직접 수정·AI 수정 칸은 수정 팝업 항목이 됐다(아래 HN 묶음의 POPUP_* 상수).
const BAR_EDIT = 'execution-live-bar-edit';
const BAR_ALL = [
  BAR,
  BAR_BACK,
  'execution-live-bar-schedule',
  BAR_EDIT,
  BAR_CHATBOT,
  BAR_EVENT,
];
const OP_CARD = 'execution-live-opportunity-card';

describe('LiveHubView · HV1 골격 (AC-1)', () => {
  it('지도 셸 위에 일자 칩 3개(2일차 선택)·헤더 한 줄·카드 5장·하단 내비 바(뒤로 포함)가 선다', () => {
    renderHub();

    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-live-bottom-bar')).toBeOnTheScreen();
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
  });
});

describe('LiveHubView · HV2 부재 (AC-2)', () => {
  it('탭바·세그먼트·방패 FAB·옛 헤더·지도 세그먼트·수동 [도착](미주입)·다음 길찾기·레일 시각이 없다', () => {
    renderHub();

    // 짝 앵커 — 카드 5장과 새 바가 실제로 있다(빈 렌더 공허 통과 차단, 02a ★1).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    expect(screen.getByTestId('execution-live-bottom-bar')).toBeOnTheScreen();

    const gone = [
      // TRIP-1522 — 바로 합쳐져 걷힌 것: 수정 FAB·알약 메뉴·시트 윗변 추종 앵커.
      'execution-live-replan-fab',
      'execution-live-fab-anchor',
      'execution-live-edit-pill-ai',
      'execution-live-edit-pill-manual',
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
  // TRIP-1522: 바 칸(챗봇·직접 수정·AI 수정)의 배선은 아래 HN 묶음이 잠근다.
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

  it('지도에 5슬롯 핀을 그린다', () => {
    renderHub();

    [1, 2, 3, 4, 5].forEach((n) =>
      expect(screen.getByTestId(`map-marker-pin-${n}`)).toBeOnTheScreen()
    );
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
  ['시트 끌기 onAnimate(0→1) — 중간→펼침', () => fireSheetAnimate(0, 1)],
  ['시트 내림 onAnimate(0→-1) — 중간→완전 내림', () => fireSheetAnimate(0, -1)],
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
    ['마운트 애니메이션 onAnimate(-1→0)', -1, 0],
    ['제자리 onAnimate(1→1)', 1, 1],
  ])('HT4 %s 에는 알약이 남는다 (마운트 가드 · 02a ★2)', (_name, from, to) => {
    renderWithPill();

    fireSheetAnimate(from, to);

    expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
  });

  // 펼침(1)에선 시트가 알약을 덮는다 — 거기서 내려오는 끌기는 알약을 처음 드러내는 동작이라
  // 숨기면 한 번도 안 보인 채 사라진다(5-b 경고-2 · 오케 결정 (나)). v2 는 칸이 둘(0 중간·1 펼침)이라 내려오는 전이는 하나다.
  it.each([['펼침→중간 onAnimate(1→0)', 1, 0]])(
    'HT4c %s 에는 알약이 남는다 (펼침에서 내려오는 전이)',
    (_name, from, to) => {
      renderWithPill();

      fireSheetAnimate(from, to);

      expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
    }
  );

  it('HT4d 예외는 "펼침에서 출발"뿐이다 — 중간→완전 내림 onAnimate(0→-1)은 여전히 숨긴다', () => {
    renderWithPill();

    fireSheetAnimate(0, -1);

    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
  });

  it('HT4b 알약 자기 자신을 누르면 숨기지 않고 목적지 콜백만 1회 부른다', () => {
    const { onPressPill } = renderWithPill();

    fireEvent.press(screen.getByTestId(TRIGGER_PILL));

    expect(onPressPill).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
  });

  it('HT7 숨김은 트리거 키에 묶인다 — 같은 키로 다시 그려도 숨긴 채, 새 키가 오면 다시 보인다', () => {
    const base = {
      tripTitle: '부산 여행',
      days: DAYS,
      activeDayIndex: 1,
      slots: SLOTS,
      initialSnapIndex: 1,
      onBack: jest.fn(),
      onSelectDay: jest.fn(),
      onPressAiReplan: jest.fn(),
      onPressManualEdit: jest.fn(),
      onPressChatbot: jest.fn(),
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

// ── TRIP-1522 하단 내비 바 · 수정 팝업 · 행사 카드 · 시트 내림 (HN·HE·HF·HS·HC) ───────────────────────────────────────
// 바는 props 만 받는 순수 컴포넌트(LiveBottomBar.test)이고, 이 뷰가 쥐는 것은 떠 있는 층 하나(`floating`)와 시트가 내려갔는가(`sheetClosed`).
// ⚠️ 공허 통과 주의: 카드·팝업은 기본 닫힘이라 "없음"만으로는 안 열었어도 통과한다 — 닫힘 단언은 늘 "열었다(긍정 앵커) → 사건 → 닫힘 + 기회/칸은
//    살아 있음" 쌍이고, 시트 −1 은 −1 직전에 열어 둔 상태에서 단언한다. 통과형 시트 목은 onAnimate 를 스스로 쏘지 않아 fireSheetAnimate 로 직접 부른다.

const SCHEDULE = 'execution-live-bar-schedule';
const POPUP_ANCHOR = 'execution-live-edit-popup-anchor';
const POPUP = 'execution-live-edit-popup';
const POPUP_AI = 'execution-live-edit-popup-ai';
const POPUP_MANUAL = 'execution-live-edit-popup-manual';

/** 목 시트의 snapToIndex 스파이(셸의 snapRequest 효과가 sheetRef.snapToIndex 를 부르면 기록된다). 전역이라 파일 최상위에서 비운다. */
const snapSpy = () =>
  (globalThis as Record<string, unknown>)
    .__bottomSheetSnapToIndexSpy as jest.Mock;
beforeEach(() => snapSpy().mockClear());
// OS "동작 줄이기" 답을 true 로 고정 — 모프와 무관한 케이스가 모션 타이머·act 경고 없이 돈다(모프 케이스만 바꾼다).
beforeEach(holdReduceMotionOn);

const VENUE: Opportunity = {
  key: 'event:부산 불꽃축제',
  kind: 'EVENT_VENUE',
  eventName: '부산 불꽃축제',
  start: '2026-06-10',
  end: '2026-06-14',
  poiId: 'poi-venue',
  poiName: '광안리 해변',
  nearSlotKey: `${DATE}#museum`,
  distanceLabel: '약 400m',
};

function mkOpp(item: Opportunity = VENUE) {
  return { item, onPressReplan: jest.fn(), onDismiss: jest.fn() };
}

/** 숨은(낭독 제외) 요소까지 포함해 점을 찾는다 — 점은 장식이라 기본 쿼리에 안 잡힌다(02a ★5). */
const dotOf = () =>
  screen.queryByTestId(BAR_DOT, { includeHiddenElements: true });

/** 일정만 활성(selected) — 떠 있는 층이 없을 때의 바(Figma A). */
function expectScheduleActive(): void {
  expect(screen.getByTestId(SCHEDULE)).toBeSelected();
  expect(screen.getByTestId(BAR_EDIT)).not.toBeSelected();
  expect(screen.getByTestId(BAR_EVENT)).not.toBeSelected();
}

/** "기회 없음" 얼굴: 바는 있고 행사 칸만 비활성 + 점 없음. */
function expectEventIdle(): void {
  expect(screen.getByTestId(BAR)).toBeOnTheScreen();
  expect(screen.getByTestId(BAR_EVENT)).toBeDisabled();
  expect(dotOf()).toBeNull();
  expect(screen.queryByTestId(OP_CARD)).toBeNull();
}

/** "기회는 있고 카드만 닫힘" 얼굴 — 부모가 데이터를 지워서가 아니라 뷰가 닫았다는 증거. 일정이 다시 활성이다. */
function expectEventReadyClosed(): void {
  expect(screen.getByTestId(BAR_EVENT)).toBeEnabled();
  expect(dotOf()).not.toBeNull();
  expect(screen.queryByTestId(OP_CARD)).toBeNull();
  expectScheduleActive();
}

/** "팝업만 닫힘" 얼굴 — 바는 그대로고 수정 칸도 살아 있으며 일정이 다시 활성이다. */
function expectPopupClosedAlive(): void {
  expect(screen.queryByTestId(POPUP)).toBeNull();
  expect(screen.getByTestId(BAR)).toBeOnTheScreen();
  expect(screen.getByTestId(BAR_EDIT)).toBeEnabled();
  expectScheduleActive();
}

/** 행사 칸을 눌러 카드를 연다 — 열렸는지 그 자리에서 확인한다. */
function openCard(): void {
  fireEvent.press(screen.getByTestId(BAR_EVENT));
  expect(screen.getByTestId(OP_CARD)).toBeOnTheScreen();
}

/** 수정 칸을 눌러 팝업을 연다 — 열렸는지 그 자리에서 확인한다. */
function openPopup(): void {
  fireEvent.press(screen.getByTestId(BAR_EDIT));
  expect(screen.getByTestId(POPUP)).toBeOnTheScreen();
}

/** 떠 있는 층 두 가지를 같은 표로 시험한다(`it.each` 입력). */
const FLOATERS = [
  {
    name: '행사 카드',
    open: openCard,
    isOpen: () => screen.queryByTestId(OP_CARD) !== null,
    expectClosed: expectEventReadyClosed,
  },
  {
    name: '수정 팝업',
    open: openPopup,
    isOpen: () => screen.queryByTestId(POPUP) !== null,
    expectClosed: expectPopupClosedAlive,
  },
] as const;

/**
 * 떠 있는 층(팝업·카드)을 닫는 명시 열거 경로 — 알약 숨김 경로(`HIDE_PATHS`)에 **시트 완전 내림**이 더해진다.
 * `(1→-1)` 은 펼침에서 곧장 끝까지 내리는 빠른 끌기다: 기존 숨김 가드(펼침 출발이면 건너뜀)에 걸려 안 닫힐 수 있어
 * (02a ★2) 따로 둔다.
 */
const FLOATING_CLOSE_PATHS: [string, () => void][] = [
  ['시트 본문 스크롤 시작', fireSheetScrollBeginDrag],
  ['시트 칸 이동 onAnimate(0→1)', () => fireSheetAnimate(0, 1)],
  ['시트 완전 내림 onAnimate(0→-1) — 중간에서', () => fireSheetAnimate(0, -1)],
  [
    '시트 완전 내림 onAnimate(1→-1) — 펼침에서 곧장',
    () => fireSheetAnimate(1, -1),
  ],
  ['지도 탭', fireMapTap],
  [
    '일자 칩',
    () => fireEvent.press(screen.getByTestId('execution-live-daychip-2')),
  ],
  [
    '[방문 완료]',
    () => fireEvent.press(screen.getByTestId('execution-arrive-complete')),
  ],
];

/** (층 × 경로) 전부 — it.each 입력. */
const FLOATER_X_PATH = FLOATERS.flatMap((floater) =>
  FLOATING_CLOSE_PATHS.map(
    ([pathName, fire]) => [floater.name, pathName, floater, fire] as const
  )
);

/** rerender 로 prop 만 바꿔 가며 쓰는 완전한 props 한 벌(콜백은 한 번 만들어 계속 같은 것). */
function hubProps(
  overrides: Overrides = {}
): Parameters<typeof LiveHubView>[0] {
  return {
    tripTitle: '부산 여행',
    days: DAYS,
    activeDayIndex: 1,
    slots: SLOTS,
    initialSnapIndex: 1,
    onBack: jest.fn(),
    onSelectDay: jest.fn(),
    onPressAiReplan: jest.fn(),
    onPressManualEdit: jest.fn(),
    onPressChatbot: jest.fn(),
    onPressComplete: jest.fn(),
    ...overrides,
  };
}

describe('LiveHubView · HN 하단 내비 바 구성·배선 (TRIP-1522 v2 AC-1·2)', () => {
  it('HN1 뒤로와 4칸은 하단 바 안에 있고(일정이 활성), 상단 줄에는 뒤로 없이 일차 칩만 남는다', () => {
    renderHub();

    const bar = screen.getByTestId(BAR);
    [BAR_BACK, SCHEDULE, BAR_EDIT, BAR_CHATBOT, BAR_EVENT].forEach((testID) =>
      expect(within(bar).getByTestId(testID)).toBeOnTheScreen()
    );
    expectScheduleActive();
    const row = screen.getByTestId('execution-live-overlay-row');
    expect(within(row).queryByTestId(BAR_BACK)).toBeNull();
    [0, 1, 2].forEach((index) =>
      expect(
        within(row).getByTestId(`execution-live-daychip-${index}`)
      ).toBeOnTheScreen()
    );
    // v1 의 칸(직접 수정·AI 수정)·FAB·알약 메뉴는 없다 — 짝 앵커: 새 바와 카드 5장은 있다.
    [
      'execution-live-bar-manual',
      'execution-live-bar-ai',
      'execution-live-replan-fab',
    ].forEach((testID) => expect(screen.queryByTestId(testID)).toBeNull());
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
  });

  it.each([
    ['뒤로', 'onBack', BAR_BACK],
    ['챗봇', 'onPressChatbot', BAR_CHATBOT],
  ] as const)('HN2 %s 를 누르면 %s 만 1회 불린다', (_label, own, testID) => {
    const handlers = renderHub();

    fireEvent.press(screen.getByTestId(testID));

    expect(handlers[own]).toHaveBeenCalledTimes(1);
    Object.entries(handlers)
      .filter(([name]) => name !== own)
      .forEach(([, fn]) => expect(fn).not.toHaveBeenCalled());
  });
});

describe('LiveHubView · HE 수정 칸 · 팝업 (TRIP-1522 v2 AC-3·4·5·12)', () => {
  it('HE1 수정 칸을 누르면 팝업이 서고 수정이 활성·일정이 비활성이며, 이동 콜백은 안 불린다 — 다시 누르면 닫힌다', () => {
    const handlers = renderHub();
    // 처음엔 닫힘 — 긍정 앵커: 수정 칸은 살아 있고 일정이 활성이다.
    expectPopupClosedAlive();

    fireEvent.press(screen.getByTestId(BAR_EDIT));

    expect(screen.getByTestId(POPUP)).toBeOnTheScreen();
    const edit = screen.getByTestId(BAR_EDIT);
    expect(edit).toBeSelected();
    expect(edit).toBeExpanded();
    expect(screen.getByTestId(SCHEDULE)).not.toBeSelected();
    // 수정 칸 자체는 이동하지 않는다 — 어떤 콜백도 0회.
    Object.values(handlers).forEach(
      (fn) => fn !== undefined && expect(fn).not.toHaveBeenCalled()
    );

    fireEvent.press(screen.getByTestId(BAR_EDIT));
    expectPopupClosedAlive();
  });

  it.each([
    ['AI에게 맡기기', 'onPressAiReplan', POPUP_AI],
    ['직접 수정', 'onPressManualEdit', POPUP_MANUAL],
  ] as const)(
    'HE2 팝업의 %s 항목은 %s 만 1회 부르고 팝업을 닫는다',
    (_label, own, testID) => {
      const handlers = renderHub();
      openPopup();

      fireEvent.press(screen.getByTestId(testID));

      expect(handlers[own]).toHaveBeenCalledTimes(1);
      ['onPressAiReplan', 'onPressManualEdit', 'onPressChatbot', 'onBack']
        .filter((name) => name !== own)
        .forEach((name) =>
          expect(handlers[name as keyof typeof handlers]).not.toHaveBeenCalled()
        );
      // 부모는 아무것도 안 바꿨는데 닫혀 있다 — 뷰가 스스로 닫았다.
      expectPopupClosedAlive();
    }
  );

  it('HE3 onPressAiReplan 이 없으면(지난 날·시작 전) 팝업의 AI 항목은 비활성 — 눌러도 아무 일 없고 직접 수정은 산다', () => {
    const handlers = renderHub({ onPressAiReplan: undefined });
    openPopup();

    const ai = screen.getByTestId(POPUP_AI);
    expect(ai).toBeDisabled();
    fireEvent.press(ai); // 상태(disabled)만으로는 눌림이 안 막힌다 — 효과 0도 본다
    Object.values(handlers).forEach(
      (fn) => fn !== undefined && expect(fn).not.toHaveBeenCalled()
    );
    expect(screen.getByTestId(POPUP)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(POPUP_MANUAL));
    expect(handlers.onPressManualEdit).toHaveBeenCalledTimes(1);
  });

  it('HE4 팝업은 앵커에 붙고, 앵커의 left·width 는 editPopupPlacement 결과와 같으며 아랫변(bottom)은 안전영역(34)을 더하지 않은 78 이다', async () => {
    // 동적 import — 함수 모듈이 바뀌어도 이 케이스만 red 가 되게 한다(정적 import 면 파일 전체가 안 돈다).
    const { editPopupPlacement } = await import('../model/editPopupLayout');
    render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, bottom: 34, left: 0, right: 0 }}
      >
        <LiveHubView {...hubProps()} />
      </SafeAreaInsetsContext.Provider>
    );
    openPopup();

    const anchor = screen.getByTestId(POPUP_ANCHOR);
    const style = StyleSheet.flatten(anchor.props.style);
    expect(typeof style.width).toBe('number');
    const placement = editPopupPlacement({
      windowWidth: Dimensions.get('window').width,
      popupWidth: style.width as number,
    });
    expect(style.left).toBeCloseTo(placement.left, 6);
    expect(style.bottom).toBe(78); // Figma: 바 윗변(바닥 12 + 높이 58 = 70) − 8. 안전영역을 더하면 112
    expect(within(anchor).getByTestId(POPUP)).toBeOnTheScreen();
  });

  it('HE5 팝업과 행사 카드는 동시에 열리지 않는다 — 서로 열면 상대가 닫히고 활성 칸이 따라간다', () => {
    renderHub({ opportunity: mkOpp() });
    openPopup();

    openCard();
    expect(screen.queryByTestId(POPUP)).toBeNull();
    expect(screen.getByTestId(BAR_EVENT)).toBeSelected();
    expect(screen.getByTestId(BAR_EVENT)).toBeExpanded();
    expect(screen.getByTestId(BAR_EDIT)).not.toBeSelected();
    expect(screen.getByTestId(SCHEDULE)).not.toBeSelected();

    openPopup();
    expect(screen.queryByTestId(OP_CARD)).toBeNull();
    expect(screen.getByTestId(BAR_EDIT)).toBeSelected();
    expect(screen.getByTestId(BAR_EVENT)).not.toBeSelected();
    expect(screen.getByTestId(SCHEDULE)).not.toBeSelected();
  });
});

describe('LiveHubView · HN 행사 칸 상태 · 카드 열고 닫기 (TRIP-1522 AC-11)', () => {
  it('HN5 기회가 있으면 활성 + 점, 없으면(undefined·null) 비활성 + 점 없음 — 눌러도 카드가 안 선다', () => {
    renderHub({ opportunity: mkOpp() });
    expectEventReadyClosed();
    screen.unmount();

    for (const none of [undefined, null]) {
      renderHub({ opportunity: none });
      expectEventIdle();
      fireEvent.press(screen.getByTestId(BAR_EVENT));
      expectEventIdle();
      screen.unmount();
    }
  });

  it('HN6 기본은 닫힘 → 행사 칸을 누르면 바 위 카드가 서고 행사가 활성, 다시 누르면 닫힌다', () => {
    renderHub({ opportunity: mkOpp() });
    expectEventReadyClosed();

    fireEvent.press(screen.getByTestId(BAR_EVENT));

    expect(screen.getByTestId(OP_CARD)).toBeOnTheScreen();
    // Q-7·Q-9 — 카드가 열리면 행사 칸이 활성, 일정은 비활성.
    expect(screen.getByTestId(BAR_EVENT)).toBeSelected();
    expect(screen.getByTestId(BAR_EVENT)).toBeExpanded();
    expect(screen.getByTestId(SCHEDULE)).not.toBeSelected();

    fireEvent.press(screen.getByTestId(BAR_EVENT));
    expectEventReadyClosed();
  });

  it('HN7 [넣어서 다시 짜기]는 onPressReplan 만, ×는 onDismiss 만 1회 부르고 둘 다 카드를 닫는다', () => {
    const cta = mkOpp();
    renderHub({ opportunity: cta });
    openCard();

    fireEvent.press(screen.getByTestId('execution-live-opportunity-cta'));

    expect(cta.onPressReplan).toHaveBeenCalledTimes(1);
    expect(cta.onDismiss).not.toHaveBeenCalled();
    // 부모가 기회를 지우지 않았는데도 닫혀 있다 — 뷰가 스스로 닫았다.
    expectEventReadyClosed();
    screen.unmount();

    const dismiss = mkOpp();
    renderHub({ opportunity: dismiss });
    openCard();

    fireEvent.press(screen.getByTestId('execution-live-opportunity-dismiss'));

    expect(dismiss.onDismiss).toHaveBeenCalledTimes(1);
    expect(dismiss.onPressReplan).not.toHaveBeenCalled();
    expectEventReadyClosed();
  });
});

describe('LiveHubView · HF 떠 있는 층(수정 팝업·행사 카드)의 닫힘 사건 (TRIP-1522 v2 AC-8·10·12)', () => {
  // 지도 탭 경로는 map-native 가 떠야 한다 — 선언과 대입 분리(HT 선례).
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

  it.each(FLOATER_X_PATH)(
    'HF1 %s 이 열린 채 %s → 닫힌다(바·칸은 그대로, 일정이 다시 활성)',
    (_floater, _path, floater, fire) => {
      renderHub({ opportunity: mkOpp() });
      floater.open();
      expect(floater.isOpen()).toBe(true);

      fire();

      floater.expectClosed();
    }
  );

  it.each(FLOATERS)(
    'HF2 $name 이 열린 채 일정·챗봇 칸을 누르면 그 칸 동작이 일어나고 닫힌다',
    (floater) => {
      // 일정 칸 — 시트가 올라와 있어(기본) 시트 요청(snapToIndex) 없이 열린 층만 닫는다.
      const first = renderHub({ opportunity: mkOpp() });
      floater.open();
      fireEvent.press(screen.getByTestId(SCHEDULE));
      floater.expectClosed();
      expect(snapSpy()).not.toHaveBeenCalled();
      expect(first.onPressChatbot).not.toHaveBeenCalled();
      screen.unmount();

      // 챗봇 칸 — 이동 콜백 1회 + 닫힘.
      const second = renderHub({ opportunity: mkOpp() });
      floater.open();
      fireEvent.press(screen.getByTestId(BAR_CHATBOT));
      expect(second.onPressChatbot).toHaveBeenCalledTimes(1);
      floater.expectClosed();
    }
  );

  it.each(FLOATERS)(
    'HF3 $name 은 마운트 애니메이션(-1→0)·제자리(1→1)·펼침→중간(1→0) 전이에는 열린 채 남는다 (알약 숨김과 같은 가드)',
    (floater) => {
      for (const [from, to] of [
        [-1, 0],
        [1, 1],
        [1, 0],
      ] as const) {
        renderHub({ opportunity: mkOpp() });
        floater.open();

        fireSheetAnimate(from, to);

        expect(floater.isOpen()).toBe(true);
        screen.unmount();
      }
    }
  );

  it.each(FLOATERS)(
    'HF4 $name 이 열린 채 바가 숨었다 돌아와도 저절로 다시 열리지 않는다 — 숨는 동안 층도 없다',
    (floater) => {
      const base = hubProps({ opportunity: mkOpp() });
      const view = render(<LiveHubView {...base} />);
      floater.open();

      view.rerender(<LiveHubView {...base} barHidden />);
      BAR_ALL.forEach((testID) =>
        expect(screen.queryByTestId(testID)).toBeNull()
      );
      expect(floater.isOpen()).toBe(false);

      view.rerender(<LiveHubView {...base} barHidden={false} />);
      BAR_ALL.forEach((testID) =>
        expect(screen.getByTestId(testID)).toBeOnTheScreen()
      );
      floater.expectClosed();
    }
  );

  // 전면 백드롭 가드(Q-4): 층은 명시 열거 경로로만 닫힌다 — 투명 전면 Pressable 이 있으면 아래 컨트롤 누름을 먹거나(누름이 막힘) 층을 과잉으로 닫는다.
  // 열린 채 "열거 밖 onPress 노드"(뒤로·이름·[사진]·[메모] …)를 하나씩 눌러 층이 남는지 본다.
  it.each(FLOATERS)(
    'HF5 열거 밖 컨트롤(뒤로·이름 진입·[사진]·[메모] …)을 눌러도 $name 은 닫히지 않는다 — 전면 백드롭 가드',
    (floater) => {
      const LISTED =
        /^execution-live-(bar-(schedule|edit|chatbot|event)|edit-popup-(ai|manual)|opportunity-(cta|dismiss)|daychip-\d+)$|^execution-arrive-complete$/;
      const listed = (node: ReactTestInstance) =>
        typeof node.props?.testID === 'string' &&
        LISTED.test(node.props.testID);
      const renderOpen = () => {
        renderHub({
          opportunity: mkOpp(),
          onPressSlotName: jest.fn(),
          onPressPhoto: jest.fn(),
          onPressMemo: jest.fn(),
        });
        floater.open();
      };
      // onPress 를 가진 노드 중 자기·조상·자손 어디에도 열거된 컨트롤이 없는 것(감싸개 합성 포함).
      const unlisted = () =>
        screen.root.findAll((node) => {
          if (typeof node.props?.onPress !== 'function') return false;
          for (let up: ReactTestInstance | null = node; up; up = up.parent)
            if (listed(up)) return false;
          return node.findAll(listed).length === 0;
        });

      renderOpen();
      const total = unlisted().length;
      expect(total).toBeGreaterThanOrEqual(3); // 짝 앵커 — 빈 목록 공허 통과 차단

      const closedBy: string[] = [];
      for (let i = 0; i < total; i += 1) {
        screen.unmount(); // 매번 새로 그려 i번째만 누른다 — 앞 press 의 부작용이 섞이지 않게
        renderOpen();
        const target = unlisted()[i];
        const label = `testID=${String(target.props.testID)} className=${String(target.props.className)}`;
        fireEvent.press(target);
        if (!floater.isOpen()) closedBy.push(label);
      }

      expect(closedBy).toEqual([]);
    }
  );

  // 5-b 후 보강(03b 경고-1) — "기회가 바뀜"도 닫힘 사건이다. 같은 날짜 안에서 기회 항목의 key 가 바뀌거나(날씨 위험으로
  // 행사 A → 요즘 인기 B) 사라졌다가(null) 원래 key A 로 돌아와도, 사용자가 안 눌렀다면 카드는 저절로 다시 열리지 않는다.
  // (날짜 왕복은 HN10, 여기는 같은 날짜의 key 왕복.) v2: 카드가 사라진 순간 일정이 다시 활성이어야 한다(층 상태도 비워짐).
  it.each([
    ['다른 key(요즘 인기)로 바뀌었다가', 'other'],
    ['사라졌다(null)가', 'none'],
  ] as const)(
    'HN10c 카드가 열린 채 기회가 %s 원래 key 로 돌아와도 카드는 저절로 다시 열리지 않는다',
    (_label, middle) => {
      const trending: Opportunity = {
        ...VENUE,
        key: 'trending:해동용궁사',
        kind: 'TRENDING',
        eventName: null,
        start: null,
        end: null,
        poiId: 'poi-trend',
        poiName: '해동용궁사',
      };
      const base = hubProps();
      const view = render(<LiveHubView {...base} opportunity={mkOpp()} />);
      openCard();

      // 실행 ① — 기회가 바뀐다(같은 날짜). 열려 있던 카드는 사라지고, 새 기회가 있으면 칸은 켜진 채 닫혀 있다.
      view.rerender(
        <LiveHubView
          {...base}
          opportunity={middle === 'other' ? mkOpp(trending) : null}
        />
      );
      expect(screen.queryByTestId(OP_CARD)).toBeNull();
      if (middle === 'other') expectEventReadyClosed();
      else expectEventIdle();
      // 층 상태도 비워져 일정이 활성이다(카드만 숨기고 상태를 남기면 행사 칸이 분홍인 채 남는다).
      expectScheduleActive();

      // 실행 ② — 원래 key 가 돌아온다(위험이 풀림). 아무도 안 눌렀으니 닫혀 있어야 한다.
      view.rerender(<LiveHubView {...base} opportunity={mkOpp()} />);

      expectEventReadyClosed();
    }
  );

  it('HN10d (과잉 닫힘 방지 짝) 같은 key 의 새 기회 객체가 와도(재조회) 열린 카드는 그대로 열려 있다', () => {
    const base = hubProps();
    const view = render(<LiveHubView {...base} opportunity={mkOpp()} />);
    openCard();

    // 서버를 다시 불러 같은 항목이 새 객체로 온다 — 기회가 "바뀐" 것이 아니다.
    view.rerender(<LiveHubView {...base} opportunity={mkOpp()} />);

    expect(screen.getByTestId(OP_CARD)).toBeOnTheScreen();
    expect(screen.getByTestId(BAR_EVENT)).toBeSelected();
  });

  it('HN10b 칩을 안 눌러도 보는 날짜가 열린 날짜와 달라지면 카드는 안 보인다', () => {
    const base = hubProps();
    const view = render(
      <LiveHubView {...base} activeDayIndex={1} opportunity={mkOpp()} />
    );
    openCard();

    view.rerender(
      <LiveHubView {...base} activeDayIndex={2} opportunity={mkOpp()} />
    );

    expectEventReadyClosed();
  });

  it.each([
    ['일정', SCHEDULE],
    ['행사', BAR_EVENT],
  ])(
    'HN12 어느 칸(%s)을 눌러도 트리거 알약은 그대로 남는다 (Q-D) — 알약을 숨기는 건 종전 사건뿐',
    (_label, testID) => {
      renderWithPill({ opportunity: mkOpp() });
      expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId(testID));

      expect(screen.getByTestId(TRIGGER_PILL)).toBeOnTheScreen();
      // 짝 — 숨김 장치는 살아 있다(일차 칩은 알약을 지운다).
      fireEvent.press(screen.getByTestId('execution-live-daychip-2'));
      expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();
    }
  );
});

describe('LiveHubView · HS 일정 칸 — 시트를 올릴지 정리만 할지 (TRIP-1522 v2 AC-7)', () => {
  it('HS2 시트가 내려간 뒤 일정 칸을 누르면 시트에 "중간 칸(0)으로 올라와라"는 요청이 한 번 가고 열린 팝업은 닫힌다 — 올라온 뒤엔 요청이 늘지 않는다', () => {
    renderHub({ opportunity: mkOpp() });
    fireSheetAnimate(0, -1);
    // 시트가 내려가 있어도 바는 그대로다 — 팝업은 시트가 내려간 상태에서도 열린다.
    openPopup();

    fireEvent.press(screen.getByTestId(SCHEDULE));

    expect(snapSpy()).toHaveBeenCalledTimes(1);
    expect(snapSpy()).toHaveBeenLastCalledWith(0);
    expectPopupClosedAlive();

    // 시트가 실제로 올라왔다(onAnimate -1→0) — 이후 일정 칸은 요청 없이 정리만.
    fireSheetAnimate(-1, 0);
    fireEvent.press(screen.getByTestId(SCHEDULE));
    expect(snapSpy()).toHaveBeenCalledTimes(1);
  });

  it('HS2b 펼침에서 곧장 내려간 뒤에도(1→-1) 일정 칸은 펼침이 아니라 중간 칸(0)으로 올린다', () => {
    renderHub();
    fireSheetAnimate(1, -1);

    fireEvent.press(screen.getByTestId(SCHEDULE));

    expect(snapSpy()).toHaveBeenCalledTimes(1);
    expect(snapSpy()).toHaveBeenLastCalledWith(0);
  });

  it('HS3 시트 내림(initialSnapIndex=-1)으로 마운트해도 첫 누름부터 올린다 — sheetClosed 초기값', () => {
    renderHub({ initialSnapIndex: -1 });

    fireEvent.press(screen.getByTestId(SCHEDULE));

    expect(snapSpy()).toHaveBeenCalledTimes(1);
    expect(snapSpy()).toHaveBeenLastCalledWith(0);
  });
});

describe('LiveHubView · HC 시트 내림 × 바 유지 (TRIP-1522 v2 AC-6·10)', () => {
  it.each([
    ['시트가 완전히 내려가도(0→-1)', () => fireSheetAnimate(0, -1)],
    ['펼침에서 곧장 내려가도(1→-1)', () => fireSheetAnimate(1, -1)],
    [
      '내려갔다 다시 올라와도(-1→0)',
      () => {
        fireSheetAnimate(0, -1);
        fireSheetAnimate(-1, 0);
      },
    ],
  ])('HC1 %s 바는 뒤로·4칸을 하나도 안 잃고 일정이 활성이다', (_name, fire) => {
    renderHub({ opportunity: mkOpp() });
    BAR_ALL.forEach((testID) =>
      expect(screen.getByTestId(testID)).toBeOnTheScreen()
    );

    fire();

    BAR_ALL.forEach((testID) =>
      expect(screen.getByTestId(testID)).toBeOnTheScreen()
    );
    expectScheduleActive();
    expect(screen.getByTestId(BAR_EVENT)).toBeEnabled();
  });

  it('HC2 시트가 내려가 있어도 barHidden 이면 바가 통째로 없고, 풀면 같은 바로 돌아온다', () => {
    const base = hubProps({ initialSnapIndex: -1 });
    const view = render(<LiveHubView {...base} />);

    view.rerender(<LiveHubView {...base} barHidden />);
    // 짝 앵커 — 허브 본문은 그려져 있다.
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    BAR_ALL.forEach((testID) =>
      expect(screen.queryByTestId(testID)).toBeNull()
    );

    view.rerender(<LiveHubView {...base} barHidden={false} />);
    BAR_ALL.forEach((testID) =>
      expect(screen.getByTestId(testID)).toBeOnTheScreen()
    );
    expectScheduleActive();
  });
});

describe('LiveHubView · HN 시트 칸 · 목록 바닥 여백 (TRIP-1522 v2 AC-9·14)', () => {
  function renderWithInsets(bottom: number, top: number) {
    return render(
      <SafeAreaInsetsContext.Provider
        value={{ top, bottom, left: 0, right: 0 }}
      >
        <LiveHubView {...hubProps()} />
      </SafeAreaInsetsContext.Provider>
    );
  }
  const snaps = () => sheetHost().props.snapPoints as (number | string)[];

  it('HN13 시트 칸은 정확히 [중간 55%, 펼침px] 두 칸이고(안전영역·바 높이와 무관) 시트가 끝까지 내려가도록 열려 있다', () => {
    renderWithInsets(34, 47);

    // 낮은 칸이 없다 — 더 내리면 완전 닫힘(−1)이고, 끌어내려 닫는 것을 허용해야 일정 칸이 올릴 일이 생긴다.
    expect(snaps()).toEqual([
      '55%',
      Dimensions.get('window').height - (47 + 8 + 104),
    ]);
    expect(sheetHost().props.enablePanDownToClose).toBe(true);
  });

  it('HN14 하단 안전영역 34 에서도 일정 목록 바닥 여백은 정확히 86(= 바 점유 70 + 16)이다 — 안전영역을 더하지 않는다', () => {
    renderWithInsets(34, 0);

    const padding = StyleSheet.flatten(
      screen.getByTestId('execution-live-timeline').props.style
    )?.paddingBottom;

    // 목록 끝 카드가 바에 가리지 않는다. 안전영역 34 를 더하면 120 이라 red.
    expect(padding).toBe(86);
  });
});

describe('LiveHubView · HL 지도 로고 마진 (TRIP-1522 v2 AC-17)', () => {
  // 지도(map-native)가 떠야 한다 — 선언과 대입 분리(HT 선례).
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

  it('HL1 로고 마진 아래쪽은 바 점유(70) 이상이고 안전영역과 무관하며, 허브가 다시 그려져도 같은 객체다(memo 된 MapView 가 시트 이동마다 다시 그려지지 않게)', () => {
    render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, bottom: 34, left: 0, right: 0 }}
      >
        <LiveHubView
          {...hubProps({
            triggerChip: fakePill(jest.fn()),
            triggerPillKey: 'trg-1',
          })}
        />
      </SafeAreaInsetsContext.Provider>
    );
    const margin = screen.getByTestId('map-native').props.logoMargin as
      { bottom?: number } | undefined;

    expect(margin?.bottom).toBe(70); // 안전영역 34 를 더하면 104
    fireMapTap(); // 알약 숨김으로 다시 그림
    expect(screen.getByTestId('map-native').props.logoMargin).toBe(margin);
  });
});

describe('LiveHubView · HD 바·카드 치수 — 앱 하단 탭 바와 같은 자리 (TRIP-1522 사이클 3 AC-1·4)', () => {
  // 바가 앱 하단 탭 바와 같은 자리·같은 폭(좌우 30 · 바닥 12)에 서고 하단 안전영역을 더하지 않는다(사이클 2 구현은 더해서 실기에서 약 37pt 높았다).
  // 안전영역 0 에서는 가산 구현도 같은 값이라 34 에서만 갈린다.
  function renderAt(bottom: number, overrides: Overrides = {}) {
    return render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, bottom, left: 0, right: 0 }}
      >
        <LiveHubView {...hubProps(overrides)} />
      </SafeAreaInsetsContext.Provider>
    );
  }
  const anchorStyle = (testID: string) =>
    StyleSheet.flatten(screen.getByTestId(testID).props.style);

  it('HD1 바 앵커는 좌우 30 · 바닥 12 이고 하단 안전영역(34)을 더하지 않는다 — 탭 바와 같은 자리', () => {
    renderAt(34);

    const anchor = anchorStyle('execution-live-bottom-bar-anchor');
    expect(anchor.left).toBe(30);
    expect(anchor.right).toBe(30);
    expect(anchor.bottom).toBe(12); // 더하면 46
    expect(
      within(
        screen.getByTestId('execution-live-bottom-bar-anchor')
      ).getByTestId(BAR)
    ).toBeOnTheScreen();
  });

  it('HD2 행사 카드 앵커는 바와 같은 좌우 30 · 바닥 78(= 바 윗변 70 + 8)이고 안전영역(34)과 무관하며 바의 형제다 (Q-C)', () => {
    renderAt(34, { opportunity: mkOpp() });
    openCard();

    const anchor = anchorStyle('execution-live-opportunity-anchor');
    expect(anchor.left).toBe(30);
    expect(anchor.right).toBe(30);
    expect(anchor.bottom).toBe(78); // 더하면 112
    expect(
      within(
        screen.getByTestId('execution-live-opportunity-anchor')
      ).getByTestId(OP_CARD)
    ).toBeOnTheScreen();
  });
});

/** 프레임(16ms) 격자 위에서 "onBack 이 아직 안 불려야 하는 시각"(총 길이 − 40ms 이전). */
const BEFORE_DUE_MS = Math.floor((BAR_EXIT_MS - 40) / 16) * 16;

describe('LiveHubView · HM 변신 애니메이션 — 영상 4단계 모프는 허브당 한 번 (TRIP-1522 사이클 4 AC-2·9·11)', () => {
  // 허브 바가 출발 탭 활성인 5칸으로 시작해 모프를 허브당 한 번 재생한다 — barHidden 으로 바가 새로 마운트돼도 다시 안 재생(바 마운트가 아니라 허브
  // 마운트에 연결), `departureTab` 이 없으면(탭 바 위가 아닌 진입) 모션 없이 최종 구조다. 값은 안 묶고 보이는 결과 상태만 본다.
  const probe = useAnimatedProbe();
  useInteractionGate();

  it('HM1 허브 첫 렌더가 시작 5칸(출발 탭 활성)이고 모션이 재생되며(짝 대조군) 일정 칸은 같은 노드이고 끝나면 정지한다 — 새 허브 인스턴스는 다시 재생한다(허브당 한 번)', async () => {
    probe.setReduceMotion(false);
    renderHub({ departureTab: 'home' });
    expect(visibleIds()).toEqual(START5_IDS);
    expect(screen.getByTestId(START_HOME)).toBeSelected();
    await flushOsAnswer();

    const watch = watchMotion(60);

    expect(moved(watch)).toBe(true);
    expect(structureSteady(watch)).toBe(true);
    expect(visibleIds()).toEqual(FINAL_IDS);
    const settled = watchMotion(20);
    expect(moved(settled)).toBe(false);
    expect(settled.samples[0]).toBe(lastSample(watch));
    screen.unmount();

    renderHub({ departureTab: 'itinerary' });
    expect(visibleIds()).toEqual(START5_IDS);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected(); // 이번 출발 탭은 일정
    await flushOsAnswer();
    expect(moved(watchMotion(60))).toBe(true);
  });

  it('HM2 입장이 끝난 허브에서 barHidden 이 풀려 바가 새로 마운트돼도 시작 5칸이 다시 나오지 않고 곧장 최종 구조다 — 움직이지 않는다', async () => {
    probe.setReduceMotion(false);
    const base = hubProps({ departureTab: 'home' });
    const view = render(<LiveHubView {...base} />);
    await flushOsAnswer();
    const first = watchMotion(60);
    expect(moved(first)).toBe(true);
    const finalSample = lastSample(first);

    // 메모 시트 등이 열려 바가 사라졌다 돌아온다(BR-U8-53) — 바는 새로 마운트된다.
    view.rerender(<LiveHubView {...base} barHidden />);
    expect(screen.queryByTestId(BAR)).toBeNull();
    view.rerender(<LiveHubView {...base} barHidden={false} />);
    expect(visibleIds()).toEqual(FINAL_IDS); // 첫 프레임부터 최종 — 시작 5칸으로 되돌아가지 않는다
    await flushOsAnswer();

    const again = watchMotion(60);
    expect(screen.getAllByTestId(BAR_ROOT)).toHaveLength(1);
    expect(moved(again)).toBe(false);
    expect(structureSteady(again)).toBe(true);
    expect(again.samples[0]).toBe(finalSample);
    expect(
      again.shapes.every((shape) => shape.join() === FINAL_IDS.join())
    ).toBe(true);
  });

  it('HM4 모션 도중 barHidden 이 켜지면 바는 시작 칸까지 즉시 통째로 없고 계속 없다 — 풀면 최종 구조로 돌아온다(BR-U8-53 그물이 모션 때문에 비지 않는다)', async () => {
    probe.setReduceMotion(false);
    const base = hubProps({ departureTab: 'home' });
    const view = render(<LiveHubView {...base} />);
    await flushOsAnswer();
    watchMotion(3); // 시작 5칸 구간이 한창이다
    expect(screen.getByTestId(BAR)).toBeOnTheScreen();
    expect(visibleIds()).toEqual(START5_IDS);

    view.rerender(<LiveHubView {...base} barHidden />);

    // 시작 칸 4개도 포함해 없음을 본다 — 뒤로·새 칸은 시작 5칸에서 원래 안 보여서 BAR_ALL 만으론 공허하다.
    [...BAR_ALL, ...START_CELLS].forEach((testID) =>
      expect(
        screen.queryByTestId(testID, { includeHiddenElements: true })
      ).toBeNull()
    );
    act(() => {
      jest.advanceTimersByTime(600);
    });
    [...BAR_ALL, ...START_CELLS].forEach((testID) =>
      expect(
        screen.queryByTestId(testID, { includeHiddenElements: true })
      ).toBeNull()
    );

    // 대조군 — 풀면 같은 바(루트 하나)가 최종 구조로 다시 있다(입장은 허브당 한 번이라 다시 안 돈다).
    view.rerender(<LiveHubView {...base} barHidden={false} />);
    BAR_ALL.forEach((testID) =>
      expect(screen.getByTestId(testID)).toBeOnTheScreen()
    );
    expect(screen.getAllByTestId(BAR_ROOT)).toHaveLength(1);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('HM6 출발 탭이 있는 허브에서 뒤로는 모션이 끝난 뒤 1회 onBack 이고(연타 1회) 끝 모양은 기록이 활성인 시작 5칸이다 — 허브가 다시 그려진 뒤에도 출발 탭이 유지된다', async () => {
    probe.setReduceMotion(false);
    const base = hubProps({ departureTab: 'records' });
    const view = render(<LiveHubView {...base} />);
    await flushOsAnswer();
    watchMotion(60); // 입장 모션이 끝난 허브
    expect(visibleIds()).toEqual(FINAL_IDS);
    // 허브는 지도·시트 등으로 자주 다시 그려진다 — 입장이 끝난 뒤에도 출발 탭이 바에 계속 가야 퇴장 끝 모양이 맞는다.
    view.rerender(<LiveHubView {...base} />);

    fireEvent.press(screen.getByTestId(BAR_BACK));
    expect(base.onBack).not.toHaveBeenCalled();
    let before = -1;
    watchMotion(40, 16, (ms) => {
      if (ms === 112) pressBackIfPresent();
      if (ms === BEFORE_DUE_MS)
        before = (base.onBack as jest.Mock).mock.calls.length;
    });

    expect(before).toBe(0);
    expect(base.onBack).toHaveBeenCalledTimes(1);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(screen.getByTestId(START_RECORDS)).toBeSelected();
    expect(screen.getAllByTestId(BAR_ROOT)).toHaveLength(1);
  });
});

/** 뒤로 가지가 (숨김이든) 마운트돼 있으면 누른다 — 연타 시나리오용. */
function pressBackIfPresent() {
  const back = screen.queryByTestId(BAR_BACK, { includeHiddenElements: true });
  if (back) fireEvent.press(back);
}

// ── 기기 폭 — 바 폭 = 화면 폭 − 60 이라 390 기기(330)가 아니면(402 → 342 · 안드로이드 360 → 300 · 430 → 370) ① 정지 모양은 상수 규칙
// (좌우 30 · 뒤로 58 · 간격 8 · 캡슐 = 화면 폭 − 126)과 같고 ② 모션 내내 일정 아이콘이 단계 함수가 말하는 자리에서 안 튄다. 바 폭을 prop 으로 받든
// 훅으로 읽든 중립(허브 앵커 좌우 30 만 전제). 일정 칸의 "보이는 중심" = 구조에서 직접 계산한 레이아웃 자리 + 칸에 걸린 translateX.
describe('LiveHubView · 기기 폭 — 정지 치수와 컷·교체 순간 일정 칸 연속성', () => {
  const probe = useAnimatedProbe();
  useInteractionGate();
  let windowSpy: jest.SpyInstance | null = null;
  afterEach(() => {
    windowSpy?.mockRestore();
    windowSpy = null;
  });
  const barWidthOf = (windowWidth: number) => windowWidth - 2 * LIVE_BAR_SIDE;

  /** 프레임마다 일정 칸의 보이는 중심이 단계 함수가 낼 수 있는 값(프레임 시각 ±8ms 범위, ±0.75pt)에 있는지 본다. */
  function expectFollowing(
    direction: 'enter' | 'exit',
    width: number,
    frames: number,
    delay = 0
  ) {
    let count = 0;
    watchMotion(frames, 16, (ms) => {
      const values = [-8, 0, 8].map(
        (d) =>
          barMorphFrame(direction, Math.max(0, ms - delay + d), width)
            .scheduleCenterX
      );
      const center = scheduleVisibleCenter(width);
      expect(center).toBeGreaterThanOrEqual(Math.min(...values) - 0.75);
      expect(center).toBeLessThanOrEqual(Math.max(...values) + 0.75);
      count += 1;
    });
    expect(count).toBeGreaterThan(20);
  }

  it.each([390, 490])(
    '[화면 폭 %d] 입장·퇴장 내내(컷·교체 앞뒤 포함) 일정 칸의 보이는 중심이 단계 함수가 말하는 자리를 따라간다 — 튀지 않는다',
    async (windowWidth) => {
      windowSpy = setWindowWidth(windowWidth);
      probe.setReduceMotion(false);
      const width = barWidthOf(windowWidth);
      renderHub({ departureTab: 'records' });
      await flushOsAnswer();

      expectFollowing(
        'enter',
        width,
        Math.ceil((BAR_ENTER_DELAY_MS + 352) / 16),
        BAR_ENTER_DELAY_MS
      );
      watchMotion(40); // 입장이 끝날 때까지
      fireEvent.press(screen.getByTestId(BAR_BACK));
      expectFollowing('exit', width, 25);
    }
  );
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

// ── TRIP-1117 · 허브 메모 시트의 뷰 쪽 배선 ─────────────────────────────────────────
//
// 뷰는 저장을 모른다 — 페이지가 준 값만 그린다. 관람 중 슬롯의 `memo`(세션 저장본)는 관람 중 카드 메모 박스로,
// `memoNotice`(시트가 닫힌 뒤 도착한 저장 실패, Q3)는 관람 중 카드에만, `barHidden`(메모 시트가 열림 등 — TRIP-1522
// 에서 `fabHidden` 이 이름을 바꿨다)은 하단 내비 바를 통째로 숨긴다(Figma 4952:3098 F5).

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

  it('🔴 HM3 AC-15·AC-5: barHidden 이면 바(뒤로 포함)가 통째로 없고, 안 주면 전부 있다', () => {
    renderHub({ barHidden: true });
    // 짝 앵커 — 허브는 그려졌다(카드 5장).
    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    BAR_ALL.forEach((testID) =>
      expect(screen.queryByTestId(testID)).toBeNull()
    );

    screen.unmount();
    renderHub();

    BAR_ALL.forEach((testID) =>
      expect(screen.getByTestId(testID)).toBeOnTheScreen()
    );
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
// 화면 밖이다 — 칩만 가로 스크롤 안에 두고, 선택 칩은 위치가 오면 보이게 민다. (TRIP-1522 로 뒤로 버튼이 하단
// 바로 내려가 이 줄은 칩 줄 하나다 — 칩 시작선 x=64→16 은 스크롤 상대 좌표라 아래 테스트는 무변경.)
// ⚠️ 칩이 실제로 잘리는지·밀리는지는 6-b.
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
        initialSnapIndex={1}
        onBack={jest.fn()}
        onSelectDay={jest.fn()}
        onPressManualEdit={jest.fn()}
        onPressChatbot={jest.fn()}
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
// 허브 오버레이 줄 바닥 근사 = 셸 pt-sm 8 + 칩 줄 높이 ≈ 40(02a ★6). TRIP-1522 로 뒤로 버튼이 하단 바로 내려가도
// 맞춤은 셸의 고정 예약(OVERLAY_ROW_RESERVE 52)이 정하므로 이 수치는 "핀이 이 선 아래"의 하한일 뿐이다.
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
    renderHub({ initialSnapIndex: 0 });

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

  it('HB2 펼침(1)으로 진입해도 중간(0) 진입과 같은 맞춤이다 (재계획 적용 직후)', () => {
    renderHub({ initialSnapIndex: 0 });
    const atHalf = hubRegion();
    expect(atHalf).toBeDefined();
    screen.unmount();

    renderHub({ initialSnapIndex: 1 });

    expect(hubRegion()).toEqual(atHalf);
  });

  it('HB3 (금지) 알약 숨김(지도 탭)·시트 칸 이동으로 다시 그려져도 region 은 처음 그 객체다', () => {
    // 준비 — 알약이 있는 허브. 앵커: region 이 있다(지금 camera 모드면 여기서 red).
    renderWithPill({ initialSnapIndex: 0 });
    const first = hubRegion();
    expect(first).toBeDefined();

    // 실행 ① — 지도 탭 → 알약 로컬 숨김(허브 상태가 바뀌어 다시 그려진다, 핀 좌표는 그대로).
    fireMapTap();
    expect(screen.queryByTestId(TRIGGER_PILL)).toBeNull();

    // 단언 ①
    expect(hubRegion()).toBe(first);

    // 실행 ② — 시트가 완전 내림(-1)에 멈춤.
    const onChange = sheetHost().props.onChange as
      ((index: number, position: number, type: number) => void) | undefined;
    expect(onChange).toBeDefined();
    act(() => onChange?.(-1, 0, 0));

    // 단언 ②
    expect(hubRegion()).toBe(first);
  });
});

// 토스트 바닥 레지스트리는 모듈 싱글턴이다 — 파일 최상위(describe 밖)에서 리셋해야 앞 테스트의 신고가 안 샌다(TRIP-1559).
afterEach(() => resetToastBottoms());

describe('LiveHubView · 토스트 바닥 신고: 하단 내비 바 (TRIP-1559 이음새 ④)', () => {
  it('허브가 그려지는 동안 하단 내비 바가 차지하는 높이(LIVE_BOTTOM_BAR_RESERVE)를 신고하고 unmount 로 해제한다', () => {
    expect(getToastBottoms()).toEqual([]);

    renderHub();
    expect(getToastBottoms()).toEqual([LIVE_BOTTOM_BAR_RESERVE]);

    screen.unmount();
    expect(getToastBottoms()).toEqual([]);
  });
});
