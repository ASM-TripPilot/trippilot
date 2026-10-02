import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, View } from 'react-native';
import {
  getAnimatedStyle,
  isSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Path } from 'react-native-svg';
import type { ReactTestInstance } from 'react-test-renderer';

import { MemoInline } from '@/features/attach-visit-media/index.view';
import { NoteGlyph } from '@/features/record';
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

/**
 * TRIP-1085 · j01 방문 기록 **순수 뷰**(pages · 셸 조립) — 전면 지도 + 바텀시트(MapSheetShell).
 *
 * 무엇을 보장하나:
 *  - 골격(AC-1): 셸 지도 하나가 시트 뒤에 있고 카드는 시트 안이다. 하단 탭바·옛 250px 지도 블록은 없다.
 *  - 시트 헤더(AC-12): "여행명 · N일차 · M월 D일(요일) · N곳" 한 줄. 여행명이 없으면 그 조각만 빠진다.
 *  - 일차 칩·뒤로(AC-2·3): 셸 칩(`sheet-daychip-{index}`)이 일자를, `sheet-daychip-back` 이 뒤로를 올린다.
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
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';

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

  it('V4 ‹(sheet-daychip-back)를 누르면 onPressBack 이 1회 불리고, 옛 record-trip-back 은 없다', () => {
    const props = renderView();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

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
  it('V8 지도는 잠겨 있고(viewOnly) 핀 전부 맞추기(fitPins)가 켜져 있으며, 받은 핀을 그대로 넘긴다', () => {
    renderView();

    const map = screen.getByTestId('map-root');
    expect(map.props.viewOnly).toBe(true);
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
  const BANNER_TITLE = 'GPS 미동의 — 수동 체크인으로 기록해요';

  const BANNER_BODY =
    '위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요. 방문한 장소를 직접 선택해 기록하세요.';

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

describe('「오늘의 회고」 FAB', () => {
  // TRIP-1088 (옛 TripRecordsView.reflectionFab.test.tsx)
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
      expect(
        ancestorsOf(anchor).map((node) => node.props.testID)
      ).not.toContain('map-sheet-shell-root');
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
});
