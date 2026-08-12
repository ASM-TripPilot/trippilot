import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { ItineraryEditScreen } from './ItineraryEditScreen';

/**
 * TRIP-302 · h24 편집 화면의 **시각조정 진입 계약**(슬라이스3 · AC-T1·AC-T2·AC-T8).
 *
 * 화면은 슬라이스1 그대로 **순수 컴포넌트**다 — 새로 지는 유일한 책임은 비고정 시각칩을 누르면
 * 새 선택 prop `onEditSlotTime?(slotKey)`를 발화하는 것뿐이다. 시트 개폐·스토어는 여전히 모른다
 * (페이지 몫). 고정 슬롯은 시각이 불변이라(INV-U3-03) 시각칩에 onPress 를 붙이지 않는다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **비고정 시각칩 press → onEditSlotTime(slotKey)**(AC-T1).
 *  - 🔴 **고정 시각칩 press → 아무 콜백도 안 부른다**(AC-T2 · onPress 부재).
 *  - 🔴 **onEditSlotTime 미전달이면 press 가 무해**(AC-T8 · 순수성 · 프로즌 C5 생존, 02a ★5).
 *    `onSave?` 처럼 undefined 면 no-op 인 선택 prop 이라 프로즌 렌더 계약이 안 깨진다.
 *
 * *(개념)* **선택 prop(`?`)** — 넘겨도 되고 안 넘겨도 되는 콜백. 안 넘기면 옵셔널 체이닝
 * (`onEditSlotTime?.(...)`)으로 아무 일도 안 일어난다 — 그래서 이 prop 을 모르는 프로즌 테스트가
 * 그대로 통과한다.
 *
 * 3동작 뼈대: 준비=슬롯 2장(고정/비고정)으로 렌더 → 실행=시각칩 press → 단언=불린 콜백.
 */

// draggable-flatlist 는 reanimated/gesture 네이티브 런타임 의존 → 수동 목(프로즌 화면 테스트 선례).
jest.mock('react-native-draggable-flatlist');

type Slot = ItineraryDaysItemSlotsItem;

const DAY1 = '2026-06-10';

function slot(over: Partial<Slot> & { poiId: string }): Slot {
  return {
    startAt: '10:15:00',
    endAt: '11:45:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

const FIXED = slot({
  poiId: 'poi-fixed',
  isFixed: true,
  nameKo: '제주 신라스테이',
});
const NORMAL = slot({
  poiId: 'poi-normal',
  nameKo: '해운대 해수욕장',
  tags: ['바다'],
});
const SLOTS: Slot[] = [FIXED, NORMAL];

const DAYS: PlanDayTab[] = [{ dayIndex: 1, date: DAY1, count: SLOTS.length }];

const key = (poiId: string) => buildSlotKey(DAY1, poiId);

const onSelectDay = jest.fn();
const onBack = jest.fn();
const onDeleteSlot = jest.fn();
const onReorder = jest.fn();

function renderScreen(
  over: Partial<Parameters<typeof ItineraryEditScreen>[0]> = {}
) {
  return render(
    <ItineraryEditScreen
      days={DAYS}
      slots={SLOTS}
      activeDayIndex={0}
      onSelectDay={onSelectDay}
      onBack={onBack}
      onDeleteSlot={onDeleteSlot}
      onReorder={onReorder}
      {...over}
    />
  );
}

beforeEach(() => {
  onSelectDay.mockClear();
  onBack.mockClear();
  onDeleteSlot.mockClear();
  onReorder.mockClear();
});

describe('🔴 SC1 · AC-T1 — 비고정 시각칩 press → onEditSlotTime(slotKey)', () => {
  it('그 슬롯의 slotKey 를 넘긴다', () => {
    const onEditSlotTime = jest.fn();
    renderScreen({ onEditSlotTime });

    fireEvent.press(
      screen.getByTestId(`itinerary-edit-slot-time-${key('poi-normal')}`)
    );

    expect(onEditSlotTime).toHaveBeenCalledTimes(1);
    expect(onEditSlotTime).toHaveBeenCalledWith(key('poi-normal'));
  });
});

describe('🔴 SC2 · AC-T2 — 고정 시각칩 press → 아무 콜백도 안 부른다 (INV-U3-03)', () => {
  it('고정 슬롯은 시각이 불변이라 시각조정이 열리지 않는다(onPress 부재)', () => {
    const onEditSlotTime = jest.fn();
    renderScreen({ onEditSlotTime });

    fireEvent.press(
      screen.getByTestId(`itinerary-edit-slot-time-${key('poi-fixed')}`)
    );

    // 짝 — SC1 이 비고정 발화 긍정 앵커. 여기선 고정이라 0회.
    expect(onEditSlotTime).not.toHaveBeenCalled();
  });
});

describe('🔴 SC3 · AC-T8 — onEditSlotTime 미전달이면 시각칩 press 가 무해하다 (순수성)', () => {
  it('prop 을 안 줘도 press 가 던지지 않고 편집 콜백도 안 불린다(프로즌 C5 생존)', () => {
    // onEditSlotTime 을 **주지 않는다** — 이 prop 을 모르는 프로즌 C5 와 같은 조건.
    renderScreen();

    // throw 없이 무해해야 한다(undefined → no-op).
    fireEvent.press(
      screen.getByTestId(`itinerary-edit-slot-time-${key('poi-normal')}`)
    );

    expect(onDeleteSlot).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });
});
