import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { buildPlanDayTabs } from '@/features/itinerary/model/planState';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';

import { EditorView } from './EditorView';

/**
 * TRIP-797 · AC-1·2·3·4·5·6·8·9·10·12 (OQ-3) — h12 통일 편집기 **순수 뷰** 구조·배선.
 *
 * OQ-3: features 화면은 widgets(MapSheetShell)를 상향 참조 못 하므로, 편집기는 **pages 층 순수 뷰**가
 * MapSheetShell 을 조립한다(h07/h08 DraftPage·h14/h16 ItineraryPlanPage 선례). 이 뷰는 컨테이너 api
 * 사슬이 없어 preview.tsx 가 그대로 import 한다(TRIP-610 회피). 이 파일이 그 조립 골격·제거 대상
 * 부재·배선 콜백을 잠근다.
 *
 * ⚠️ 원리적 사각(02a ★7 · 6-b 실기 이연): 2스냅 실개폐·딤·롱프레스 드래그 실동작·드롭 삭제·빨강
 * 테두리 색. 여기선 `map-sheet-shell-root`·children·testID 트리·콜백 발화·`isDragging` 표면 전환만.
 *
 * 3동작 뼈대: 준비=days/slots/콜백 주입 렌더 → 실행=렌더/press → 단언=골격·부재·콜백·CTA 상태.
 */

// 지도는 네이버 네이티브라 jest 에서 못 뜬다 — 관찰 목으로 map-root 를 노출(MapSheetShell.test 조합).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const DATE = '2026-06-10';
const DATE2 = '2026-06-11';
const CENTER = { lat: 35.1532, lng: 129.1188 };

type EditorSlot = Omit<ItineraryDaysItemSlotsItem, 'startAt'> & {
  startAt: string | null;
};

function slot(poiId: string, overrides: Partial<EditorSlot> = {}): EditorSlot {
  return {
    poiId,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: ['바다'],
    nameKo: `장소-${poiId}`,
    ...overrides,
  };
}

/** 활성 일자 슬롯을 서버 타입 days 로 감싸 PlanDayTab 을 만든다(미지정 null 은 표시용이라 캐스트). */
function daysOf(...dates: string[]): ItineraryDaysItem[] {
  return dates.map((date) => ({ date, slots: [] }));
}

function renderView(
  overrides: Partial<Parameters<typeof EditorView>[0]> = {}
): {
  onSelectDay: jest.Mock;
  onPressTimeChip: jest.Mock;
  onPressAddPlace: jest.Mock;
  onPressAddBetween: jest.Mock;
  onSave: jest.Mock;
} {
  const cb = {
    onSelectDay: jest.fn(),
    onPressTimeChip: jest.fn(),
    onPressAddPlace: jest.fn(),
    onPressAddBetween: jest.fn(),
    onSave: jest.fn(),
  };
  render(
    <EditorView
      center={CENTER}
      days={buildPlanDayTabs(daysOf(DATE))}
      slots={[]}
      activeDayIndex={0}
      activeDate={DATE}
      onBack={jest.fn()}
      {...cb}
      {...overrides}
    />
  );
  return cb;
}

