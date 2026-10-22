import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { DeviceEventEmitter, FlatList, Keyboard, View } from 'react-native';

import {
  flushOsAnswer,
  holdReduceMotionOn,
} from '@/test-support/barMotionProbe';
import * as probe from '@/test-support/fabAnchorProbe';
import { MemoInline } from '@/features/attach-visit-media/index.view';
import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';
import type { MapCenter, MapPin } from '@/shared/map';
import {
  closestAncestor,
  isInsideSheet,
  renderedText,
  sheetScrollOf,
  treeIndexOf,
} from '@/test-support/sheetTree';

import { TripRecordsView, type TripRecordsViewProps } from './TripRecordsView';

// 셸이 네이버 네이티브 MapView 를 태우므로 관찰 목으로 갈아끼운다(LiveHubView·옛 TripRecordsScreen 선례).
// 시트는 `__mocks__/@gorhom/bottom-sheet` 통과형 목이 자동으로 쓰인다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// TRIP-1280 — 키보드 이벤트는 RN `Keyboard` 가 구독하는 기기 이벤트 통로(DeviceEventEmitter)로 쏜다.
type KeyboardEventName =
  | 'keyboardWillShow'
  | 'keyboardDidShow'
  | 'keyboardWillHide'
  | 'keyboardDidHide';

const KEYBOARD_EVENTS: KeyboardEventName[] = [
  'keyboardWillShow',
  'keyboardDidShow',
  'keyboardWillHide',
  'keyboardDidHide',
];

function emitKeyboard(name: KeyboardEventName): void {
  const frame = { screenX: 0, screenY: 508, width: 390, height: 336 };
  act(() => {
    DeviceEventEmitter.emit(name, {
      startCoordinates: frame,
      endCoordinates: frame,
      duration: 250,
      easing: 'keyboard',
      isEventFromThisApp: true,
    });
  });
}

// `Keyboard` 는 "지금 떠 있나" 를 모듈 싱글턴에 기억한다(keyboardDidShow 로 켜지고 keyboardDidHide 로만
// 꺼짐). 한 케이스가 떠 있는 채로 끝나면 다음 케이스로 새므로 파일 최상위에서 매번 내린다.
afterEach(() => {
  emitKeyboard('keyboardDidHide');
});

/**
 * TRIP-1085 · j01 방문 기록 **순수 뷰**(pages · 셸 조립) — 전면 지도 + 바텀시트(MapSheetShell).
 *
 * 무엇을 보장하나:
 *  - 골격(AC-1): 셸 지도 하나가 시트 뒤에 있고 카드는 시트 안이다. 하단 탭바·옛 250px 지도 블록은 없다.
 *  - 시트 헤더(AC-12): "여행명 · N일차 · M월 D일(요일) · N곳" 한 줄. 여행명이 없으면 그 조각만 빠진다.
 *  - 일차 칩·뒤로(AC-2·3): 셸 칩(`sheet-daychip-{index}`)이 일자를, 하단 바 뒤로(`record-trip-bottom-bar-back`, TRIP-1557)가 뒤로를 올린다.
 *  - 키보드(AC-9): 카드·계획 행·[방문 추가]가 `keyboardShouldPersistTaps="handled"` 스크롤 안에 있다.
 *  - 순서(Figma 4705:2756): 헤더 → 귀속 → 안내문 → 카드 → 계획 행 → [방문 추가].
 *  - 지도 실패(AC-7): 지도 자리만 폴백 바로 바뀌고 헤더·카드·칩은 그대로다.
 *  - 지도 prop(결정 2(a)·3(c)): 잠금(viewOnly) · 핀 전부 맞추기(fitPins) · 받은 핀 그대로.
 *  - 옮겨 온 무회귀: 귀속 헤더(TRIP-569) · 즉석 추가·하트 FAB 부재(TRIP-759) · 안내문 분기(TRIP-760).
 *
 * ⚠️ 원리적 사각: 시트 실제 스냅·딤·키보드가 시트를 밀어 올리는지·지도 제스처는 통과형 목이 못 본다
 *   (6-b). 여기서는 testID 트리·prop 전달·콜백까지만 잠근다.
 *
 * (개념) `UNSAFE_root` = 렌더 트리 맨 위 노드(조상 탐색·순서 비교용) · `toBeSelected()` = 그 노드의
 *   `accessibilityState.selected` 가 true · `toHaveTextContent('문자열')` = 글자 **전체**가 정확히 같다.
 * 3동작: 준비(3일 여행·카드 2·계획 행 2) → 실행(렌더·press) → 단언(testID·글자·콜백·prop).
 */

const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록해요 (좌표 자동기록 비활성)';

const PINS: MapPin[] = [
  { number: 1, lat: 35.1532, lng: 129.1187 },
  { number: 2, lat: 35.1555, lng: 129.1216 },
];

const DEFAULT_COPY = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';

const ERROR_COPY = '오늘 방문한 곳 — 핀은 방문 완료, 빈 핀은 예정';

type PlanRow = NonNullable<TripRecordsViewProps['planRows']>[number];

const DONE_CARD: VisitRecordCardVM = {
  visitCheckId: 'v-a',
  slotKey: '2026-06-11#p1',
  poiId: 'p1',
  nameKo: '광안리 해변',
  arrivedAt: '2026-06-11T14:20:00',
  completedAt: '2026-06-11T15:20:00',
  skippedAt: null,
  arrivedLabel: '14:20',
};

const UPCOMING_CARD: VisitRecordCardVM = {
  visitCheckId: 'v-b',
  slotKey: '2026-06-11#p2',
  poiId: 'p2',
  nameKo: '부산시립미술관',
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  arrivedLabel: null,
};

const ROW_P3: PlanRow = {
  slotKey: '2026-06-11#p3',
  poiId: 'p3',
  nameKo: '○○ 카페',
};

const ROW_P4: PlanRow = {
  slotKey: '2026-06-11#p4',
  poiId: 'p4',
  nameKo: '△△ 시장',
};

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
    mapPins: PINS,
    cards: [DONE_CARD, UPCOMING_CARD],
    planRows: [ROW_P3, ROW_P4],
    onPressComplete: jest.fn(),
    onPressSkip: jest.fn(),
    onPressSpontaneous: jest.fn(),
  };
}

function renderView(overrides: Partial<TripRecordsViewProps> = {}) {
  const props = { ...baseProps(), ...overrides };
  render(<TripRecordsView {...props} />);
  return props;
}

describe('🔴 TRIP-1085 AC-1 · 전면 지도 + 바텀시트 골격', () => {
  it('V1 셸 지도 하나가 시트 밖에 있고, 카드는 시트 안이며, 하단 탭바는 없다', () => {
    renderView();

    const root = screen.getByTestId('record-trip-view');
    expect(within(root).getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    // 지도는 셸의 것 하나뿐 — 옛 250px 히어로가 남으면 2개가 된다.
    expect(screen.getAllByTestId('map-root')).toHaveLength(1);
    expect(isInsideSheet(screen.getByTestId('map-root'))).toBe(false);
    expect(
      isInsideSheet(screen.getByTestId('record-trip-visit-card-v-a'))
    ).toBe(true);
    // 결정 1(b) — 탭바 없음.
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
  });
});

describe('🔴 TRIP-1085 AC-12 · 시트 헤더 한 줄', () => {
  it('V2 "부산 여행 · 2일차 · 6월 11일(목) · 4곳"(카드 2 + 계획 행 2)이 시트 안에 한 줄로 선다', () => {
    renderView();

    const header = screen.getByTestId('record-trip-sheet-header');
    expect(header).toHaveTextContent('부산 여행 · 2일차 · 6월 11일(목) · 4곳');
    expect(isInsideSheet(header)).toBe(true);
  });

  it.each([
    ['여행명 없음', undefined],
    ['여행명 빈 문자열', ''],
  ])('V2b %s → 여행명 조각만 빠진다 (INV-4)', (_label, tripTitle) => {
    renderView({ tripTitle });

    expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
      '2일차 · 6월 11일(목) · 4곳'
    );
  });
});

