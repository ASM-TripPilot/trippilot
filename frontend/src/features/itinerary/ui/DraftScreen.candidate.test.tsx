import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import type { DraftDayTab, DraftView } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { DraftScreen } from './DraftScreen';

/**
 * h11 초안 화면의 **슬롯 교체 트리거 계약**(TRIP-467). 동결 `DraftScreen.test.tsx`(TRIP-297~466)는
 * 손대지 않는다 — 이 파일은 별도 additive 스위트다.
 *
 * 무엇을 보장하나 — 이 칸의 존재 이유:
 *  - 🔴 **비고정 슬롯 카드에 "다른 후보 ›" 트리거가 뜨고, 누르면 그 슬롯의 slotKey 로 onPressSlot
 *    이 불린다**(AC-1). 시트를 실제로 여는 것은 배선(DraftPage)이라 여기선 **콜백까지**만 잰다.
 *  - 🔴 **고정(isFixed) 슬롯에는 트리거가 없다**(AC-2 · Q1 확정). 이게 없으면 숙소 앵커도 교체
 *    가능해지는 회귀 — 양방향 짝(비고정 존재 + 고정 부재)으로 잠근다.
 *  - **onPressSlot 을 안 넘기면 트리거가 아예 없다**(AC-5 후방호환 안전판) — 동결 화면 테스트가
 *    onPressSlot 부재로 렌더되므로, 무조건 렌더 구현이면 그 동결 테스트가 흔들린다. 여기서 미리 막는다.
 *
 * ⚠️ 트리거 testID 는 `itinerary-draft-alt-{slotKey}` 다 — 카드 접두 `itinerary-draft-slot-` **밖**이라
 *    `cardTestIds()`(동결 두 테스트) 에 카드로 오계수되지 않는다(02a 함정①).
 *
 * *(개념)* **onPressSlot** — 슬롯 카드의 "다른 후보 ›" 를 누르면 화면이 부르는 콜백. 화면은 어느
 * 시트를 어떻게 열지 모르고 이 콜백만 부른다(시트 소유는 `DraftPage` 몫).
 *
 * 3동작 뼈대: 준비=view 를 만들어 렌더 → 실행=트리거를 누른다 → 단언=콜백 인자·트리거 유무.
 */

// 지도를 관찰 마커로 바꾼다(pins 를 안 넘기면 지도가 아예 안 뜨지만, 딥 임포트 회귀 방어로 목은 건다 —
// 동결 `DraftScreen.test.tsx` 와 동형). 인라인 팩토리는 NativeWind babel 호이스트에 걸려 모듈을 require.
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
 * 하드코딩되지 않았는지 잰다(02a ★B). */
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

type Over = { onPressSlot?: (slotKey: string) => void };

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
    />
  );
}

beforeEach(() => {
  onPressSlot.mockClear();
});

describe('🔴 SC1 · AC-1 — 비고정 카드 트리거를 누르면 그 slotKey 로 onPressSlot 이 불린다', () => {
  it('비고정 두 장에 "다른 후보 ›" 가 뜨고, 둘째를 누르면 poi-b 의 slotKey 로 한 번 불린다', () => {
    renderScreen();

    // 긍정 앵커 — 비고정 카드마다 트리거가 실재한다(둘). `getByText` 는 exact 텍스트노드 매치라
    // 라벨이 드리프트하면 red 다(02a §1-B, `DraftScreen.test.tsx` C15 선례). 둘이라 getAll.
    expect(screen.getByTestId(altId('poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(altId('poi-b'))).toBeOnTheScreen();
    expect(screen.getAllByText('다른 후보 ›')).toHaveLength(2);

    // ★B — 둘째(poi-b)를 눌러 첫 슬롯 하드코딩·poiId 만 전달을 죽인다.
    fireEvent.press(screen.getByTestId(altId('poi-b')));

    expect(onPressSlot).toHaveBeenCalledTimes(1);
    expect(onPressSlot).toHaveBeenCalledWith(buildSlotKey(DAY1, 'poi-b'));
  });
});

describe('🔴 SC2 · AC-2 — 고정 슬롯에는 트리거가 없다 (Q1 확정 · 회귀 트립와이어)', () => {
  it('고정 카드엔 "다른 후보" 트리거가 부재하고, 비고정 카드엔 존재한다', () => {
    renderScreen();

    // 부정 — 고정 슬롯엔 트리거를 그리지 않는다. `isFixed` 무관 렌더 뮤테이션은 여기서 red(★A).
    expect(screen.queryByTestId(altId('poi-fixed'))).toBeNull();

    // 긍정 짝 — 비고정엔 있다. 없으면 "아무 데도 트리거 없음" 구현이 위 부정을 공짜로 통과한다.
    expect(screen.getByTestId(altId('poi-a'))).toBeOnTheScreen();
  });
});

describe('SC3 · AC-5 — onPressSlot 미배선이면 트리거가 아예 없다 (후방호환 안전판 · 선제 green)', () => {
  it('onPressSlot 없이 렌더하면 어느 카드에도 트리거가 없다 (카드는 그대로)', () => {
    // 동결 `DraftScreen.test.tsx` 의 renderScreen 은 onPressSlot 을 안 넘긴다 — 무조건 렌더
    // 구현이면 그 동결 테스트가 흔들린다. 여기서 gated 계약을 잠근다(02a 함정②).
    renderScreen({ onPressSlot: undefined });

    // 부정 — 트리거 0. 지금(구현 전)도 green, 구현 후에도 gated 라 green. 무조건 렌더면 red.
    expect(screen.queryByTestId(altId('poi-a'))).toBeNull();
    expect(screen.queryByTestId(altId('poi-b'))).toBeNull();

    // 긍정 짝 — 카드 자체는 그대로 그려진다(트리거만 없는 것이지 카드가 사라진 게 아니다).
    expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
  });
});