describe('🔴 EditorView · B4-1 — empty 얼굴(AC-1·AC-8·AC-10·AC-12)', () => {
  it('셸 골격·헤더 0곳·비활성 CTA·점선 장소추가·안내줄을 그린다', () => {
    renderView({ slots: [] });

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('0곳');
    // CTA "일정 저장하기" 는 0곳이면 비활성(AC-10).
    const cta = screen.getByTestId('sheet-cta-button-0');
    expect(cta).toHaveTextContent('일정 저장하기');
    expect(cta).toBeDisabled();
    // 점선 장소추가(AC-8) + 안내줄(AC-12).
    expect(screen.getByTestId('itinerary-edit-add-place')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-guide')).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · B4-2 — filled 얼굴(AC-2)', () => {
  it('슬롯 카드를 그리고 CTA 가 활성이며 헤더 곳수가 맞다', () => {
    renderView({ slots: [slot('a'), slot('b')] });

    expect(
      screen.getByTestId(`slot-stopcard-${buildSlotKey(DATE, 'a')}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`slot-stopcard-${buildSlotKey(DATE, 'b')}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('2곳');
    expect(screen.getByTestId('sheet-cta-button-0')).not.toBeDisabled();
  });
});

describe('🔴 EditorView · B4-3 — 제거 대상 부재(AC-3, 긍정 짝 동반)', () => {
  it('히어로·시간대밴드·"Day N"·"지도는 곧"·"다른 후보"·핸들이 없다', () => {
    renderView({ slots: [slot('a'), slot('b')] });

    // 긍정 짝 — 화면 자체는 떠 있다(공허 통과 방지).
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();

    // 제거 대상 부재.
    expect(screen.queryByText('지도는 곧 제공돼요')).toBeNull();
    expect(screen.queryByText('다른 후보 ›')).toBeNull();
    expect(screen.queryByText('오전')).toBeNull();
    expect(screen.queryByText('점심')).toBeNull();
    expect(screen.queryByText(/^Day \d/)).toBeNull(); // "Day 1" → "1일차" 로 대체
  });
});

describe('🔴 EditorView · B4-4 — day-chip 다일자(AC-4)', () => {
  it('일차 칩 press 가 onSelectDay 를 부르고 헤더가 활성 일자를 반영한다', () => {
    const cb = renderView({
      days: buildPlanDayTabs(daysOf(DATE, DATE2)),
      slots: [slot('a')],
    });

    fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
    expect(cb.onSelectDay).toHaveBeenCalledTimes(1);
    expect(cb.onSelectDay).toHaveBeenCalledWith(1);
    // 헤더는 선택 일자(activeDayIndex 0 = 1일차) 반영.
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
  });
});

describe('🔴 EditorView · B4-5 — 시각칩 → 시트 콜백(AC-5 · INV-U3-03)', () => {
  it('비고정 카드 시각칩 press 는 slotKey 로 콜백, 고정 카드는 누름 칩이 없다', () => {
    const keyA = buildSlotKey(DATE, 'a');
    const keyFix = buildSlotKey(DATE, 'fix');
    const cb = renderView({
      slots: [slot('a'), slot('fix', { isFixed: true })],
    });

    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${keyA}`));
    expect(cb.onPressTimeChip).toHaveBeenCalledWith(keyA);

    // 고정 슬롯은 시각 불변(INV-U3-03) — 편집 어포던스 미부착.
    expect(screen.queryByTestId(`slot-stopcard-timechip-${keyFix}`)).toBeNull();
  });
});

describe('🔴 EditorView · B4-6 — 미지정 칩(AC-6)', () => {
  it('startAt 이 null 인 슬롯은 "시간대 설정" 칩으로 뜬다', () => {
    renderView({ slots: [slot('u', { startAt: null })] });
    expect(screen.getByText('시간대 설정')).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · B4-7 — 카드 사이 + 삽입(AC-7 배선)', () => {
  it('카드 사이 + press 가 선행 슬롯 index 로 onPressAddBetween 을 부른다', () => {
    const cb = renderView({ slots: [slot('a'), slot('b')] });
    fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));
    expect(cb.onPressAddBetween).toHaveBeenCalledWith(0);
  });
});

describe('🔴 EditorView · B4-8 — CTA 저장(AC-10)', () => {
  it('채운 상태에서 저장 CTA press 가 onSave 를 부른다', () => {
    const cb = renderView({ slots: [slot('a')] });
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    expect(cb.onSave).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 EditorView · B4-9 — dragging 얼굴(AC-9)', () => {
  it('isDragging 이면 드롭존이 CTA 자리를 대체한다', () => {
    renderView({ slots: [slot('a'), slot('b')], isDragging: true });

    expect(screen.getByTestId('itinerary-edit-dropzone')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-edit-dropzone-active')
    ).toBeOnTheScreen();
    // 드래그 중엔 저장 CTA 자리가 드롭존으로 대체된다.
    expect(screen.queryByTestId('sheet-cta-button-0')).toBeNull();
  });
});
