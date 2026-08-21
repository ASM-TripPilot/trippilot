import type { ReactNode } from 'react';
import { View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import type { DraftDayTab, DraftView } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { DraftScreen } from './DraftScreen';

/**
 * h11 초안 화면의 **슬롯 교체 표면 계약**.
 *  - SC1~3(TRIP-467, 계승): 비고정 슬롯 "다른 후보 ›" 트리거 → `onPressSlot(slotKey)`.
 *  - SC4~6(TRIP-483, 신규): **인라인 교체 패널을 그 카드 아래에 배치**(바텀시트 폐기) · 하단
 *    manual 어포던스 2개 · reason 부제.
 *
 * 동결 `DraftScreen.test.tsx`(TRIP-297~483)는 라벨 1줄만 함께 갱신하고, 이 파일은 별도 additive
 * 스위트다.
 *
 * 무엇을 보장하나(TRIP-483 신규):
 *  - 🔴 **패널은 화면이 그린다 — `expandedSlotKey` 와 일치하는 카드 slotKey 로만 `renderSlotPanel`
 *    이 불린다**(AC-1 · ★B). 어느 카드 아래인지(위치)를 slotKey 바인딩으로 잰다. 픽셀 "바로 아래"는
 *    6-b 몫. 한 번에 한 슬롯(마커 1개).
 *  - 🔴 **하단 「처음부터 직접」·우상단 「직접 고르기」 → onManualPlan**(AC-4). 미배선이면 둘 다 부재
 *    (gated 짝 — 死버튼 회피).
 *  - 🔴 **reason 부제 1줄**(AC-5).
 *
 * *(개념)* **renderSlotPanel** — 패널의 *내용*(후보 조회·선택·PUT)은 배선(`DraftPage`)이 조립해
 * 함수로 내려주고, 화면은 그것을 **올바른 카드 아래 자리에만** 부른다. 화면은 위치만, 배선은 내용.
 *
 * 3동작 뼈대: 준비=view/prop 을 만들어 렌더 → 실행=press/렌더 → 단언=콜백·요소.
 */

// 지도를 관찰 마커로 바꾼다(pins 를 안 넘기면 지도가 안 뜨지만, 딥 임포트 회귀 방어로 목은 건다).
// 인라인 팩토리는 NativeWind babel 호이스트에 걸려 모듈을 require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const DAY1 = '2026-06-10';

function slot(
  over: Partial<ItineraryDaysItemSlotsItem> & { poiId: string }
): ItineraryDaysItemSlotsItem {
  return {
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

/** 고정 블록(숙소 앵커) — 트리거가 없어야 하는 슬롯. */
const FIXED = slot({
  poiId: 'poi-fixed',
  startAt: '21:00:00',
  isFixed: true,
  nameKo: '제주 신라스테이',
});
/** 비고정 두 장 — 둘 다 트리거가 있어야 한다. 둘째(poi-b)를 눌러 slotKey 가 첫 슬롯으로
 * 하드코딩되지 않았는지 잰다(★B). */
const NONFIXED_A = slot({
  poiId: 'poi-a',
  nameKo: '성산일출봉',
  tags: ['바다'],
});
const NONFIXED_B = slot({
  poiId: 'poi-b',
  startAt: '12:30:00',
  nameKo: '광안리',
});

const DAYS: ItineraryDaysItem[] = [
  { date: DAY1, slots: [FIXED, NONFIXED_A, NONFIXED_B] },
];
const TABS: DraftDayTab[] = [{ date: DAY1, dayNumber: 1, hasData: true }];

const onPressSlot = jest.fn();

function altId(poiId: string): string {
  return `itinerary-draft-alt-${buildSlotKey(DAY1, poiId)}`;
}
function cardId(poiId: string): string {
  return `itinerary-draft-slot-${buildSlotKey(DAY1, poiId)}`;
}
function markerId(poiId: string): string {
  return `panel-marker-${buildSlotKey(DAY1, poiId)}`;
}

type Over = {
  onPressSlot?: (slotKey: string) => void;
  expandedSlotKey?: string | null;
  renderSlotPanel?: (slotKey: string) => ReactNode;
  onManualPlan?: () => void;
};

function renderScreen(over: Over = { onPressSlot }) {
  const view: DraftView = { kind: 'listed', days: DAYS, staleFailed: false };
  return render(
    <DraftScreen
      view={view}
      tabs={TABS}
      selectedDate={DAY1}
      pins={[]}
      dayHeader="6월 10일 · 수"
      canRetry
      onSelectDay={jest.fn()}
      onRetry={jest.fn()}
      onBack={jest.fn()}
      onComplete={jest.fn()}
      onPressSlot={over.onPressSlot}
      expandedSlotKey={over.expandedSlotKey}
      renderSlotPanel={over.renderSlotPanel}
      onManualPlan={over.onManualPlan}
    />
  );
}

beforeEach(() => {
  onPressSlot.mockClear();
});

describe('🔴 SC1 · AC-1 — 비고정 카드 트리거를 누르면 그 slotKey 로 onPressSlot 이 불린다', () => {
  it('비고정 두 장에 "다른 후보 ›" 가 뜨고, 둘째를 누르면 poi-b 의 slotKey 로 한 번 불린다', () => {
    renderScreen();

    expect(screen.getByTestId(altId('poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(altId('poi-b'))).toBeOnTheScreen();
    expect(screen.getAllByText('다른 후보 ›')).toHaveLength(2);

    fireEvent.press(screen.getByTestId(altId('poi-b')));

    expect(onPressSlot).toHaveBeenCalledTimes(1);
    expect(onPressSlot).toHaveBeenCalledWith(buildSlotKey(DAY1, 'poi-b'));
  });
});

describe('🔴 SC2 · AC-2 — 고정 슬롯에는 트리거가 없다 (회귀 트립와이어)', () => {
  it('고정 카드엔 "다른 후보" 트리거가 부재하고, 비고정 카드엔 존재한다', () => {
    renderScreen();

    expect(screen.queryByTestId(altId('poi-fixed'))).toBeNull();
    expect(screen.getByTestId(altId('poi-a'))).toBeOnTheScreen();
  });
});

describe('SC3 · AC-후방호환 — onPressSlot 미배선이면 트리거가 아예 없다 (안전판 · 선제 green)', () => {
  it('onPressSlot 없이 렌더하면 어느 카드에도 트리거가 없다 (카드는 그대로)', () => {
    renderScreen({ onPressSlot: undefined });

    expect(screen.queryByTestId(altId('poi-a'))).toBeNull();
    expect(screen.queryByTestId(altId('poi-b'))).toBeNull();
    expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
  });
});

describe('🔴 SC4 · AC-1 — 패널은 expandedSlotKey 와 일치하는 카드 아래에만, 한 번에 하나 (★B 위치)', () => {
  it('expandedSlotKey=poi-b 면 poi-b 의 slotKey 로만 renderSlotPanel 이 불리고 마커가 1개 뜬다', () => {
    const renderSlotPanel = jest.fn((slotKey: string) => (
      <View testID={`panel-marker-${slotKey}`} />
    ));
    renderScreen({
      onPressSlot,
      expandedSlotKey: buildSlotKey(DAY1, 'poi-b'),
      renderSlotPanel,
    });

    // 한 번에 한 슬롯 — 마커가 정확히 하나다(모든 카드 아래 렌더 뮤테이션은 여기서 red).
    expect(screen.getAllByTestId(/^panel-marker-/)).toHaveLength(1);
    // 열린 카드는 poi-b 다(긍정) — 그리고 poi-a 아래엔 패널이 없다(부정 짝).
    expect(screen.getByTestId(markerId('poi-b'))).toBeOnTheScreen();
    expect(screen.queryByTestId(markerId('poi-a'))).toBeNull();
    // 위치 = 올바른 카드 바인딩: 화면이 poi-b 의 slotKey 로 패널을 부른다(첫 슬롯 하드코딩 살상).
    expect(renderSlotPanel).toHaveBeenCalledWith(buildSlotKey(DAY1, 'poi-b'));
  });

  it('expandedSlotKey=null 이면 패널이 없고 renderSlotPanel 이 0회 불린다 (항상 렌더 살상)', () => {
    const renderSlotPanel = jest.fn((slotKey: string) => (
      <View testID={`panel-marker-${slotKey}`} />
    ));
    renderScreen({ onPressSlot, expandedSlotKey: null, renderSlotPanel });

    expect(screen.queryAllByTestId(/^panel-marker-/)).toEqual([]);
    expect(renderSlotPanel).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 SC5 · AC-4 — 「처음부터 직접」·「직접 고르기」 → onManualPlan (gated)', () => {
  it('두 어포던스가 뜨고 각각 누르면 onManualPlan 이 불린다', () => {
    const onManualPlan = jest.fn();
    renderScreen({ onPressSlot, onManualPlan });

    const bottom = screen.getByTestId('itinerary-draft-manual');
    const topLink = screen.getByTestId('itinerary-draft-pick-manual');
    expect(bottom).toBeOnTheScreen();
    expect(topLink).toBeOnTheScreen();
    expect(screen.getByText('처음부터 직접')).toBeOnTheScreen();
    expect(screen.getByText('직접 고르기')).toBeOnTheScreen();

    fireEvent.press(bottom);
    fireEvent.press(topLink);
    expect(onManualPlan).toHaveBeenCalledTimes(2);
  });

  it('onManualPlan 미배선이면 두 어포던스가 아예 없다 (gated 짝 · 死버튼 회피)', () => {
    renderScreen({ onPressSlot, onManualPlan: undefined });

    expect(screen.queryByTestId('itinerary-draft-manual')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-pick-manual')).toBeNull();
  });
});

describe('🔴 SC6 · AC-5 — reason 블록에 부제 1줄(정적)', () => {
  it('listed(非생성중) 얼굴에 부제가 정확한 문구로 뜬다', () => {
    renderScreen();

    const subtitle = screen.getByTestId('itinerary-draft-reason-subtitle');
    // leaf 가 이 문장뿐이라 문자열 완전일치(RNTL toHaveTextContent 기본 exact, 02a §1-B 실측).
    expect(subtitle).toHaveTextContent(
      '슬롯 하나만 다른 후보로 바꿔도 좋고 — 나머지는 그대로'
    );
  });
});