describe('🔴 TRIP-1085 AC-2·AC-3 · 셸 일차 칩과 뒤로', () => {
  it('V3 칩 3개에 라벨이 서고 활성 일자가 선택돼 있으며, 3일차 칩을 누르면 그 날짜가 1회 올라간다', () => {
    const props = renderView();

    expect(
      within(screen.getByTestId('sheet-daychip-0')).getByText('1일차')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-daychip-2')).getByText('3일차')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();
    expect(screen.getByTestId('sheet-daychip-0')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('sheet-daychip-2'));

    expect(props.onSelectDay).toHaveBeenCalledTimes(1);
    expect(props.onSelectDay).toHaveBeenCalledWith('2026-06-12');
    // 옛 일자 탭은 사라졌다.
    expect(screen.queryAllByTestId(/^record-trip-day-tab-/)).toHaveLength(0);
  });

  // TRIP-1557 — 뒤로는 좌상단 ‹(셸 `hideBack`)에서 하단 바로 옮겼다. 두 곳에 있으면 안 된다(AC-7·AC-8).
  it('V4 하단 바 뒤로(record-trip-bottom-bar-back)를 누르면 onPressBack 이 1회 불리고, 좌상단 ‹(sheet-daychip-back)·옛 record-trip-back 은 없다', async () => {
    holdReduceMotionOn(); // 뒤로가 기록 탭으로 가는 바라 퇴장 모션 뒤 이동한다 — 동작 줄이기 켜짐이면 즉시(TRIP-1591)
    const props = renderView();
    await flushOsAnswer();

    // 앵커 — 일차 칩 줄은 그대로 서 있다(‹ 만 빠졌다).
    expect(screen.getByTestId('sheet-daychip-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('sheet-daychip-back')).toBeNull();
    fireEvent.press(screen.getByTestId('record-trip-bottom-bar-back'));

    expect(props.onPressBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('record-trip-back')).toBeNull();
  });
});

describe('🔴 TRIP-1085 AC-9 · 키보드가 떠 있어도 시트 안 첫 탭이 버튼으로 간다', () => {
  it('V5 카드·계획 행·[방문 추가]를 감싼 시트 스크롤의 keyboardShouldPersistTaps 가 "handled"다', () => {
    renderView();

    const targets = [
      screen.getByTestId('record-trip-visit-card-v-a'),
      screen.getByTestId('record-trip-visit-card-v-b'),
      screen.getByTestId(`record-trip-plan-row-${ROW_P3.slotKey}`),
      screen.getByTestId('record-trip-spontaneous-add'),
    ];
    targets.forEach((node) => {
      const scroll = sheetScrollOf(node);
      expect(scroll).not.toBeNull();
      expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
    });
  });
});

describe('🔴 TRIP-1085 · 시트 본문 순서 (Figma 4705:2756)', () => {
  it('V6 헤더 → 귀속 → 안내문 → 카드 → 계획 행 → [방문 추가] 순으로 그려진다', () => {
    renderView({
      attribution: { stayName: '해운대 그랜드 호텔', dayLabel: '2일차' },
    });

    const at = (node: Parameters<typeof treeIndexOf>[1]) =>
      treeIndexOf(screen.UNSAFE_root, node);
    const order = [
      at(screen.getByTestId('record-trip-sheet-header')),
      at(screen.getByTestId('record-trip-attribution-stay')),
      at(screen.getByText(DEFAULT_COPY)),
      at(screen.getByTestId('record-trip-visit-card-v-a')),
      at(screen.getByTestId(`record-trip-plan-row-${ROW_P3.slotKey}`)),
      at(screen.getByTestId('record-trip-spontaneous-add')),
    ];

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('🔴 TRIP-1085 AC-7 · 지도 로드 실패 (INV-4)', () => {
  it('V7 지도가 실패를 알리면 지도 자리만 폴백 바가 되고 헤더·카드·일차 칩은 그대로다', () => {
    renderView();

    act(() => {
      screen.getByTestId('map-root').props.onLoadFailed();
    });

    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(screen.getByTestId('record-trip-sheet-header')).toBeOnTheScreen();
    expect(screen.getByTestId('record-trip-visit-card-v-a')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-1')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1085 결정 2(a)·3(c) · 지도 prop', () => {
  it('V8 지도는 열려 있고(viewOnly=false · TRIP-1204 시트 열린 채 손가락 확대) 핀 전부 맞추기(fitPins)가 켜져 있으며, 받은 핀을 그대로 넘긴다', () => {
    renderView();

    const map = screen.getByTestId('map-root');
    expect(map.props.viewOnly).toBe(false);
    expect(map.props.fitPins).toBe(true);
    expect(map.props.pins).toEqual(PINS);
  });
});

describe('🔴 TRIP-1085 AC-6 · 빈 상태·조회 실패 표면도 시트 안', () => {
  it('V9a 방문 0건이면 record-trip-empty 가 시트 안에 선다', () => {
    renderView({ cards: [], planRows: [] });

    expect(isInsideSheet(screen.getByTestId('record-trip-empty'))).toBe(true);
  });

  it('V9b 조회 실패면 record-trip-error 가 시트 안에 선다', () => {
    renderView({ cards: [], planRows: [], recordsStatus: 'error' });

    expect(isInsideSheet(screen.getByTestId('record-trip-error'))).toBe(true);
  });
});

describe('🔴 TRIP-1085 AC-14 · 체류·소요 시간 0 (BR-U5-08 · INV-3)', () => {
  it('V10 헤더·카드·계획 행 어디에도 N분·N시간·소요·체류가 없다', () => {
    renderView();

    const text = renderedText(screen.UNSAFE_root);
    // 짝 — 렌더가 비지 않았다(장소명·헤더가 있다).
    expect(text).toContain('광안리 해변');
    expect(text).toContain('6월 11일(목)');
    expect(/(\d+\s*분|\d+\s*시간|소요|체류)/.test(text)).toBe(false);
  });
});

/**
 * TRIP-569 · US-REC-05 · AC-7 — 일자별 귀속 그룹 헤더(옛 TripRecordsScreen.test 에서 옮김, 단언 무수정).
 * 숙소 있는 날만 testID(-stay) 줄이 선다 — 숙소 없는 날은 줄 자체가 없다(TRIP-1097, 아래 describe).
 * 숙소명·라벨은 각자 별 Text leaf 라 `getByText(문자열)` 완전 일치로 찾는다.
 */
/**
 * 🔴 TRIP-1085 5-b 보강(code-critic 경고 1) — 카드 이름표(key)는 방문 id 다. 같은 날 순서가 바뀌어도 메모
 * 초안은 제 방문을 따라간다.
 *
 * 왜: `MemoInline` 은 초안을 **첫 마운트 때 한 번만** 심는다(seed-once). 리스트가 자리 번호(index)를 key 로
 * 쓰면, 같은 날 안에서 순서만 바뀔 때(시각 수정 → 도착순 재정렬) 0번 자리 컴포넌트가 그대로 살아 다른 방문을
 * 받는다 → A 에 쓰던 초안이 B 칸에 남고, blur 되면 **A 의 메모가 B 로 저장된다**. 날짜 전환 테스트(통합
 * seed-once)는 로딩 동안 목록이 비워져 key 와 무관하게 새로 마운트되므로 이 경로를 못 잡는다.
 *
 * (개념) `rerender(ui)` = 같은 화면을 새 props 로 다시 그린다(마운트 유지 — 상태가 남는지 볼 수 있다).
 * 3동작: 준비(카드 A·B + 카드마다 메모 칸) → 실행(A 에 초안 입력 → 순서만 [B, A] 로 다시 그림) →
 *   단언(B 칸 = B 의 값, A 칸 = A 의 초안).
 */
describe('🔴 TRIP-1085 5-b · 같은 날 재정렬에도 메모 초안이 제 방문을 따라간다 (key = 방문 id)', () => {
  it('V11 A 에 초안을 쓰고 카드 순서가 [B, A] 로 바뀌면, B 칸은 B 값·A 칸은 A 초안 그대로다', () => {
    const cardA: VisitRecordCardVM = { ...DONE_CARD, visitCheckId: 'v-a' };
    const cardB: VisitRecordCardVM = {
      ...DONE_CARD,
      visitCheckId: 'v-b',
      slotKey: '2026-06-11#p2',
      poiId: 'p2',
      nameKo: '부산시립미술관',
    };
    const renderCard = (card: VisitRecordCardVM) => (
      <View testID={`wrap-${card.visitCheckId}`}>
        <MemoInline text={`memo-${card.visitCheckId}`} />
      </View>
    );
    const memoOf = (id: string) =>
      within(screen.getByTestId(`wrap-${id}`)).getByTestId(
        'record-trip-memo-input'
      ).props.value;

    // 준비 — A·B 순서로 그리고 A 칸에 초안을 입력한다.
    const { rerender } = render(
      <TripRecordsView
        {...baseProps()}
        planRows={[]}
        cards={[cardA, cardB]}
        renderCard={renderCard}
      />
    );
    fireEvent.changeText(
      within(screen.getByTestId('wrap-v-a')).getByTestId(
        'record-trip-memo-input'
      ),
      'draft-A'
    );

    // 실행 — 같은 날 안에서 순서만 뒤집는다(시각 수정 → 도착순 재정렬과 같은 모양).
    rerender(
      <TripRecordsView
        {...baseProps()}
        planRows={[]}
        cards={[cardB, cardA]}
        renderCard={renderCard}
      />
    );

    // 단언 — 초안은 자리 번호가 아니라 방문을 따라간다.
    expect(memoOf('v-b')).toBe('memo-v-b');
    expect(memoOf('v-a')).toBe('draft-A');
  });
});

describe('AC-7 · 숙소 있는 날 — 숙소명 + 날짜 귀속 헤더', () => {
  it('record-trip-attribution-stay 에 숙소명·라벨이 뜨고 date-only 헤더는 없다', () => {
    renderView({ attribution: { stayName: '충무로 호텔', dayLabel: '2일차' } });

    expect(screen.getByTestId('record-trip-attribution-stay')).toBeTruthy();
    expect(screen.queryByTestId('record-trip-attribution-date')).toBeNull();
    expect(screen.getByText('충무로 호텔')).toBeTruthy();
    expect(
      within(screen.getByTestId('record-trip-attribution-stay')).getByText(
        '2일차'
      )
    ).toBeTruthy();
  });
});

/**
 * TRIP-1097 결정 1 — 숙소 없는 날(당일치기·이동일)은 귀속 줄을 그리지 않는다. 일차·날짜는 시트 헤더
 * 한 줄이 이미 보이므로 BR-U5-26 "날짜만으로 묶는다"는 헤더가 맡는다(옛 date-only 줄은 헤더와 중복).
 * 3동작: 준비(숙소 null · 2일차) → 실행(렌더) → 단언(귀속 줄 둘 다 없음 · 헤더 그대로 · 일차 칩 밖에
 * 딱 "2일차"만 적힌 글자 없음 · 안내문은 헤더 뒤 그대로).
 */
describe('🔴 TRIP-1097 · 숙소 없는 날 — 귀속 줄 없음(헤더가 날짜 귀속)', () => {
  it('귀속 줄이 없고, 헤더는 그대로이며, "2일차" 단독 글자는 일차 칩뿐이다', () => {
    renderView({ attribution: { stayName: null, dayLabel: '2일차' } });

    expect(screen.queryByTestId('record-trip-attribution-date')).toBeNull();
    expect(screen.queryByTestId('record-trip-attribution-stay')).toBeNull();
    expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
      '부산 여행 · 2일차 · 6월 11일(목) · 4곳'
    );
    // getAllByText('2일차') = 글자 전체가 정확히 "2일차"인 Text 전부(헤더 한 줄은 긴 문자열이라 안 걸린다).
    // 일차 칩(sheet-daychip-*) 안의 것을 빼면 0개여야 한다 — 귀속 줄이 되살아나면 1개가 된다.
    const outsideChips = screen
      .getAllByText('2일차')
      .filter(
        (node) =>
          closestAncestor(node, (candidate) =>
            /^sheet-daychip-/.test(String(candidate.props.testID ?? ''))
          ) === null
      );
    expect(outsideChips).toHaveLength(0);
    // 무회귀 — 안내문은 헤더 뒤에 그대로 선다.
    const at = (node: Parameters<typeof treeIndexOf>[1]) =>
      treeIndexOf(screen.UNSAFE_root, node);
    expect(at(screen.getByTestId('record-trip-sheet-header'))).toBeLessThan(
      at(screen.getByText(DEFAULT_COPY))
    );
  });
});

describe('🔴 TRIP-759 · 귀속 헤더·일자 칩·즉석 추가 유지 + 하트 FAB 제거', () => {
  it('일자 칩·즉석 추가는 헤더와 함께 남고, record-trip-saved-fab 는 사라진다', () => {
    renderView({ attribution: { stayName: '충무로 호텔', dayLabel: '2일차' } });

    // TRIP-1085 — 일자 탭은 셸 칩(sheet-daychip-{index})으로 옮겨 갔다.
    expect(screen.getByTestId('sheet-daychip-0')).toBeTruthy();
    expect(screen.getByTestId('record-trip-spontaneous-add')).toBeTruthy();
    expect(screen.queryByTestId('record-trip-saved-fab')).toBeNull();
  });
});

/**
 * TRIP-760 · AC-6 — 안내문 카피 prop 분기(옮김). 주면 그 문자열, 안 주면 default.
 * error 카피의 `—` 는 EM DASH(U+2014), default 의 `·` 는 U+00B7.
 */
describe('🔴 TRIP-760 · AC-6 · 안내문 카피 prop 분기', () => {
  it('A6a · noticeCopy 주입 → error 카피로 대체(default 문자열 부재)', () => {
    renderView({ noticeCopy: ERROR_COPY });

    expect(screen.getByText(ERROR_COPY)).toBeTruthy();
    expect(screen.queryByText(DEFAULT_COPY)).toBeNull();
  });

  it('A6b · noticeCopy 미주입 → 현행 default 문자열 유지(무회귀 짝)', () => {
    renderView();

    expect(screen.getByText(DEFAULT_COPY)).toBeTruthy();
  });
});

describe('수동 체크인 얼굴 — GPS 미동의 배너·지도 ⊘ 배지', () => {
  // TRIP-761 · TRIP-1085 AC-4 (옛 TripRecordsView.manualCheckin.test.tsx)
  /**
   * TRIP-761 · AC-1·AC-3 → TRIP-1085 AC-4 — j01 manual-checkin 얼굴의 GPS 미동의 배너 + 지도 ⊘ 배지.
   * (옛 `features/record/ui/TripRecordsScreen.manualCheckin.test.tsx` 를 옮겨 새 뷰로 렌더한다.)
   *
   * 무엇을 보장하나:
   *  - AC-1(761)  `manualCheckin` true → 배너(`record-gps-banner`) + 제목·본문 카피. false/미주입 → 부재.
   *  - AC-3(761)  true → ⊘ 배지(`record-map-gps-off`) + "GPS 자동기록 꺼짐" + testID 노드 자신이
   *               `pointerEvents="none"`. false → 부재.
   *  - 🔴 1085 AC-4 · Figma 4705:3557 — 배너는 **시트 안, 헤더 바로 아래**(헤더 < 배너 < 안내문). 배지는
   *               **시트 밖, 셸의 좌상단 일차 칩과 같은 컨테이너**(= 셸 `mapCard` 슬롯)다 — 지도 위에 새
   *               absolute 오버레이를 직접 얹지 않는다(repo-traps 지도 절: 그 경우를 지키는 소스 가드가 없다).
   *
   * ⚠️ 실제 덮임·터치 통과·dashed 테두리·색은 jest 사각(6-b). `pointerEvents` prop 이 유일한 예방 그물이다.
   *
   * (개념) `closestAncestor(node, 조건)` = 위로 올라가며 조건에 맞는 첫 조상 · `within(노드).queryByTestId`
   *   = 그 서브트리 안에서만 찾기 · `.props.pointerEvents` = 그 노드에 실린 prop 을 직접 읽기.
   */

  // 사용자 가시 카피 = 계약(Figma 1562:1816 → 4705:3557 동일). — = EM DASH(U+2014), · = U+00B7.
  const BANNER_TITLE = '위치 권한 없음 — 수동 체크인으로 기록해요';

  const BANNER_BODY =
    '위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요. 방문한 장소를 직접 선택해 기록해요.';

  const BADGE_TEXT = 'GPS 자동기록 꺼짐';

  function baseProps(): TripRecordsViewProps {
    return {
      tripTitle: '부산 여행',
      dayTabs: [{ day: '2026-08-20', label: '1일차' }],
      activeDay: '2026-08-20',
      onSelectDay: jest.fn(),
      onPressBack: jest.fn(),
      mapCenter: CENTER,
      mapPins: [],
      cards: [],
      onPressComplete: jest.fn(),
      onPressSkip: jest.fn(),
      onPressSpontaneous: jest.fn(),
    };
  }

  function renderView(overrides: Partial<TripRecordsViewProps> = {}) {
    render(<TripRecordsView {...baseProps()} {...overrides} />);
  }

  describe('🔴 TRIP-761 · AC-1 · GPS 미동의 배너', () => {
    it('A1a · manualCheckin true → 배너 + 제목·본문 카피가 뜬다', () => {
      renderView({ manualCheckin: true });

      expect(screen.getByTestId('record-gps-banner')).toBeTruthy();
      expect(screen.getByText(BANNER_TITLE)).toBeTruthy();
      expect(screen.getByText(BANNER_BODY)).toBeTruthy();
    });

    it('A1b · manualCheckin false → 배너 부재(무회귀 짝)', () => {
      renderView({ manualCheckin: false });

      expect(screen.queryByTestId('record-gps-banner')).toBeNull();
      expect(screen.queryByText(BANNER_TITLE)).toBeNull();
    });

    it('A1c · manualCheckin 미주입 → 배너 부재(기존 호출자·프리뷰 무영향)', () => {
      renderView();

      expect(screen.queryByTestId('record-gps-banner')).toBeNull();
    });

    it('🔴 A1d · 배너는 시트 안, 헤더 바로 아래 · 안내문 위다 (1085 AC-4 · Figma 4705:3557)', () => {
      renderView({ manualCheckin: true, noticeCopy: MANUAL_NOTICE });

      const banner = screen.getByTestId('record-gps-banner');
      expect(isInsideSheet(banner)).toBe(true);

      const root = screen.UNSAFE_root;
      const header = treeIndexOf(
        root,
        screen.getByTestId('record-trip-sheet-header')
      );
      const bannerAt = treeIndexOf(root, banner);
      const notice = treeIndexOf(root, screen.getByText(MANUAL_NOTICE));
      expect(header).toBeGreaterThanOrEqual(0);
      expect(header).toBeLessThan(bannerAt);
      expect(bannerAt).toBeLessThan(notice);
    });
  });

  describe('🔴 TRIP-761 · AC-3 · 지도 ⊘ "GPS 자동기록 꺼짐" 배지', () => {
    it('A3a · manualCheckin true → 배지 + 문구 + pointerEvents="none"', () => {
      renderView({ manualCheckin: true });

      const badge = screen.getByTestId('record-map-gps-off');
      expect(badge).toBeTruthy();
      expect(screen.getByText(BADGE_TEXT)).toBeTruthy();
      expect(badge.props.pointerEvents).toBe('none');
    });

    it('A3b · manualCheckin false → 배지 부재(무회귀 짝)', () => {
      renderView({ manualCheckin: false });

      expect(screen.queryByTestId('record-map-gps-off')).toBeNull();
      expect(screen.queryByText(BADGE_TEXT)).toBeNull();
    });

    it('🔴 A3c · 배지는 시트 밖, 셸 좌상단 일차 칩과 같은 컨테이너(mapCard 슬롯)에 선다 (1085 AC-4)', () => {
      renderView({ manualCheckin: true });

      const badge = screen.getByTestId('record-map-gps-off');
      expect(isInsideSheet(badge)).toBe(false);

      // 위로 올라가며 셸 일차 칩 줄(sheet-daychip-root)을 품은 첫 조상 = 셸의 좌상단 오버레이 컨테이너.
      // 그 컨테이너는 셸 루트 **안**이어야 한다 — 뷰가 셸 바깥에서 absolute 로 얹으면 칩 줄을 품은 첫
      // 조상이 셸 루트 자신이나 그 위(record-trip-view)가 되어 아래 단언이 red 가 된다.
      const shellRoot = screen.getByTestId('map-sheet-shell-root');
      const overlay = closestAncestor(
        badge,
        (node) => within(node).queryByTestId('sheet-daychip-root') !== null
      );
      expect(overlay).not.toBeNull();
      const overlayInsideShell =
        overlay !== null &&
        closestAncestor(overlay, (node) => node === shellRoot) !== null;
      expect(overlayInsideShell).toBe(true);
    });
  });
});

describe('빈 상태 + 그날 계획 행', () => {
  // TRIP-1021 (옛 TripRecordsView.planRows.test.tsx)
  /**
   * TRIP-1021 #086 · AC-10~14 (화면 쪽) — j01 방문 기록이 0건이면 빈 상태 안내 + 그날 계획 행.
   * (TRIP-1085 — 옛 `features/record/ui/TripRecordsScreen.planRows.test.tsx` 를 옮겨 새 순수 뷰
   *  `TripRecordsView`(셸 시트 본문)로 렌더한다. P1~P9 단언은 그대로, P7 의 글자 수집만 바꿨다.)
   *
   * 무엇을 보장하나:
   *  - 방문 카드가 0장이면 `record-trip-empty` 안내가 한 번 뜨고, 1장 이상이면 없다.
   *  - 페이지가 내린 `planRows`(레코드 없는 계획 슬롯)는 행마다 `record-trip-plan-row-{slotKey}` 로 선다.
   *    방문이 있어도 레코드 없는 슬롯은 행으로 남는다(Q4 — 둘째 곳도 j01 에서 체크할 수 있게).
   *  - 페이지가 `onPressPlanCheck` 를 내리면(오늘 탭) 모드와 무관하게 행에 "방문 체크"가 붙고, 누르면 그 행을
   *    페이지로 올린다(TRIP-1069 결정 1(c) — 옛 "수동 모드일 때만"을 뒤집음).
   *  - 계획 행은 `VisitRecordCard` 가 아니다 — 그 카드는 레코드 id 로 [건너뜀]을 쏘는데 계획 행엔 id 가
   *    없어, 합성 id 로 재사용하면 404 요청이 나간다(브리프 맹점 ④).
   *  - 빈 상태 안내는 부제(법 근거 문구 "(좌표 자동기록 비활성)")를 덮어쓰지 않는 별도 요소다(AC-13).
   *  - 어디에도 개별 체류 시간이 없다(AC-12 · INV-3).
   *  - (5-c 경고5) 기록이 로딩 중이면 빈 상태 안내를 안 띄우고, 조회가 실패하면 빈 상태 대신 오류 표면
   *    (`record-trip-error` + `record-trip-error-retry`)을 띄운다. 미주입(`recordsStatus` 없음)은 'ready' 로
   *    읽어 기존 호출자·프리뷰가 그대로다.
   *
   * "레코드 없는 슬롯만 행으로" 조인은 페이지 몫이라 여기선 `planRows` 를 직접 준다(02a ★13) — 그
   * 조인은 `TripRecordsPage.integration.test.tsx` 의 계획 행 묶음이 본다.
   *
   * 3동작: 준비(카드·계획 행·모드) → 실행(렌더·press) → 단언(testID 존재/부재·글자·콜백).
   */

  type RecordPlanRowVM = NonNullable<TripRecordsViewProps['planRows']>[number];

  const DAY = '2026-08-20';

  const EMPTY_COPY = '아직 방문 기록이 없어요';

  const ROW_P3: RecordPlanRowVM = {
    slotKey: `${DAY}#p3`,
    poiId: 'p3',
    nameKo: '○○ 카페',
  };

  const ROW_P4: RecordPlanRowVM = {
    slotKey: `${DAY}#p4`,
    poiId: 'p4',
    nameKo: '△△ 미술관',
  };

  const DONE_CARD: VisitRecordCardVM = {
    visitCheckId: 'v-a',
    slotKey: `${DAY}#p1`,
    poiId: 'p1',
    nameKo: '광안리 해변',
    arrivedAt: `${DAY}T14:20:00`,
    completedAt: `${DAY}T15:20:00`,
    skippedAt: null,
    arrivedLabel: '14:20',
  };

  const rowId = (row: RecordPlanRowVM) => `record-trip-plan-row-${row.slotKey}`;

  const checkId = (row: RecordPlanRowVM) =>
    `record-trip-plan-check-${row.slotKey}`;

  function renderScreen(overrides: Partial<TripRecordsViewProps> = {}) {
    const handlers = {
      onSelectDay: jest.fn(),
      onPressComplete: jest.fn(),
      onPressSkip: jest.fn(),
      onPressManualCheck: jest.fn(),
      onPressPlanCheck: jest.fn(),
    };
    render(
      <TripRecordsView
        dayTabs={[{ day: DAY, label: '1일차' }]}
        activeDay={DAY}
        mapCenter={CENTER}
        mapPins={[]}
        cards={[]}
        {...handlers}
        {...overrides}
      />
    );
    return handlers;
  }

  describe('TripRecordsView · 빈 상태 + 계획 행 (TRIP-1021 AC-10·AC-14)', () => {
    it('P1 방문 0건 + 계획 2곳 → 빈 상태 안내 1개와 계획 행 2개(각자 장소 이름)가 선다 (AC-10)', () => {
      renderScreen({ planRows: [ROW_P3, ROW_P4] });

      expect(screen.getAllByTestId('record-trip-empty')).toHaveLength(1);
      expect(screen.getByTestId('record-trip-empty')).toHaveTextContent(
        EMPTY_COPY
      );
      expect(
        within(screen.getByTestId(rowId(ROW_P3))).getByText('○○ 카페')
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId(rowId(ROW_P4))).getByText('△△ 미술관')
      ).toBeOnTheScreen();
    });

    it('P2 방문이 1건 이상이면 빈 상태 안내는 없고, 레코드 없는 계획 행은 남는다 (AC-14 · Q4)', () => {
      renderScreen({ cards: [DONE_CARD], planRows: [ROW_P3] });

      // 짝 앵커 — 방문 카드와 계획 행이 실제로 있다.
      expect(
        screen.getByTestId('record-trip-visit-card-v-a')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(rowId(ROW_P3))).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-empty')).toBeNull();
    });
  });

  describe('TripRecordsView · 계획 행 "방문 체크" (TRIP-1021 AC-11)', () => {
    it('P3 수동 체크인 모드 → 행의 "방문 체크"를 누르면 그 행이 1회 올라가고, 완료·건너뜀은 안 불린다', () => {
      const handlers = renderScreen({
        manualCheckin: true,
        planRows: [ROW_P3, ROW_P4],
      });

      const check = screen.getByTestId(checkId(ROW_P4));
      expect(check).toHaveTextContent('방문 체크');

      fireEvent.press(check);

      expect(handlers.onPressPlanCheck).toHaveBeenCalledTimes(1);
      expect(handlers.onPressPlanCheck).toHaveBeenCalledWith(
        expect.objectContaining({ slotKey: `${DAY}#p4`, poiId: 'p4' })
      );
      expect(handlers.onPressComplete).not.toHaveBeenCalled();
      expect(handlers.onPressSkip).not.toHaveBeenCalled();
    });

    // TRIP-1069 결정 1(c)·D8 — 옛 P4("수동 모드가 아니면 없다")를 뒤집었다. 위치 권한이 있어도 자동 도착이
    // 안 잡힐 수 있으니 오늘 탭 계획 행에선 손으로 체크할 수 있어야 한다. 켜고 끄는 기준은 이제 모드가 아니라
    // 페이지가 `onPressPlanCheck` 를 내렸는지(= 오늘 탭인지) 하나다.
    it('P4 수동 체크인 모드가 아니어도 onPressPlanCheck 가 있으면 행마다 "방문 체크"가 서고, 누르면 그 행이 올라간다', () => {
      const handlers = renderScreen({
        manualCheckin: false,
        planRows: [ROW_P3, ROW_P4],
      });

      expect(screen.getByTestId(checkId(ROW_P3))).toBeOnTheScreen();
      const check = screen.getByTestId(checkId(ROW_P4));
      expect(check.props.accessibilityRole).toBe('button');

      fireEvent.press(check);

      expect(handlers.onPressPlanCheck).toHaveBeenCalledTimes(1);
      expect(handlers.onPressPlanCheck).toHaveBeenCalledWith(
        expect.objectContaining({ slotKey: `${DAY}#p4`, poiId: 'p4' })
      );
    });

    it('P4b onPressPlanCheck 를 안 내리면(지난·미래 날) 수동 모드여도 "방문 체크"가 없다', () => {
      renderScreen({
        manualCheckin: true,
        planRows: [ROW_P3, ROW_P4],
        onPressPlanCheck: undefined,
      });

      // 짝 앵커 — 행 2개는 있다.
      expect(screen.getByTestId(rowId(ROW_P3))).toBeOnTheScreen();
      expect(screen.getByTestId(rowId(ROW_P4))).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(
        0
      );
    });
  });

  describe('TripRecordsView · 계획 행은 방문 카드가 아니다 (TRIP-1021 맹점 ④)', () => {
    it('P5 계획 행만 있을 때 VisitRecordCard·[건너뜀]·방문 카드 testID 가 하나도 없다', () => {
      renderScreen({ manualCheckin: true, planRows: [ROW_P3, ROW_P4] });

      // 짝 앵커 — 행 2개는 있다(부재가 빈 렌더에서 공허하게 통과하지 않게).
      expect(screen.getByTestId(rowId(ROW_P3))).toBeOnTheScreen();
      expect(screen.getByTestId(rowId(ROW_P4))).toBeOnTheScreen();
      expect(screen.UNSAFE_queryAllByType(VisitRecordCard)).toHaveLength(0);
      expect(screen.queryAllByTestId(/^record-visit-skip-/)).toHaveLength(0);
      expect(screen.queryAllByTestId(/^record-trip-visit-card-/)).toHaveLength(
        0
      );
    });
  });

  describe('TripRecordsView · 부제와 빈 상태는 따로다 (TRIP-1021 AC-13)', () => {
    it('P6 수동 모드 + 방문 0건 → 법 근거 부제와 빈 상태 안내가 둘 다 있고, 안내는 부제를 담지 않는다', () => {
      renderScreen({
        manualCheckin: true,
        noticeCopy: MANUAL_NOTICE,
        planRows: [ROW_P3],
      });

      expect(screen.getByText(MANUAL_NOTICE)).toBeOnTheScreen();
      const empty = screen.getByTestId('record-trip-empty');
      expect(within(empty).queryByText(/좌표 자동기록 비활성/)).toBeNull();
    });
  });

  describe('TripRecordsView · 기록 조회 로딩·실패 (TRIP-1021 5-c 경고5)', () => {
    it('P8 기록이 아직 로딩 중이면 빈 상태 안내도 오류 표면도 없다', () => {
      renderScreen({ recordsStatus: 'loading' });

      // 짝 앵커 — 화면은 그려졌다(부제 기본 문구).
      expect(
        screen.getByText('오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-empty')).toBeNull();
      expect(screen.queryByTestId('record-trip-error')).toBeNull();
    });

    it('P9 기록 조회가 실패하면 "아직 방문 기록이 없어요" 대신 오류 표면이 서고, [다시 시도]가 페이지로 올라간다', () => {
      const onPressRetryRecords = jest.fn();
      renderScreen({ recordsStatus: 'error', onPressRetryRecords });

      expect(screen.getByTestId('record-trip-error')).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-empty')).toBeNull();
      expect(screen.queryByText(EMPTY_COPY)).toBeNull();

      fireEvent.press(screen.getByTestId('record-trip-error-retry'));
      expect(onPressRetryRecords).toHaveBeenCalledTimes(1);
    });
  });

  describe('TripRecordsView · INV-3 (TRIP-1021 AC-12)', () => {
    it('P7 계획 행·방문 카드 어디에도 체류·소요 시간 문자열이 없다', () => {
      renderScreen({
        manualCheckin: true,
        cards: [DONE_CARD],
        planRows: [ROW_P3, ROW_P4],
      });

      // TRIP-1085 — 셸 list 경로에선 `JSON.stringify(screen.toJSON())` 가 순환 참조로 죽는다(FlatList 가
      // 헤더·푸터 엘리먼트를 호스트 props 로 흘린다). 화면의 Text 글자만 모아 본다.
      const text = renderedText(screen.UNSAFE_root);
      // 짝 — 렌더가 비지 않았다(행·카드 이름이 있다).
      expect(text).toContain('○○ 카페');
      expect(text).toContain('광안리 해변');
      expect(/(\d+\s*분|\d+\s*시간|소요|체류)/.test(text)).toBe(false);
    });
  });
});

describe('하단 바 — 허브식 뒤로 + 기록·회고·요약', () => {
  // TRIP-1557 (옛 TRIP-1088 「오늘의 회고」 FAB 블록 대체 — FAB 는 사라지고 회고는 바의 한 칸이 됐다)
  /**
   * TRIP-1557 · j01 하단 바 — 뷰 단위(D1~D8 · K1~K3). FAB 를 지우고 허브(i01)와 같은 부품(`widgets/bottom-nav-bar`)으로 바를 세운다.
   *
   * 무엇을 보장하나:
   *  - 금지(D1): 「오늘의 회고」 FAB·앵커는 콜백을 줘도 없다.
   *  - 구성(D2): 뒤로 + 기록·회고·요약(이 순서), 기록 칸만 활성(selected). 바는 시트 밖이고 셸보다 뒤에 그려진다(시트가 바를 덮지 않게).
   *  - 회고 칸(D3·D4): 콜백이 오면 눌려 1회 부르고, 없으면 비활성(미래·로딩 판정은 페이지 몫 — 콜백 유무가 곧 스위치).
   *  - 요약 칸(D5·D6): 콜백이 오면 1회, 없으면 비활성 + 낭독 값 「요약 준비 중」(조회 중·실패·미준비를 한 몸으로 — INV-4).
   *  - 기록 칸(D7): 지금 화면이라 눌러도 어디로도 안 간다.
   *  - 바는 늘 있다(D8): 기록 조회가 로딩·실패여도 뒤로가 살아 있다(나갈 길).
   *  - 키보드(K1~K3): 메모 입력으로 키보드가 뜨면 바를 트리에서 뺀다(투명 처리면 보이지 않는 바가 입력 위 터치를 가로챈다).
   *  - 뒤로(V4): 하단 바 뒤로가 onPressBack 을 부르고 좌상단 ‹ 는 없다(`hideBack`) — 위 TRIP-1085 AC-2·3 묶음.
   *
   * ⚠️ 원리적 사각(6-b): 바와 시트의 실제 겹침·닫힘 칸 핸들이 바 위에 보이는지(snapPoints 첫 칸 ≥ 바 점유 70 + 핸들 28)·유리 표면·
   *   안드로이드 키보드 시 바 오름. 통과형 시트 목은 snapPoints 를 그냥 되돌려 줘 값 단언이 구현을 베낀다(README §테스트 전략 판정 4).
   * 3동작: 준비(콜백 주입) → 실행(render · press · 키보드 이벤트) → 단언(testID·낭독 상태·콜백 횟수).
   */

  const BAR = 'record-trip-bottom-bar';
  const BACK = 'record-trip-bottom-bar-back';
  const TAB_RECORDS = 'record-trip-bottom-bar-tab-records';
  const TAB_REFLECTION = 'record-trip-bottom-bar-tab-reflection';
  const TAB_SUMMARY = 'record-trip-bottom-bar-tab-summary';
  const BAR_IDS = [BAR, BACK, TAB_RECORDS, TAB_REFLECTION, TAB_SUMMARY];

  function renderWithBar(overrides: Partial<TripRecordsViewProps> = {}) {
    return renderView({
      onPressReflection: jest.fn(),
      onPressSummary: jest.fn(),
      ...overrides,
    });
  }

  describe('🔴 TRIP-1557 D1 · 「오늘의 회고」 FAB 는 없다', () => {
    it('D1 회고·요약 콜백을 줘도 FAB·앵커·「오늘의 회고」 글자가 없다 (회고는 바의 한 칸이다)', () => {
      renderWithBar();

      expect(screen.getByTestId(BAR)).toBeOnTheScreen(); // 짝 앵커 — 바는 그려졌다
      expect(screen.queryByTestId('record-trip-reflection-fab')).toBeNull();
      expect(
        screen.queryByTestId('record-trip-reflection-fab-anchor')
      ).toBeNull();
      expect(screen.queryByText('오늘의 회고')).toBeNull();
    });
  });

  describe('🔴 TRIP-1557 D2 · 바의 구성', () => {
    it('D2a 바 안 버튼이 뒤로 → 기록 → 회고 → 요약 순이고, 기록 칸만 활성(selected)이다', () => {
      renderWithBar();

      const bar = screen.getByTestId(BAR);
      expect(
        within(bar)
          .getAllByRole('button')
          .map((node) => node.props.accessibilityLabel)
      ).toEqual(['뒤로', '기록', '회고', '요약']);
      expect(screen.getByTestId(TAB_RECORDS)).toBeSelected();
      expect(screen.getByTestId(TAB_REFLECTION)).not.toBeSelected();
      expect(screen.getByTestId(TAB_SUMMARY)).not.toBeSelected();
      expect(screen.getByTestId(BACK)).toBeOnTheScreen();
    });

    it('D2b 바는 뷰 안·시트 밖·셸 밖에 서고 셸보다 뒤에 그려진다 (시트·지도가 바를 덮거나 바가 시트와 함께 움직이면 안 된다)', () => {
      renderWithBar();

      const bar = screen.getByTestId(BAR);
      const shellRoot = screen.getByTestId('map-sheet-shell-root');
      expect(
        closestAncestor(bar, (node) => node.props.testID === 'record-trip-view')
      ).not.toBeNull();
      expect(isInsideSheet(bar)).toBe(false);
      expect(closestAncestor(bar, (node) => node === shellRoot)).toBeNull();
      expect(treeIndexOf(screen.UNSAFE_root, bar)).toBeGreaterThan(
        treeIndexOf(screen.UNSAFE_root, shellRoot)
      );
    });
  });

  describe('🔴 TRIP-1557 D3·D4 · 회고 칸 (AC-3·AC-4 의 뷰 쪽)', () => {
    it('D3 콜백이 오면 회고 칸은 눌리고 onPressReflection 만 1회 부른다', () => {
      const props = renderWithBar();

      expect(screen.getByTestId(TAB_REFLECTION)).toBeEnabled();
      fireEvent.press(screen.getByTestId(TAB_REFLECTION));

      expect(props.onPressReflection).toHaveBeenCalledTimes(1);
      expect(props.onPressSummary).not.toHaveBeenCalled();
      expect(props.onPressBack).not.toHaveBeenCalled();
    });

    it('D4 콜백이 없으면(미래 일차·일정 로딩 전) 회고 칸은 비활성이고, 바의 나머지는 그대로 선다', () => {
      const props = renderWithBar({ onPressReflection: undefined });

      const tab = screen.getByTestId(TAB_REFLECTION);
      expect(tab).toBeDisabled();
      expect(tab.props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId(TAB_RECORDS)).toBeEnabled();
      expect(screen.getByTestId(BACK)).toBeEnabled();

      fireEvent.press(tab);

      expect(props.onPressSummary).not.toHaveBeenCalled();
      expect(props.onPressBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 TRIP-1557 D5·D6 · 요약 칸 (AC-5·AC-6 의 뷰 쪽, BR-U5-48 · INV-4)', () => {
    it('D5 콜백이 오면(요약 준비됨) 요약 칸은 눌리고 onPressSummary 를 1회 부르며, 비활성 사유 낭독은 없다', () => {
      const props = renderWithBar();

      const tab = screen.getByTestId(TAB_SUMMARY);
      expect(tab).toBeEnabled();
      expect(tab.props.accessibilityValue?.text).toBeUndefined();
      fireEvent.press(tab);

      expect(props.onPressSummary).toHaveBeenCalledTimes(1);
      expect(props.onPressReflection).not.toHaveBeenCalled();
    });

    it('D6 콜백이 없으면(조회 중·실패·미준비) 요약 칸은 비활성이고 「요약 준비 중」으로 읽히며 눌러도 아무 콜백도 안 불린다', () => {
      const props = renderWithBar({ onPressSummary: undefined });

      const tab = screen.getByTestId(TAB_SUMMARY);
      expect(tab).toBeDisabled();
      expect(tab.props.accessibilityState.disabled).toBe(true);
      expect(tab).toHaveAccessibilityValue({ text: '요약 준비 중' });
      // 짝 — 회고 칸은 살아 있다(요약만 비활성).
      expect(screen.getByTestId(TAB_REFLECTION)).toBeEnabled();

      fireEvent.press(tab);

      expect(props.onPressReflection).not.toHaveBeenCalled();
      expect(props.onPressBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 TRIP-1557 D7·D8 · 기록 칸과 바의 상시성', () => {
    it('D7 기록 칸(지금 화면)을 눌러도 어떤 콜백도 불리지 않는다', () => {
      const props = renderWithBar();

      fireEvent.press(screen.getByTestId(TAB_RECORDS));

      expect(props.onPressReflection).not.toHaveBeenCalled();
      expect(props.onPressSummary).not.toHaveBeenCalled();
      expect(props.onPressBack).not.toHaveBeenCalled();
      expect(screen.getByTestId(TAB_RECORDS)).toBeSelected();
    });

    it.each(['loading', 'error'] as const)(
      'D8 기록 조회가 %s 여도 바는 서 있고 뒤로가 눌린다 (나갈 길이 없는 화면 금지)',
      async (recordsStatus) => {
        holdReduceMotionOn(); // 바 뒤로는 퇴장 모션 뒤 이동한다 — 동작 줄이기 켜짐이면 즉시(TRIP-1591)
        const props = renderWithBar({ recordsStatus, cards: [], planRows: [] });
        await flushOsAnswer();

        expect(screen.getByTestId(BAR)).toBeOnTheScreen();
        fireEvent.press(screen.getByTestId(BACK));

        expect(props.onPressBack).toHaveBeenCalledTimes(1);
      }
    );
  });

  // TRIP-1280 AC-4·AC-5(FAB → 바로 옮김) — 메모를 쓰느라 키보드가 뜨면 바를 그리지 않는다(01b Q4). 시트 위치로 숨기지 않는다.
  // 실제 시트 밀림·가림 해소는 jest 사각(6-b).
  describe('키보드가 떠 있는 동안만 바가 빠진다', () => {
    it('K1 (iOS 순서) 키보드가 뜨면 바 전체(뒤로·칸 3개)가 사라지고, 내려가면 다시 나타나 눌린다', () => {
      const props = renderWithBar();
      BAR_IDS.forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());

      emitKeyboard('keyboardWillShow');
      emitKeyboard('keyboardDidShow');

      BAR_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
      // 짝 앵커 — 뷰는 그대로다(바만 빠졌다).
      expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
      expect(screen.getByTestId('record-trip-sheet-header')).toBeOnTheScreen();

      emitKeyboard('keyboardWillHide');
      emitKeyboard('keyboardDidHide');

      BAR_IDS.forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());
      fireEvent.press(screen.getByTestId(TAB_REFLECTION));
      expect(props.onPressReflection).toHaveBeenCalledTimes(1);
    });

    it('K2 (Android 순서 — Will 이벤트가 없다) Did 이벤트만으로도 사라졌다 다시 나타난다', () => {
      renderWithBar();
      expect(screen.getByTestId(BAR)).toBeOnTheScreen();

      emitKeyboard('keyboardDidShow');
      expect(screen.queryByTestId(BAR)).toBeNull();

      emitKeyboard('keyboardDidHide');
      expect(screen.getByTestId(BAR)).toBeOnTheScreen();
    });

    it('K3 화면이 사라지면 키보드 구독도 함께 푼다', () => {
      // `Keyboard` 는 처음 쓰일 때 자기 몫 리스너를 단다 — 그 뒤에 기준선을 재야 한다.
      Keyboard.isVisible();
      const listenerCounts = () =>
        KEYBOARD_EVENTS.map((name) => DeviceEventEmitter.listenerCount(name));
      const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
      const before = listenerCounts();

      const { unmount } = render(<TripRecordsView {...baseProps()} />);
      expect(sum(listenerCounts())).toBeGreaterThan(sum(before));

      unmount();
      expect(listenerCounts()).toEqual(before);
    });
  });
});

/* ──────────────── TRIP-1558 · 계획 번호 + 핀 탭 → 시트 최상단으로 올림 → 도착 뒤 목록 스크롤 ────────────────
 * 지도 핀 번호 = 그날 계획 슬롯 위치+1. 목록 항목(카드·계획 행)에 같은 번호(`planOrder`)가 실려 오고, 핀을 누르면 그 번호의
 * 항목으로 간다. 대응 키는 핀 **배열 위치(index)가 아니라 번호(number)** — 좌표 없는 슬롯이 있으면 둘이 다르다.
 * 시트 칸(j01 기본 배열): 0 닫힘 · 1 peek · 2 펼침(최상단). gorhom 은 가장 높은 칸에서만 안쪽 스크롤을 허용하므로(6-b 실측)
 * 최상단(2)이 아니면 2 로 올리라 요청하고, **시트가 2 에 도착한 뒤**(onChange)에야 스크롤을 요청한다. 이미 2 면 즉시 스크롤.
 * 목록 항목 index 는 data 위치(카드들 뒤에 계획 행들)다. 통과형 시트 목·RN FlatList 라 "요청이 나갔다"(스파이)까지만 본다 — 실제 열림·스크롤은 6-b.
 * 목은 onAnimate(이동 시작)·onChange(도착)를 스스로 쏘지 않는다 → 테스트가 host 의 prop 을 직접 부른다(실제 순서: 시작 → 도착).
 * 3동작: 준비(카드·계획 행·핀) → 실행(시트 이동 시작·도착 / 핀 탭) → 단언(snapToIndex·scrollToIndex 스파이 · 번호 leaf). */
const sheetSnapSpy = () =>
  (globalThis as Record<string, unknown>)
    .__bottomSheetSnapToIndexSpy as jest.Mock;
beforeEach(() => sheetSnapSpy().mockClear());

describe('TripRecordsView · 계획 번호 (TRIP-1558 AC-5)', () => {
  it('PN1 planOrder 를 가진 계획 행만 번호 leaf 가 서고, 없으면 노드가 없다', () => {
    renderView({
      planRows: [{ ...ROW_P3, planOrder: 3 }, ROW_P4],
    });

    expect(
      screen.getByTestId(`record-trip-plan-order-${ROW_P3.slotKey}`)
    ).toHaveTextContent('3');
    // 짝 — 행은 둘 다 있고 번호 없는 쪽엔 노드가 없다.
    expect(
      screen.getByTestId(`record-trip-plan-row-${ROW_P4.slotKey}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`record-trip-plan-order-${ROW_P4.slotKey}`)
    ).toBeNull();
  });
});

describe('TripRecordsView · 핀 탭 (TRIP-1558 AC-8·AC-9)', () => {
  let toIndex: jest.SpyInstance;
  const scrolls = () => toIndex.mock.calls.map(([arg]) => arg);

  beforeEach(() => {
    toIndex = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(() => {});
  });
  afterEach(() => toIndex.mockRestore());

  // 카드는 도착 순이라 계획 번호가 3·1 로 뒤섞여 온다. 2번 슬롯은 좌표가 없어 핀이 없고(핀 index ≠ number-1) 계획 행으로 남았다.
  // 목록 data 위치: [v-a(3), v-b(1), 행(2)] = 0·1·2 — 어떤 번호의 number-1 과도 우연히 안 겹친다.
  const CARD_A: VisitRecordCardVM = { ...DONE_CARD, planOrder: 3 };
  const CARD_B: VisitRecordCardVM = { ...UPCOMING_CARD, planOrder: 1 };
  const ROW_2: PlanRow = { ...ROW_P3, planOrder: 2 };
  const GAP_PINS: MapPin[] = [
    { number: 1, lat: 35.1532, lng: 129.1187 },
    { number: 3, lat: 35.1555, lng: 129.1216 },
  ];
  const withData = (over: Partial<TripRecordsViewProps> = {}) =>
    renderView({
      cards: [CARD_A, CARD_B],
      planRows: [ROW_2],
      mapPins: GAP_PINS,
      ...over,
    });
  const tapPin = (index: number) =>
    act(() => {
      screen.getByTestId('map-root').props.onPinTap(index);
    });
  const fireSheetAnimate = (from: number, to: number) =>
    act(() => {
      const onAnimate = probe.sheetHost().props.onAnimate as unknown;
      if (typeof onAnimate !== 'function') {
        throw new Error(
          '시트(BottomSheet)에 onAnimate 가 달려 있지 않다 — 뷰가 시트 칸을 추적해야 한다'
        );
      }
      (onAnimate as (f: number, t: number, fp: number, tp: number) => void)(
        from,
        to,
        0,
        0
      );
    });
  /** 시트가 그 칸에 **도착해 멈췄다** — host 의 onChange 를 직접 부른다(이동 시작 onAnimate 와 다른 신호). */
  const fireSheetSettle = (index: number) =>
    act(() => {
      const onChange = probe.sheetHost().props.onChange as unknown;
      if (typeof onChange !== 'function') {
        throw new Error('시트(BottomSheet)에 onChange 가 달려 있지 않다');
      }
      (onChange as (i: number, p: number, t: number) => void)(index, 0, 0);
    });
  /** 사용자가 손으로 시트를 옮긴 것 — 실제 순서대로 시작 뒤 도착. */
  const dragSheet = (from: number, to: number) => {
    fireSheetAnimate(from, to);
    fireSheetSettle(to);
  };
  const snapTargets = () => sheetSnapSpy().mock.calls.map(([index]) => index);

  it('PT1 핀 번호와 같은 planOrder 의 항목으로 스크롤 요청이 간다 — 핀 index(1)가 아니라 number(3) → 카드 v-a(data 0)', () => {
    withData();
    dragSheet(1, 2); // 사용자가 최상단(2)으로 펼쳐 둔 상태 — 올림·도착 대기 없이 즉시 스크롤하는 경로
    expect(scrolls()).toEqual([]);

    tapPin(1); // 핀 index 1 = number 3

    expect(scrolls()).toHaveLength(1);
    expect(scrolls()[0]).toEqual(expect.objectContaining({ index: 0 }));
    expect(sheetSnapSpy()).not.toHaveBeenCalled();
  });

  it('PT1b 첫 핀(index 0 · number 1)은 두 번째 카드(data 1), 번호가 계획 행에 있으면 카드 수 뒤의 행(data 2)으로 간다', () => {
    withData({
      mapPins: [
        ...GAP_PINS,
        // 번호 2 핀은 좌표가 있는 경우 — 번호 2 항목은 계획 행이다.
        { number: 2, lat: 35.1601, lng: 129.12 },
      ],
    });
    dragSheet(1, 2);

    tapPin(0);
    tapPin(2);

    expect(scrolls()).toEqual([
      expect.objectContaining({ index: 1 }),
      expect.objectContaining({ index: 2 }),
    ]);
  });

  it('PT2 시트가 peek(1)이면 최상단(2)으로 올리라고만 요청하고, 도착한 뒤에야 스크롤을 정확히 1회 요청한다 — 이동 시작은 도착이 아니다', () => {
    withData();
    expect(sheetSnapSpy()).not.toHaveBeenCalled();
    expect(scrolls()).toEqual([]);

    tapPin(1); // 마운트 직후(peek) — number 3 → data 0

    expect(snapTargets()).toEqual([2]); // peek(1)이 아니라 최상단(2)
    expect(scrolls()).toEqual([]); // 아직 도착 전

    fireSheetAnimate(1, 2); // 올라가는 중(시작 신호)
    expect(scrolls()).toEqual([]);

    fireSheetSettle(2); // 도착

    expect(scrolls()).toHaveLength(1);
    expect(scrolls()[0]).toEqual(expect.objectContaining({ index: 0 }));
    expect(snapTargets()).toEqual([2]); // 도착 뒤에 시트 요청이 더 늘지 않는다
  });

  it('PT2b 최상단(2)이면 올림 요청 없이 즉시 스크롤하고, 닫힘(0)으로 내려 둔 뒤에는 다시 최상단(2)으로 올리라고 요청한다', () => {
    withData();
    dragSheet(1, 2);

    tapPin(1);
    expect(sheetSnapSpy()).not.toHaveBeenCalled();
    expect(scrolls()).toHaveLength(1);

    dragSheet(2, 0); // 사용자가 끝까지 내림
    tapPin(1);
    expect(snapTargets()).toEqual([2]);
    expect(scrolls()).toHaveLength(1); // 도착 전

    fireSheetSettle(2);
    expect(scrolls()).toHaveLength(2);
  });

  it('PT3 같은 핀을 두 번 눌러도 두 번 스크롤을 요청한다(사용자가 그새 다른 곳으로 스크롤했을 수 있다)', () => {
    withData();
    dragSheet(1, 2);

    tapPin(1);
    tapPin(1);

    expect(scrolls()).toHaveLength(2);
  });

  it('PT3b 도착 전에 다른 핀을 누르면 마지막 핀만 스크롤된다 — 도착 뒤 낡은 요청은 되살아나지 않는다', () => {
    withData();

    tapPin(1); // number 3 → data 0 — 올림 요청
    fireSheetAnimate(1, 2); // 올라가는 중
    tapPin(0); // number 1 → data 1 — 아직 도착 전
    expect(scrolls()).toEqual([]);
    expect(snapTargets().every((index) => index === 2)).toBe(true);

    fireSheetSettle(2);

    expect(scrolls()).toEqual([expect.objectContaining({ index: 1 })]); // 첫 핀(data 0)은 나가지 않는다

    // 사용자가 내렸다가 다시 펼침 — 이미 처리한 요청이 다시 나가면 안 된다.
    dragSheet(2, 1);
    dragSheet(1, 2);
    expect(scrolls()).toHaveLength(1);
  });

  it('PT4 (금지) 번호에 해당하는 항목이 없으면 시트가 최상단이 아니어도 아무 일도 안 하고 던지지 않는다 — 시트가 올라와도 스크롤은 없다', () => {
    withData({ mapPins: [{ number: 4, lat: 35.17, lng: 129.13 }] });
    dragSheet(1, 0);
    expect(sheetSnapSpy()).not.toHaveBeenCalled();
    expect(scrolls()).toEqual([]);

    expect(() => tapPin(0)).not.toThrow();
    fireSheetSettle(2);

    expect(sheetSnapSpy()).not.toHaveBeenCalled();
    expect(scrolls()).toEqual([]);
  });

  it('PT5 (금지) 기록을 아직 못 받아 목록이 비어 있어도(로딩) 핀을 눌러 던지거나 요청하지 않는다', () => {
    withData({ cards: [], planRows: [], recordsStatus: 'loading' });
    dragSheet(1, 0);

    expect(() => tapPin(0)).not.toThrow();
    fireSheetSettle(2);

    expect(sheetSnapSpy()).not.toHaveBeenCalled();
    expect(scrolls()).toEqual([]);
  });

  // TRIP-1558 03b 2회차 경고-2 — "대기가 살아 있는 동안" 시트가 딴 칸으로 가는 경우(PT1~5 가 못 보는 가장자리).
  it.each([
    ['peek(1)', 1],
    ['닫힘(0)', 0],
  ])(
    'PT6 올라가는 도중 사용자가 시트를 %s 으로 끌어가면 대기 항목을 버린다 — 나중에 손으로 펼쳐도 옛 카드로 튀지 않는다',
    (_label, away) => {
      withData();
      tapPin(1); // number 3 → data 0 — 올림 요청 + 대기 항목

      fireSheetAnimate(2, away); // 최상단이 아닌 칸으로 이동을 시작한다
      fireSheetSettle(away);
      dragSheet(away, 2); // 한참 뒤 사용자가 손으로 최상단까지 올림
      expect(scrolls()).toEqual([]); // 옛 카드(data 0)로 안 튄다

      // 짝 — 버린 뒤에도 최상단에서의 새 핀 탭은 정상 동작한다.
      tapPin(0); // number 1 → data 1
      expect(scrolls()).toEqual([expect.objectContaining({ index: 1 })]);
    }
  );

  it('PT7 최상단이 아닌 칸에 도착(onChange 0·1)하는 것으로는 대기 스크롤이 나가지 않는다', () => {
    withData();
    tapPin(1); // peek 에서 올림 요청 + 대기 항목 — 이동 시작 신호는 일부러 안 준다(PT6 의 버림 경로와 분리)

    fireSheetSettle(1);
    fireSheetSettle(0);

    expect(scrolls()).toEqual([]);
    expect(snapTargets()).toEqual([2]); // 도착 신호가 시트 요청을 더 만들지도 않는다
  });
});
