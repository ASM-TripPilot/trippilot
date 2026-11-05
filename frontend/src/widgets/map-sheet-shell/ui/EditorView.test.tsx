import { StyleSheet } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import DraggableFlatList, * as DraggableModule from 'react-native-draggable-flatlist';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/index.schemas';
import { buildPlanDayTabs } from '@/features/itinerary/index.view';
import { buildSlotKey, violationNotice } from '@/entities/itinerary-slot';
import {
  EDIT_LIST,
  editListData,
  fireEditDragBegin,
  fireEditDragEnd,
  fireEditDropOnZone,
  hoverOverDeleteZone,
} from '@/test-support/editDragList';

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
 *
 * **TRIP-921 이동**: 뷰가 `pages/itinerary-edit` → `widgets/map-sheet-shell/ui` 로 승격돼(두 페이지가
 * 같은 뷰를 소비) 이 파일도 따라왔다. 위젯은 features 를 못 물어 헤더 날짜를 **`dateLabel` 문자열로
 * 받는다**(포맷 판정은 페이지 테스트 E0·M1 과 프리뷰 테스트 몫, 02a ★8). 아래 D1~D8 은 드래그 실배선
 * — 리스트 끝 센티널 판정(재정렬 vs 드롭 삭제)·고정/완료 금지·드래그 중 얼굴 — 을 잠근다. 목은 손가락을
 * 못 움직이므로 `@/test-support/editDragList` 가 라이브러리와 같은 배열 이동으로 onDragEnd 를 발화한다.
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
    alternatives: [],
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
  onReorder: jest.Mock;
  onDeleteViaDrag: jest.Mock;
} {
  const cb = {
    onSelectDay: jest.fn(),
    onPressTimeChip: jest.fn(),
    onPressAddPlace: jest.fn(),
    onPressAddBetween: jest.fn(),
    onSave: jest.fn(),
    onReorder: jest.fn(),
    onDeleteViaDrag: jest.fn(),
  };
  render(
    <EditorView
      center={CENTER}
      days={buildPlanDayTabs(daysOf(DATE))}
      slots={[]}
      activeDayIndex={0}
      activeDate={DATE}
      dateLabel="6월 10일(수)"
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
    // 점선 장소추가(AC-8). 끌어 바꿀 카드가 없어 끌기 안내줄은 없다(TRIP-1440 Q-141 — 옛 AC-12 는 카드 있을 때만).
    expect(screen.getByTestId('itinerary-edit-add-place')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-edit-guide')).toBeNull();
    // 0곳에도 장소 추가 즉시 저장 안내는 남는다(TRIP-1424) — 끌기 안내줄만 숨는다.
    expect(
      screen.getByTestId('itinerary-edit-add-saved-hint')
    ).toBeOnTheScreen();
  });
});

describe('TRIP-1440 Q-141 · 편집기 머리 제목 가산 prop', () => {
  it('title 을 넘기면 그 제목, 안 넘기면 기본 "일정 편집"이다', () => {
    renderView({ title: '일정 만들기' });
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '일정 만들기'
    );
    screen.unmount();

    renderView({ slots: [slot('a')] });
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '일정 편집'
    );
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

// B4-3(제거 대상 부재 — 히어로·시간대밴드·"Day N" 등 not-in-DOM 단언)은 TRIP-1356 에서 지웠다(README 판정 3: 구조·기능 회귀 부재 단언).

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

// TRIP-1674 — 시각 편집 허용 규칙: 숙소가 아닌 고정(꼭 갈 곳)도 누른다. 고정 숙소(BR-U3-07)·방문 완료만 잠긴다.
// 칩 모양(⌄)은 생김새라 단언하지 않는다 — 칩의 존재와 누름 → 콜백만 본다.
describe('🔴 EditorView · B4-5 — 시각칩 → 시트 콜백(AC-5 · INV-U3-03)', () => {
  const chip = (poiId: string): string =>
    `slot-stopcard-timechip-${buildSlotKey(DATE, poiId)}`;

  it('비고정 카드 시각칩 press 는 slotKey 로 콜백한다 — 비고정 숙소도 눌린다', () => {
    const cb = renderView({
      slots: [slot('a'), slot('stay', { category: '숙소' })],
    });

    fireEvent.press(screen.getByTestId(chip('a')));
    expect(cb.onPressTimeChip).toHaveBeenLastCalledWith(
      buildSlotKey(DATE, 'a')
    );
    // 막는 조건은 "고정 + 숙소"의 곱이다 — 숙소라는 이유만으로 막으면 여기서 red.
    fireEvent.press(screen.getByTestId(chip('stay')));
    expect(cb.onPressTimeChip).toHaveBeenLastCalledWith(
      buildSlotKey(DATE, 'stay')
    );
  });

  it('고정 비숙소(꼭 갈 곳) 카드도 시각칩 press 가 slotKey 로 콜백한다', () => {
    const cb = renderView({
      slots: [slot('must', { isFixed: true, category: '명소' })],
    });

    fireEvent.press(screen.getByTestId(chip('must')));

    expect(cb.onPressTimeChip).toHaveBeenCalledTimes(1);
    expect(cb.onPressTimeChip).toHaveBeenCalledWith(buildSlotKey(DATE, 'must'));
  });

  it('category 가 없는 고정 슬롯도 눌린다 — 숙소임을 알 수 없으면 막지 않는다(3-a ⑤ fail-open 수용)', () => {
    const cb = renderView({ slots: [slot('fix', { isFixed: true })] });

    fireEvent.press(screen.getByTestId(chip('fix')));

    expect(cb.onPressTimeChip).toHaveBeenCalledWith(buildSlotKey(DATE, 'fix'));
  });

  it('고정 숙소 카드는 누름 시각칩이 없다 — 시각은 읽기 전용으로 보이고, 같은 화면의 꼭 갈 곳은 눌린다', () => {
    const stayKey = buildSlotKey(DATE, 'stay');
    const cb = renderView({
      slots: [
        slot('stay', { isFixed: true, category: '숙소' }),
        slot('must', { isFixed: true, category: '명소' }),
      ],
    });

    expect(screen.queryByTestId(chip('stay'))).toBeNull();
    // 짝 — 숙소 카드는 시각을 숨기지 않고 평평한 알약으로 보인다 / 꼭 갈 곳은 칩이 있다(공허 통과 방지).
    expect(
      screen.getByTestId(`slot-stopcard-time-${stayKey}`)
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(chip('must')));
    expect(cb.onPressTimeChip).toHaveBeenCalledTimes(1);
    expect(cb.onPressTimeChip).not.toHaveBeenCalledWith(stayKey);
  });

  it('방문 완료 슬롯은 고정 비숙소여도 잠긴다 — 칩이 없고 잠금 표식만 있다 (i07)', () => {
    const doneKey = buildSlotKey(DATE, 'done');
    renderView({
      slots: [
        slot('done', { isFixed: true, category: '명소' }),
        slot('open', { isFixed: true, category: '명소' }),
      ],
      completedSlotKeys: [doneKey],
    });

    expect(
      screen.getByTestId(`slot-stopcard-locked-${doneKey}`)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(chip('done'))).toBeNull();
    // 짝 — 완료가 아닌 고정 비숙소는 눌린다.
    expect(screen.getByTestId(chip('open'))).toBeOnTheScreen();
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

/**
 * TRIP-1038 B1·B6 — CTA 라벨은 소비처가 주입한다(`saveLabel`). 직접 짜기만 「저장하고 확정하기」를 넘기고,
 * 안 넘기는 h12 일정 편집·i07 은 위 B4-1 의 기본 「일정 저장하기」 그대로다. 라벨만 바뀌고 0곳 비활성·press
 * 콜백 규칙은 같다.
 */
describe('🔴 EditorView · L1 — 주입 라벨 saveLabel (TRIP-1038 B1)', () => {
  it('saveLabel 을 넘기면 CTA 글자가 그 값과 완전일치하고, press 는 onSave 1회다', () => {
    const cb = renderView({
      slots: [slot('a')],
      saveLabel: '저장하고 확정하기',
    });

    const cta = screen.getByTestId('sheet-cta-button-0');
    expect(cta).toHaveTextContent('저장하고 확정하기');
    fireEvent.press(cta);
    expect(cb.onSave).toHaveBeenCalledTimes(1);
  });

  it('주입 라벨이어도 0곳이면 비활성이다 (AC-10 규칙 불변)', () => {
    renderView({ slots: [], saveLabel: '저장하고 확정하기' });

    const cta = screen.getByTestId('sheet-cta-button-0');
    expect(cta).toHaveTextContent('저장하고 확정하기');
    expect(cta).toBeDisabled();
  });
});

// B4-9(isDragging 이면 드롭존이 CTA 를 대체)는 TRIP-1356 에서 지웠다 — 아래 D7 이 같은 단언(드롭존 활성·CTA 없음)에 + 자리 보존까지 더한 상위 집합이다.

// ── TRIP-753 · i07 일정 편집(inTrip) — h12 편집기를 여행 중 편집으로 재사용 ──────────────────────
//
// Figma 4313:2100 픽스처: 2일차(6/11) 5곳, 앞 두 곳은 방문 완료, 행 3 은 위반. 완료·위반은 모드가
// 아니라 데이터(completedSlotKeys·hasViolation)가 정한다 — inTrip 이 바꾸는 것은 카드 사이 + 의 잠김
// 판정(TRIP-1115, 아래 V6)과 안내 문구 둘뿐이다(Q5). 드래그·시트 실개폐는 jest 사각(02a ★8) — 콜백·트리 모양까지만 본다.

const I07_DATE = '2026-06-11';

const I07_SLOTS: EditorSlot[] = [
  slot('p1', {
    startAt: '09:30:00',
    endAt: '10:30:00',
    nameKo: '감천문화마을',
    tags: ['마을', '벽화'],
  }),
  slot('p2', {
    startAt: '11:00:00',
    endAt: '12:00:00',
    nameKo: '광안리 해변',
    tags: ['바다', '산책'],
  }),
  slot('p3', {
    startAt: '13:00:00',
    endAt: '14:30:00',
    nameKo: '부산시립미술관',
    tags: ['미술', '실내'],
    hasViolation: true,
    alternatives: [],
    violationReason: '숙소 고정 충돌',
  }),
  slot('p4', {
    startAt: '15:00:00',
    endAt: '16:30:00',
    nameKo: '전포 카페거리',
    tags: ['카페', '실내'],
  }),
  slot('p5', {
    startAt: '17:00:00',
    endAt: '18:30:00',
    nameKo: '해운대 해변',
    tags: ['바다', '해변'],
  }),
];

const k = (poiId: string): string => buildSlotKey(I07_DATE, poiId);
const I07_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5'].map(k);

const I07_GUIDE =
  '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요';
const H12_GUIDE = '길게 눌러 순서를 바꾸거나, 아래로 끌어 삭제해요';

function renderI07(
  overrides: Partial<Parameters<typeof EditorView>[0]> = {}
): ReturnType<typeof renderView> {
  return renderView({
    days: buildPlanDayTabs(daysOf('2026-06-10', I07_DATE, '2026-06-12')),
    slots: I07_SLOTS,
    activeDayIndex: 1,
    activeDate: I07_DATE,
    // TRIP-921 — 위젯은 포맷터(features)를 못 물어 페이지가 만든 문자열을 받는다(02a D-2).
    dateLabel: '6월 11일(목)',
    completedSlotKeys: [k('p1'), k('p2')],
    ...overrides,
  });
}

describe('🔴 EditorView · V1 — 헤더 날짜 괄호형 + 시트 펼침 (TRIP-753 AC-2)', () => {
  it('2일차 6/11 헤더를 "일정 편집 · 2일차 · 6월 11일(목) · 5곳" 조각으로 그리고 시트를 펼침(88%) 칸으로 연다', () => {
    renderI07();

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '일정 편집'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('5곳');
    // 시트 펼침(88%) 칸 값 단언은 jest-cut 에서 뺐다 — 통과형 시트 목 prop 이다(README 판정 4).
  });
});

// V2(번호 원이 카드 밖·완료 초록/예정 빨강 톤)는 jest-cut 에서 지웠다 — 트리 위치·색 토큰이라 실화면 QA 몫(itinerary-edit.md).

describe('🔴 EditorView · V3 — 방문 완료 행은 회색 알약만, 자물쇠 배지 없음 (TRIP-753 AC-4)', () => {
  it('완료 행은 누름 칩 없이 muted 알약에 시각을 그리고, 잠금 표식은 그 알약 자체다', () => {
    renderI07();

    [
      [k('p1'), '09:30–10:30'],
      [k('p2'), '11:00–12:00'],
    ].forEach(([key, label]) => {
      expect(screen.queryByTestId(`slot-stopcard-timechip-${key}`)).toBeNull();
      expect(screen.getByTestId(`slot-stopcard-time-${key}`)).toHaveTextContent(
        label
      );

      const locked = screen.getByTestId(`slot-stopcard-locked-${key}`);
      expect(
        within(locked).getByTestId(`slot-stopcard-time-${key}`)
      ).toBeOnTheScreen();
    });

    // 보이는 "방문 완료" 배지는 없다(잠금은 모양이 아니라 동작으로만).
    expect(screen.queryByText('방문 완료')).toBeNull();

    // 짝 — 예정 행은 누를 수 있는 ink 알약이다.
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`)
    ).toBeOnTheScreen();
  });

  it('완료 알약을 눌러도 onPressTimeChip 이 불리지 않고, 예정 칩은 같은 콜백을 1회 부른다 (03b 경고-1)', () => {
    const cb = renderI07();

    // fireEvent.press 는 눌린 요소부터 부모로 올라가며 onPress 를 찾는다(RNTL findEventHandler) —
    // 완료 알약과 그 조상 어디에도 시각 편집 onPress 가 없어야 0회다.
    fireEvent.press(screen.getByTestId(`slot-stopcard-locked-${k('p1')}`));
    fireEvent.press(screen.getByTestId(`slot-stopcard-locked-${k('p2')}`));
    expect(cb.onPressTimeChip).not.toHaveBeenCalled();

    // 짝 — 같은 콜백이 배선돼 있다(공허 통과 방지): 예정 칩 press 는 정확히 1회.
    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));
    expect(cb.onPressTimeChip).toHaveBeenCalledTimes(1);
    expect(cb.onPressTimeChip).toHaveBeenCalledWith(k('p3'));
  });
});

// V4(예정 칩 press = 콜백 1회)는 TRIP-1356 에서 지웠다 — V3 두 번째 it 의 짝 단언(예정 칩 press → 정확히 1회 · slotKey)이 같다.

describe('🔴 EditorView · V5 — 위반 배지는 카테고리 아래 연분홍 알약 (TRIP-753 AC-6)', () => {
  it('행 3 에만 "숙소 고정 충돌" 배지를 primary-pale 로 그린다', () => {
    renderI07();

    const badges = screen.getAllByTestId(/^slot-stopcard-violation-/);
    expect(badges).toHaveLength(1);
    expect(
      screen.getByTestId(`slot-stopcard-violation-${k('p3')}`)
    ).toHaveTextContent('숙소 고정 충돌');
  });

  // TRIP-1298 — 편집기도 h08 과 같은 고정 라벨(옛 `일정 충돌` 폐기).
  it('사유가 null 이면 지어내지 않고 고정 문구 "일정 확인이 필요해요" 로 그린다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p3' ? { ...s, violationReason: null } : s
      ),
    });

    expect(
      screen.getByTestId(`slot-stopcard-violation-${k('p3')}`)
    ).toHaveTextContent('일정 확인이 필요해요');
  });

  // TRIP-1505 — 서버 문구가 고정 라벨로 떨어지는 카드가 앞 카드와 시각이 겹치면 어느 곳과 겹쳤는지 말한다(배선 잠금).
  it('고정 라벨로 떨어지는 카드가 앞 카드와 겹치면 앞 카드 이름을 가리킨다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p2'
          ? {
              ...s,
              startAt: '10:00:00',
              endAt: '11:30:00',
              hasViolation: true,
              violationReason: null,
            }
          : s
      ),
    });

    expect(
      screen.getByTestId(`slot-stopcard-violation-${k('p2')}`)
    ).toHaveTextContent('‘감천문화마을’ 시각과 겹쳐요');
  });

  it('hasViolation 이 false 면 사유 문자열이 있어도 배지가 없다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p3' ? { ...s, hasViolation: false } : s
      ),
    });

    // 긍정 짝 — 카드는 다섯 장 다 떠 있다(공허 통과 방지).
    I07_KEYS.forEach((key) =>
      expect(screen.getByTestId(`slot-stopcard-${key}`)).toBeOnTheScreen()
    );
    expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
      0
    );
  });
});

// ── TRIP-1298 · 편집기 위반 알약 = h08 과 같은 규칙(violationNotice) ─────────────────────────────────
//
// 슬롯 자기 distanceRange 가 비면 "앞 장소에서 이동할 시간이 빠듯해요" 조각을 빼고(TRIP-1274 사용자 결정 —
// 근거 없는 단정), 숫자가 섞이거나 비면 고정 문구로 막는다(INV-3). 알약 자체는 남긴다(BR-U3-13).
// 문구는 서버 ViolationText.phraseOf 와 글자 단위로 같아야 해서 리터럴로 든다 — 구분자 점은 U+00B7(02a ★6).
const HC2 = '앞 장소에서 이동할 시간이 빠듯해요';
const OPENING = '영업시간과 맞지 않아요';
const KNOWN = '약 2.1km · 도보 추정';

const p3Badge = (): ReturnType<typeof screen.getByTestId> =>
  screen.getByTestId(`slot-stopcard-violation-${k('p3')}`);

function renderWithP3(over: Partial<EditorSlot>): void {
  renderI07({
    slots: I07_SLOTS.map((s) => (s.poiId === 'p3' ? { ...s, ...over } : s)),
  });
}

describe('🔴 EditorView · V8 — 위반 알약은 h08 과 같은 규칙: 거리를 모르면 "빠듯"을 빼고, 숫자는 고정 문구', () => {
  // 기대값을 h08 이 쓰는 함수로 계산한다 — 문구가 아니라 "두 화면이 같은 규칙"이라는 관계를 잰다(02a ★4).
  it.each<[string, Partial<EditorSlot>]>([
    ['이동 문구 · 거리 null', { violationReason: HC2, distanceRange: null }],
    ['이동 문구 · 거리 있음', { violationReason: HC2, distanceRange: KNOWN }],
    [
      '이동 문구 · 영업시간 · 거리 null',
      { violationReason: `${HC2} · ${OPENING}`, distanceRange: null },
    ],
    ['사유 null', { violationReason: null, distanceRange: KNOWN }],
    [
      '옛 원시 분 범위',
      { violationReason: '영업시간 밖: 543~618', distanceRange: KNOWN },
    ],
    [
      '숫자 없는 기타 사유',
      { violationReason: '숙소 고정 충돌', distanceRange: null },
    ],
  ])('V8-4 · %s → h08(violationNotice)과 같은 문구', (_label, over) => {
    const data = { ...I07_SLOTS[2], hasViolation: true, ...over };
    renderWithP3(data);

    expect(p3Badge()).toHaveTextContent(violationNotice(data) as string);
  });

  // V8-1·2·3·5(문구 개별 예시)는 TRIP-1356 에서 지웠다 — V8-4 표가 같은 입력을 h08 과 같은 함수(violationNotice)로 대조하고,
  // 문구 규칙 자체(숫자 제거·거리 없으면 빠듯 제거)는 entities/itinerary-slot/lib/violationLabel.test 가 잠근다.

  it('V8-6 · hasViolation 이 false 면 거리 없는 이동 문구여도 알약이 없다', () => {
    renderWithP3({
      hasViolation: false,
      violationReason: HC2,
      distanceRange: null,
    });

    I07_KEYS.forEach((key) =>
      expect(screen.getByTestId(`slot-stopcard-${key}`)).toBeOnTheScreen()
    );
    expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
      0
    );
  });
});

// ── TRIP-1115 · i07 카드 사이 "+" — 잠김 판정 ─────────────────────────────────────────────────────
//
// "+" index i 는 카드 i 뒤·카드 i+1 앞에 넣는다(PlaceAddPage insertAfter=i → insertSlotAt(i+1)). 그래서
// i07(inTrip)에선 **카드 i+1 이 방문 완료(잠김)면 i 자리 "+" 없음** — 완료 카드 앞에 넣으면 순서가 거짓이다
// (INV-U3-03). 뺀 자리엔 같은 높이(24)의 빈 줄을 남긴다(testID 없음·못 누름, 02a §2). h12 는 완료 데이터가
// 있어도 지금처럼 전 자리 "+"다(보수안 — 판정은 inTrip 한정, V7 이 앵커).
//
// 3동작 뼈대: 준비=i07 픽스처(완료 목록 바꿔 가며) 렌더 → 실행=렌더/press → 단언=insert 번호 목록·행 구조.

/** 보이는 카드 사이 "+" 의 index 목록(트리 순서). */
function insertIndices(): number[] {
  return screen
    .queryAllByTestId(/^itinerary-edit-insert-/)
    .map((node) =>
      Number(String(node.props.testID).replace('itinerary-edit-insert-', ''))
    );
}

describe('🔴 EditorView · V6 — inTrip 이면 카드 사이 + 는 다음 카드가 잠기지 않은 자리에만, i07 안내가 장소 추가 아래 (TRIP-1115 · TRIP-753 AC-7)', () => {
  it('[완료 p1, 완료 p2, p3, p4, p5] → insert 가 정확히 1·2·3(0 = 완료 p2 앞, 4 = 마지막 뒤 없음) · 안내 i07 · 순서 add-place → guide', () => {
    renderI07({ inTrip: true });

    expect(insertIndices()).toEqual([1, 2, 3]);
    expect(screen.queryByTestId('itinerary-edit-insert-0')).toBeNull();
    expect(screen.queryByTestId('itinerary-edit-insert-4')).toBeNull();
    expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
      I07_GUIDE
    );
  });

  it('i07 에서 insert-2 press 는 onPressAddBetween(2) 1회 — h12 와 같은 콜백', () => {
    const cb = renderI07({ inTrip: true });

    fireEvent.press(screen.getByTestId('itinerary-edit-insert-2'));

    expect(cb.onPressAddBetween).toHaveBeenCalledTimes(1);
    expect(cb.onPressAddBetween).toHaveBeenCalledWith(2);
  });

  it('★완료가 중간 p3 하나면 insert-1(p3 앞)만 빠진다 → [0,2,3] — "앞 몇 개" 가 아니라 "다음 카드 잠김" 판정 (02a ★2·★3)', () => {
    renderI07({ inTrip: true, completedSlotKeys: [k('p3')] });

    expect(insertIndices()).toEqual([0, 2, 3]);
  });

  it('완료 0개(다른 날)면 모든 카드 사이 + → [0,1,2,3]', () => {
    renderI07({ inTrip: true, completedSlotKeys: [] });

    expect(insertIndices()).toEqual([0, 1, 2, 3]);
  });

  // 03b 참고-1 — 판정은 "방문 완료"만 본다. 고정(isFixed)은 드래그만 막을 뿐 앞에 넣는 건 막지 않는다.
  // 판정을 "잠김 = 고정 또는 완료"(isPinned)로 넓히면 이 테스트만 red 가 된다(다른 픽스처는 고정 0개).
  it('★다음 카드 p4 가 고정(isFixed)·미완료면 p4 앞 insert-2 는 그대로 있다 → [1,2,3]', () => {
    renderI07({
      inTrip: true,
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p4' ? { ...s, isFixed: true } : s
      ),
    });

    expect(insertIndices()).toEqual([1, 2, 3]);
  });
});

// V6-G(+ 뺀 자리 빈 줄 높이 24·행 host 자식 수)는 jest-cut A 에서 지웠다 — 레이아웃이라 실화면 QA 몫(itinerary-edit.md `edit-visited-lock`).
// V6-D(i07 끄는 중 + 3개 자리 유지)는 D7 의 it.each 행으로 합쳤다.

describe('🔴 EditorView · V7 — 플래그 없으면(h12) + 와 h12 안내 그대로, 안내 위치만 아래로 (TRIP-753 AC-7 · Q5)', () => {
  it('insert 4개 · 안내 문구 h12 완전일치 · 트리 순서 add-place → guide', () => {
    renderI07();

    expect(screen.getAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(4);
    expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
      H12_GUIDE
    );
  });
});

// ── TRIP-921 · 드래그 실배선 — 리스트 끝 센티널(3-a) ─────────────────────────────────────────────
//
// data = 슬롯 n개 + 맨 끝 센티널(드롭존). 끈 카드가 새 data 에서 센티널 **뒤**면 삭제, 아니면 재정렬.
// 경계는 "to = n" 하나다: [a,b,c,S] 에서 0→2 는 [b,c,a,S](센티널 바로 앞 = 맨 끝 재정렬), 0→3·2→3 은
// [..,S,x](센티널 뒤 = 삭제). 목은 isActive 가 늘 false · 손가락 이동 없음(02a ★4·★5).

const ACTIVE = 'itinerary-edit-dropzone-active';
const CTA = 'sheet-cta-button-0';

/**
 * 5-b 경고-1 — 끌기 중 카드 사이 "+" 계약: **마운트·레이아웃은 그대로, 보이지 않고 누를 수 없다.**
 * 라이브러리는 끌기 시작 순간 끄는 카드 위치를 스냅샷으로 적고 다시 안 잰다. 그 직후 "+" 줄(36px)이
 * 빠지면 스냅샷이 아래로 어긋나 롱프레스만으로 드롭존(삭제) 판정이 난다 — 레이아웃 불변이 드롭 판정의
 * 전제다(02a ★16). 관측(02a §5-H 실측):
 *  ① 개수 — 숨긴 요소도 세도록 `includeHiddenElements:true`(RNTL 13 기본값은 접근성 숨김을 뺀다).
 *  ② 안 보임 — `not.toBeVisible()`(style opacity 0 · display none · 접근성 숨김, 자신·조상 포함).
 *     ⚠️ NativeWind className(`opacity-0`)은 jest 에서 style 로 안 바뀌어 여기 안 잡힌다 → style/접근성으로.
 *  ③ 자리 유지 — 자신·조상(리스트까지)에 `display:'none'` style·`hidden` className 토큰 0(레이아웃 소멸 금지).
 *  ④ 누름 불가 — press 해도 onPressAddBetween 0회(pointerEvents none·disabled 모두 RNTL 이 막는다).
 */
function expectInsertsHeldButInert(
  cb: { onPressAddBetween: jest.Mock },
  count: number
): void {
  const inserts = screen.getAllByTestId(/^itinerary-edit-insert-/, {
    includeHiddenElements: true,
  });
  expect(inserts).toHaveLength(count);
  const list = screen.getByTestId(EDIT_LIST);
  inserts.forEach((node) => {
    expect(node).not.toBeVisible();
    for (
      let cur: typeof node | null = node;
      cur !== null && cur !== list;
      cur = cur.parent
    ) {
      const flat = StyleSheet.flatten(cur.props.style) as
        { display?: string } | undefined;
      expect(flat?.display).not.toBe('none');
      expect(String(cur.props.className ?? '').split(/\s+/)).not.toContain(
        'hidden'
      );
    }
    fireEvent.press(node);
  });
  expect(cb.onPressAddBetween).not.toHaveBeenCalled();
}

/** onReorder 첫 호출 인자의 poiId 순서. */
function reorderedIds(mock: jest.Mock): string[] {
  return (mock.mock.calls[0][0] as EditorSlot[]).map((s) => s.poiId);
}

describe('🔴 EditorView · D1 — 드래그 리스트 계약: 슬롯 n개뿐, 삭제 칸(센티널)은 리스트에 없다 (TRIP-1246 · 옛 TRIP-921 AC-1·AC-2 전제 개정)', () => {
  it('itinerary-edit-list 의 data 는 [a,b,c] 슬롯만이고 키는 모두 다르다', () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    expect(screen.getByTestId(EDIT_LIST)).toBeOnTheScreen();

    const data = editListData();
    expect(data.map((item) => (item as EditorSlot).poiId)).toEqual([
      'a',
      'b',
      'c',
    ]);

    const keyExtractor = (
      screen.UNSAFE_getByType(DraggableFlatList).props as {
        keyExtractor: (item: unknown, index: number) => string;
      }
    ).keyExtractor;
    expect(new Set(data.map((item, i) => keyExtractor(item, i))).size).toBe(3);
  });
});

describe('🔴 EditorView · D2 — 삭제 영역 밖에 놓으면 재정렬 (TRIP-921 AC-1 · TRIP-1246 판정 교체)', () => {
  it('b 를 맨 앞(1→0)에 놓으면 onReorder 가 [b,a,c] 로 1회, 삭제는 0회', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragEnd(1, 0);

    expect(cb.onReorder).toHaveBeenCalledTimes(1);
    expect(reorderedIds(cb.onReorder)).toEqual(['b', 'a', 'c']);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
  });

  it('★경계 — 맨 끝(0→2)으로 옮겨도 영역 위가 아니면 재정렬이지 삭제가 아니다', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragEnd(0, 2);

    expect(cb.onReorder).toHaveBeenCalledTimes(1);
    expect(reorderedIds(cb.onReorder)).toEqual(['b', 'c', 'a']);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
  });
});

describe('🔴 EditorView · D3 — 삭제 영역 위에서 놓으면 삭제 (TRIP-921 AC-2 · TRIP-1246 판정 교체)', () => {
  it('b 를 영역 위에서 놓으면 onDeleteViaDrag("b") 1회, 재정렬 0회', async () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    await fireEditDropOnZone(1);

    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('b');
    expect(cb.onReorder).not.toHaveBeenCalled();
  });

  it('★마지막 카드 c 도 영역 위에서 놓으면 삭제다(칸 index 와 무관)', async () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    await fireEditDropOnZone(2);

    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('c');
    expect(cb.onReorder).not.toHaveBeenCalled();
  });

  it('★영역 위에 갔다가 나와서 놓으면 삭제가 아니다(마지막 터치 중 위치가 기준)', async () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    await hoverOverDeleteZone(true);
    await hoverOverDeleteZone(false);
    fireEditDragEnd(1, 1);

    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
    expect(cb.onReorder).toHaveBeenCalledTimes(1);
  });

  it('★삭제 한 번 뒤 다음 끌기는 영역 위 기록이 지워진 채 시작한다(다음 제자리 놓기는 삭제 아님)', async () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    await fireEditDropOnZone(1);
    fireEditDragBegin(0);
    fireEditDragEnd(0, 0);

    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 EditorView · D4 — 고정·완료 카드는 삭제 영역에 놓여도 안 지워진다 (TRIP-921 AC-3 ② 심층 방어)', () => {
  it('고정 카드를 영역 위에서 강제 발화하면 두 콜백 0회 — 짝: 같은 화면의 예정 카드는 지워진다', async () => {
    const cb = renderView({
      slots: [slot('a'), slot('fix', { isFixed: true }), slot('b')],
    });

    // 제스처로는 못 끄는 카드지만, 판정 단계에서 한 번 더 거른다(스토어 deleteSlot 은 고정을 안 본다).
    await fireEditDropOnZone(1);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
    expect(cb.onReorder).not.toHaveBeenCalled();

    // 짝(공허 통과 방지) — 콜백 배선 자체는 살아 있다.
    await fireEditDropOnZone(2);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('b');
  });

  it('방문 완료 카드(p1)를 영역 위에서 강제 발화하면 두 콜백 0회 — 짝: 예정 p3 는 지워진다', async () => {
    const cb = renderI07();

    await fireEditDropOnZone(0);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
    expect(cb.onReorder).not.toHaveBeenCalled();

    await fireEditDropOnZone(2);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('p3');
  });
});

describe('🔴 EditorView · D5 — 고정·완료 카드엔 롱프레스 끌기가 안 걸린다 (TRIP-921 AC-3 ①)', () => {
  it('완료 p1·고정 p4 롱프레스는 끌기를 시작하지 않고, 예정 p3 롱프레스는 시작한다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p4' ? { ...s, isFixed: true } : s
      ),
    });

    // 목의 drag() 는 실물처럼 onDragBegin(index) 로 이어진다 → 끌기가 시작되면 드롭존 활성 표식이 뜬다.
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p1')}`), 'longPress');
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p4')}`), 'longPress');
    expect(screen.queryByTestId(ACTIVE)).toBeNull();

    // 짝 — 움직일 수 있는 카드는 롱프레스가 끌기로 이어진다(핸들 배선 존재).
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p3')}`), 'longPress');
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · D5b — 롱프레스는 라이브러리 drag() 를 실제로 부른다 (TRIP-921 AC-3 ① · 5-b 경고-2)', () => {
  it('완료 p1·고정 p4 롱프레스는 drag 기록 0, 예정 p3 롱프레스는 그 칸(2)으로 drag 1회', () => {
    // 목이 drag() 호출을 기록한다 — 뷰가 상태만 켜고 drag 를 안 부르면 실기에선 카드가 안 들리고
    // onDragEnd 도 안 와 편집기가 드래그 얼굴로 굳는다(드롭존 표식만 보는 D5 는 이걸 못 가른다).
    const { __dragLog } = DraggableModule as unknown as {
      __dragLog: number[];
    };
    __dragLog.length = 0;
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p4' ? { ...s, isFixed: true } : s
      ),
    });

    fireEvent(screen.getByTestId(`slot-stopcard-${k('p1')}`), 'longPress');
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p4')}`), 'longPress');
    expect(__dragLog).toEqual([]);

    fireEvent(screen.getByTestId(`slot-stopcard-${k('p3')}`), 'longPress');
    expect(__dragLog).toEqual([2]);
  });
});

describe('🔴 EditorView · D6 — 드래그 중 얼굴과 놓은 뒤 복귀 (TRIP-921 AC-4)', () => {
  it('끌기 시작하면 드롭존 활성·CTA 없음·카드 사이 + 는 자리만 남고(2개) 숨김·누름 불가, 재정렬로 놓으면 원래 얼굴', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    // 준비 확인 — 평소 얼굴.
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(2);

    fireEditDragBegin(0);
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();
    expect(screen.queryByTestId(CTA)).toBeNull();
    // 5-b 경고-1 계약 변경 — "+" 줄은 끌기 중에도 **자리(레이아웃)를 지키되** 안 보이고 안 눌린다.
    expectInsertsHeldButInert(cb, 2);

    fireEditDragEnd(0, 1);
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(2);
    // 복귀 짝 — 놓은 뒤엔 다시 보이고 눌린다.
    screen
      .getAllByTestId(/^itinerary-edit-insert-/)
      .forEach((node) => expect(node).toBeVisible());
    fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));
    expect(cb.onPressAddBetween).toHaveBeenCalledTimes(1);
  });

  it('드롭존에 놓아 삭제로 끝나도 원래 얼굴로 돌아온다', async () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragBegin(1);
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();

    await fireEditDropOnZone(1);
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
  });

  it('★제자리 놓기(from=to)도 onDragEnd 가 오므로 원래 얼굴로 돌아온다', () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragBegin(0);
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();

    fireEditDragEnd(0, 0);
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · D7 — isDragging prop 만으로 드래그 중 얼굴 (TRIP-921 AC-5 · TRIP-1115 03b 경고-1)', () => {
  it.each<[string, () => ReturnType<typeof renderView>, number]>([
    [
      'h12 카드 2장 → + 1개',
      () => renderView({ slots: [slot('a'), slot('b')], isDragging: true }),
      1,
    ],
    [
      'i07 완료 p1·p2 → 잠긴 자리 뺀 + 3개(1·2·3)',
      () => renderI07({ inTrip: true, isDragging: true }),
      3,
    ],
  ])(
    '%s — 제스처 없이 prop 을 주면 드롭존 활성·CTA 없음·카드 사이 + 는 자리만 남고 숨김·누름 불가',
    (_label, renderFace, count) => {
      const cb = renderFace();

      expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();
      expect(screen.queryByTestId(CTA)).toBeNull();
      expectInsertsHeldButInert(cb, count);
    }
  );
});

// D8(끌리는 카드 border-primary 토큰)은 jest-cut A 에서 지웠다 — 생김새라 실화면 QA 몫(itinerary-edit.md 떠 있는 얼굴).
// N2·N3(NestableScrollContainer 안 트리 순서·통과형 조상 겹수, TRIP-1112)은 jest-cut A 에서 지웠다 — 두 목이 통과형이라
// 제스처가 누구에게 가는지 jest 가 못 본다(green 인 채 실기가 죽어 있었다). 스크롤·말미 가림은 실화면 QA 몫(itinerary-edit.md).

describe('🔴 EditorView · Z2 — 놓은 뒤 칸을 새로 그린다: 칸 키가 끌기 종료 뒤에만 바뀐다 (TRIP-1246 B)', () => {
  function keysNow(): string[] {
    const { keyExtractor } = screen.UNSAFE_getByType(DraggableFlatList)
      .props as { keyExtractor: (item: unknown, index: number) => string };
    return editListData().map((item, i) => keyExtractor(item, i));
  }

  it('끌기 중엔 키가 그대로, 놓으면(제자리·재정렬 모두) 전 칸 키가 바뀌고 서로 다르다', () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });
    const before = keysNow();

    fireEditDragBegin(1);
    expect(keysNow()).toEqual(before);

    fireEditDragEnd(1, 1);
    const after = keysNow();
    expect(new Set(after).size).toBe(3);
    after.forEach((key, i) => expect(key).not.toBe(before[i]));

    // 두 번째 끌기도 놓을 때마다 또 바뀐다(한 번만 올리는 구현 차단).
    fireEditDragBegin(0);
    expect(keysNow()).toEqual(after);
    fireEditDragEnd(0, 2);
    keysNow().forEach((key, i) => expect(key).not.toBe(after[i]));
  });
});

// TRIP-1260 · 직접 짜기(QA 재현 경로)·h12·i07 편집기의 일차 칩 줄. 7일 여행이면 7일차 칩이 화면 밖이라
// 편집할 수 없었다 — 칩만 가로 스크롤 안에 두고 back 은 고정한다. 칩 testID 는 dayIndex(1부터)다.
// ⚠️ 칩이 실제로 잘리는지·밀리는지는 6-b.
describe('🔴 EditorView · 일차 칩 줄 가로 스크롤', () => {
  // 칩 줄 구조(한 가로 ScrollView·back 밖)와 선택 칩 scrollTo 는 jest-cut 에서 지웠다 — scrollTo 계산은 DayChipScroller.test S2 가 소유한다.

  it('하루짜리 일정은 칩을 그리지 않고 back 만 남는다 (AC-4 · 선제 green 회귀 앵커)', () => {
    renderView({ days: buildPlanDayTabs(daysOf(DATE)) });

    expect(screen.getByTestId('itinerary-edit-back')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^itinerary-edit-day-/)).toHaveLength(0);
  });
});

// TRIP-1424 · AC-21·AC-22 — 장소 추가는 [저장]과 따로 곧장 서버에 저장된다(PlaceAddPage 의 PUT). 그 사실을 편집기가
// 늘 한 줄로 말한다(결정 2=A). 두 편집기 페이지가 이 뷰를 함께 쓰므로 여기 한 곳에 있으면 두 화면에 다 뜬다.
// 기존 안내줄(`itinerary-edit-guide`)과는 다른 줄이다 — 그 안에 넣으면 V6·V7 의 완전 일치가 깨진다.
// 3동작: 준비 = h12 빈 얼굴 / i07 얼굴 → 실행 = 렌더(저장 누름 없음) → 단언 = 안내 한 줄 · 옛 안내줄 그대로.
describe('🔴 EditorView · H1 — 장소 추가 즉시 저장 안내 한 줄 (TRIP-1424)', () => {
  it.each<[string, () => void, string]>([
    [
      'h12 편집기(카드 있음)',
      () => renderView({ slots: [slot('a')] }),
      H12_GUIDE,
    ],
    ['i07 여행 중 편집', () => renderI07({ inTrip: true }), I07_GUIDE],
  ])(
    '%s — [저장] 전에도 "장소를 추가하면 바로 저장돼요"가 보이고, 옛 안내줄 문구는 그대로다',
    (_name, renderFace, guide) => {
      renderFace();

      expect(
        screen.getByTestId('itinerary-edit-add-saved-hint')
      ).toHaveTextContent('장소를 추가하면 바로 저장돼요');
      expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
        guide
      );
    }
  );
});

/**
 * TRIP-1791 · 편집기 「여러 곳 골라 한 번에 빼기」(선택 모드) — 뷰 단위 계약.
 *
 * 선택 모드의 상태(모드·고른 poiId·확인창)는 뷰 안에 있고, 뷰는 확정 때 `onDeleteSelected(poiIds)` 로 **슬롯 순서**
 * 배열만 올린다. 스토어 호출·"저장 전 서버 호출 0" 은 페이지 통합(ItineraryEditPage.integration R8·E5)이 잰다.
 * `onDeleteSelected` 를 안 넘기는 직접 짜기(ManualPlanPage)는 「선택」 자체가 없다 = 지금 화면.
 *
 * ⚠️ mount 예산: EditorView 를 mount 할 때마다 reanimated 환경 경고가 1건 나고 node 버킷 상한(59)의 여유가 4뿐이라,
 * 이 describe 는 `it` 3개 = mount 3번이다. 한 `it` 안에서 `screen.rerender` 로 prop 을 바꿔 가며 판정한다(재렌더는 경고 0).
 * `it` 를 더 얹지 마라(02a ★1). 색·모양·딤 덮임·리스트 재마운트 여부는 jest 사각 → 실화면 QA(02a ★10).
 *
 * 3동작 뼈대: 준비=슬롯·콜백 주입 렌더 → 실행=토글·체크·하단 버튼·확인창 press → 단언=트리(곳수·라벨·부재/존재)·콜백 인자.
 */
describe('🔴 EditorView · 여러 곳 골라 빼기 (TRIP-1791) · 카드 ⋯ 노출 조건 (TRIP-1793)', () => {
  const CHECK = (poiId: string): string => `editor-select-check-${poiId}`;
  const CARD = (poiId: string): string =>
    `slot-stopcard-${buildSlotKey(DATE, poiId)}`;
  const CONFIRM = 'editor-select-confirm';
  const press = (testID: string): void =>
    fireEvent.press(screen.getByTestId(testID));
  const dialog = () => within(screen.getByTestId(CONFIRM));

  function named(
    poiId: string,
    nameKo: string,
    over: Partial<EditorSlot> = {}
  ) {
    return slot(poiId, { nameKo, ...over });
  }

  /** 렌더하고, 같은 인스턴스에 prop 을 바꿔 다시 그리는 함수를 돌려준다(mount 수 = 1). */
  function mountPicker(initial: Partial<Parameters<typeof EditorView>[0]>) {
    const cb = {
      onSelectDay: jest.fn(),
      onPressTimeChip: jest.fn(),
      onPressAddPlace: jest.fn(),
      onPressAddBetween: jest.fn(),
      onSave: jest.fn(),
      onReorder: jest.fn(),
      onDeleteViaDrag: jest.fn(),
      onDeleteSelected: jest.fn(),
    };
    const element = (over: Partial<Parameters<typeof EditorView>[0]>) => (
      <EditorView
        center={CENTER}
        days={buildPlanDayTabs(daysOf(DATE))}
        slots={[]}
        activeDayIndex={0}
        activeDate={DATE}
        dateLabel="6월 10일(수)"
        onBack={jest.fn()}
        {...cb}
        {...initial}
        {...over}
      />
    );
    render(element({}));
    return {
      cb,
      redraw: (over: Partial<Parameters<typeof EditorView>[0]>) =>
        screen.rerender(element(over)),
    };
  }

  it('S-A · 노출 조건 → 선택 얼굴 → 체크·잠금·카드 탭 금지·끌기 불가 → 취소로 일반 얼굴 복귀 (AC-2·3·4·5·7)', () => {
    const { __dragLog } = DraggableModule as unknown as { __dragLog: number[] };
    __dragLog.length = 0;
    const slots = [
      named('a', '황령산 전망대'),
      named('b', '부산시립미술관'),
      named('fix', '감천문화마을', { isFixed: true }),
      named('done', '광안리 해변'),
      named('c', '전포 카페거리'),
    ];
    const doneKey = buildSlotKey(DATE, 'done');

    // ① 준비 — 선택 콜백을 안 준 화면(직접 짜기): 「선택」이 없다.
    const { cb, redraw } = mountPicker({
      slots,
      completedSlotKeys: [doneKey],
      onDeleteSelected: undefined,
    });
    expect(screen.queryByTestId('editor-select-toggle')).toBeNull();
    // TRIP-1792 — 되돌리기 prop 도 안 줬으니 머리에 ↶ 가 없다(직접 짜기 = 기능 부재, AC-10).
    expect(screen.queryByTestId('editor-undo')).toBeNull();

    // ② 콜백을 주면(편집 h24·i07) 「선택」이 생긴다. 아직 선택 얼굴 요소는 없다.
    redraw({ onDeleteSelected: cb.onDeleteSelected });
    expect(screen.getByTestId('editor-select-toggle')).toHaveTextContent(
      '선택'
    );
    expect(screen.queryByTestId('editor-select-count')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('일정 저장하기')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${buildSlotKey(DATE, 'a')}`)
    ).toBeOnTheScreen();

    // ②b TRIP-1792 · 머리 되돌리기 ↶ — `undo` prop 이 있을 때만 생기고, 「선택」 오른쪽에 선다(AC-5·10).
    //  `redraw` 는 초기 prop 위에 덮어쓰므로 선택 콜백을 매번 다시 준다.
    const onUndo = jest.fn();
    expect(screen.queryByTestId('editor-undo')).toBeNull(); // undo 만 안 줬다 — 선택 콜백이 있어도 ↶ 는 없다
    redraw({
      onDeleteSelected: cb.onDeleteSelected,
      undo: { enabled: false, onPress: onUndo },
    });
    expect(screen.getByTestId('editor-undo')).toBeOnTheScreen();
    expect(screen.getByLabelText('되돌리기')).toHaveProp(
      'testID',
      'editor-undo'
    );
    expect(
      screen
        .getAllByTestId(/^editor-(select-toggle|undo)$/)
        .map((node) => node.props.testID)
    ).toEqual(['editor-select-toggle', 'editor-undo']);
    // 이력이 없으면(enabled=false) 비활성이고 눌러도 아무 일이 없다.
    expect(screen.getByTestId('editor-undo')).toBeDisabled();
    press('editor-undo');
    expect(onUndo).not.toHaveBeenCalled();
    // 이력이 쌓이면(enabled=true) 눌림이 한 번 전달된다.
    redraw({
      onDeleteSelected: cb.onDeleteSelected,
      undo: { enabled: true, onPress: onUndo },
    });
    expect(screen.getByTestId('editor-undo')).not.toBeDisabled();
    press('editor-undo');
    expect(onUndo).toHaveBeenCalledTimes(1);

    // ③ 실행 — 「선택」을 누른다. 선택 얼굴로 바뀐다.
    press('editor-select-toggle');
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '0곳 선택'
    );
    expect(screen.queryByTestId('editor-select-toggle')).toBeNull();
    // 선택 모드 머리에는 ↶ 가 없다(짝: 위에서 같은 prop 으로 있었다).
    expect(screen.queryByTestId('editor-undo')).toBeNull();
    expect(screen.queryByTestId('sheet-header-title')).toBeNull();
    expect(screen.queryByTestId('sheet-header-meta')).toBeNull();
    // 카드마다 체크 원 — 잠긴 둘(고정·방문 완료)은 비활성, 나머지는 선택 안 됨·활성.
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    for (const poiId of ['fix', 'done']) {
      expect(screen.getByTestId(CHECK(poiId))).toBeDisabled();
    }
    for (const poiId of ['a', 'b', 'c']) {
      expect(screen.getByTestId(CHECK(poiId))).not.toBeDisabled();
      expect(screen.getByTestId(CHECK(poiId))).not.toBeSelected();
    }
    // 하단: 취소 + 0곳이면 라벨 `빼기` 비활성.
    expect(screen.getByTestId('editor-select-cancel')).toHaveTextContent(
      '취소'
    );
    expect(screen.getByTestId('editor-select-delete')).toHaveTextContent(
      '빼기'
    );
    expect(screen.getByTestId('editor-select-delete')).toBeDisabled();
    // 없어지는 것(AC-7): 저장 CTA·카드 사이 +·장소 추가·안내줄 둘·시각 칩.
    expect(screen.queryByText('일정 저장하기')).toBeNull();
    expect(screen.queryByTestId('itinerary-edit-add-place')).toBeNull();
    expect(screen.queryByTestId('itinerary-edit-guide')).toBeNull();
    expect(screen.queryByTestId('itinerary-edit-add-saved-hint')).toBeNull();
    expect(screen.queryAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(0);
    expect(
      screen.queryByTestId(`slot-stopcard-timechip-${buildSlotKey(DATE, 'a')}`)
    ).toBeNull();
    // 남는 것 — 리스트와 카드(리스트를 갈아 끼우지 않는다는 약한 앵커).
    expect(screen.getByTestId('itinerary-edit-list')).toBeOnTheScreen();
    expect(screen.getByTestId(CARD('a'))).toBeOnTheScreen();

    // ④ 0곳에서 「빼기」를 눌러도 확인창이 안 뜬다(AC-4).
    press('editor-select-delete');
    expect(screen.queryByTestId(CONFIRM)).toBeNull();
    expect(cb.onDeleteSelected).not.toHaveBeenCalled();

    // ⑤ 체크 토글 — 머리 곳수와 하단 라벨이 따라온다.
    press(CHECK('a'));
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '1곳 선택'
    );
    expect(screen.getByTestId(CHECK('a'))).toBeSelected();
    expect(screen.getByTestId('editor-select-delete')).toHaveTextContent(
      '1곳 빼기'
    );
    expect(screen.getByTestId('editor-select-delete')).not.toBeDisabled();
    press(CHECK('b'));
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '2곳 선택'
    );
    expect(screen.getByTestId('editor-select-delete')).toHaveTextContent(
      '2곳 빼기'
    );
    press(CHECK('a')); // 다시 누르면 해제
    expect(screen.getByTestId(CHECK('a'))).not.toBeSelected();
    expect(screen.getByTestId(CHECK('b'))).toBeSelected();
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '1곳 선택'
    );

    // ⑥ 잠긴 카드의 체크는 눌러도 선택 수가 안 변한다(AC-2).
    press(CHECK('fix'));
    press(CHECK('done'));
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '1곳 선택'
    );
    expect(screen.getByTestId(CHECK('fix'))).not.toBeSelected();
    expect(screen.getByTestId(CHECK('done'))).not.toBeSelected();

    // ⑦ 카드 전체 탭은 선택이 아니다(체크 원만 눌린다).
    press(CARD('c'));
    expect(screen.getByTestId(CHECK('c'))).not.toBeSelected();
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '1곳 선택'
    );

    // ⑧ 선택 모드에서는 롱프레스가 끌기를 시작하지 않는다(AC-7).
    fireEvent(screen.getByTestId(CARD('a')), 'longPress');
    expect(__dragLog).toEqual([]);

    // ⑨ 하단 「취소」 — 일반 얼굴로 복귀, 삭제 콜백은 한 번도 안 불린다(AC-3).
    press('editor-select-cancel');
    expect(screen.getByTestId('editor-select-toggle')).toBeOnTheScreen();
    expect(screen.getByTestId('editor-undo')).not.toBeDisabled(); // ↶ 도 돌아온다(prop 은 그대로)
    expect(screen.queryByTestId('editor-select-count')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('일정 저장하기')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-add-place')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-guide')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-insert-0')).toBeOnTheScreen();
    expect(cb.onDeleteSelected).not.toHaveBeenCalled();

    // ⑩ 다시 들어가면 체크가 비어 있다(취소 전에 b 가 선택돼 있었다). 짝: 일반 얼굴에선 롱프레스가 끌기를 시작한다.
    press('editor-select-toggle');
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '0곳 선택'
    );
    for (const poiId of ['a', 'b', 'c']) {
      expect(screen.getByTestId(CHECK(poiId))).not.toBeSelected();
    }
    press('editor-select-cancel');
    fireEvent(screen.getByTestId(CARD('a')), 'longPress');
    expect(__dragLog).toEqual([0]);
  });

  it('S-B · 확인창: 제목·이름 요약(슬롯 순서·앞 3곳 + 외 N곳) · 취소는 유지 · 확정은 슬롯 순서 콜백 1회 + 모드 즉시 종료 (AC-1·3)', () => {
    const slots = [
      named('a', '황령산 전망대'),
      named('b', '부산시립미술관'),
      named('c', '감천문화마을'),
      named('d', '광안리 해변'),
      named('e', '전포 카페거리'),
      named('f', '해운대 블루라인'),
    ];
    const { cb } = mountPicker({ slots });
    press('editor-select-toggle');

    // 클릭 순서(d→b)를 슬롯 순서(b,d)와 일부러 뒤집는다.
    press(CHECK('d'));
    press(CHECK('b'));
    press('editor-select-delete');
    expect(dialog().getByText('2곳을 일정에서 뺄까요?')).toBeOnTheScreen();
    expect(
      dialog().getByText('부산시립미술관 · 광안리 해변')
    ).toBeOnTheScreen();
    expect(dialog().getByTestId('editor-select-confirm-ok')).toHaveTextContent(
      '빼기'
    );
    expect(
      dialog().getByTestId('editor-select-confirm-cancel')
    ).toHaveTextContent('취소');
    expect(cb.onDeleteSelected).not.toHaveBeenCalled();

    // 확인창 취소 — 아무것도 안 빠지고 선택 모드·체크가 그대로다.
    press('editor-select-confirm-cancel');
    expect(screen.queryByTestId(CONFIRM)).toBeNull();
    expect(cb.onDeleteSelected).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '2곳 선택'
    );
    expect(screen.getByTestId(CHECK('b'))).toBeSelected();
    expect(screen.getByTestId(CHECK('d'))).toBeSelected();

    // 3곳: 이름 셋 전부, "외" 없음.
    press(CHECK('f'));
    press('editor-select-delete');
    expect(
      dialog().getByText('부산시립미술관 · 광안리 해변 · 해운대 블루라인')
    ).toBeOnTheScreen();
    press('editor-select-confirm-cancel');

    // 4곳·5곳: 앞 3곳 + " 외 N곳".
    press(CHECK('a'));
    press('editor-select-delete');
    expect(dialog().getByText('4곳을 일정에서 뺄까요?')).toBeOnTheScreen();
    expect(
      dialog().getByText('황령산 전망대 · 부산시립미술관 · 광안리 해변 외 1곳')
    ).toBeOnTheScreen();
    press('editor-select-confirm-cancel');
    press(CHECK('e'));
    press('editor-select-delete');
    expect(
      dialog().getByText('황령산 전망대 · 부산시립미술관 · 광안리 해변 외 2곳')
    ).toBeOnTheScreen();
    press('editor-select-confirm-cancel');

    // 한 곳만 남기면 제목도 1곳.
    for (const poiId of ['a', 'b', 'd', 'e']) press(CHECK(poiId));
    press('editor-select-delete');
    expect(dialog().getByText('1곳을 일정에서 뺄까요?')).toBeOnTheScreen();
    expect(dialog().getByText('해운대 블루라인')).toBeOnTheScreen();
    press('editor-select-confirm-cancel');

    // 확정 — b, d, f 를 고른 채. 콜백은 정확히 1회, 슬롯 순서 배열.
    press(CHECK('d'));
    press(CHECK('b'));
    press('editor-select-delete');
    press('editor-select-confirm-ok');
    expect(cb.onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteSelected).toHaveBeenCalledWith(['b', 'd', 'f']);
    // 모드 종료는 동기 — 확인창도 선택 얼굴도 사라지고 일반 얼굴이다.
    expect(screen.queryByTestId(CONFIRM)).toBeNull();
    expect(screen.queryByTestId('editor-select-count')).toBeNull();
    expect(screen.getByTestId('editor-select-toggle')).toBeOnTheScreen();
    expect(screen.getByText('일정 저장하기')).toBeOnTheScreen();
    // 다시 들어가면 선택이 비어 있다.
    press('editor-select-toggle');
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '0곳 선택'
    );
    expect(screen.getByTestId(CHECK('b'))).not.toBeSelected();
  });

  it('S-C · 체크 뒤에 잠기면 빼기 대상에서 제외(D12) · 일차 칩은 모드를 즉시 끈다(D3) · 안 잠긴 카드가 없으면 「선택」 숨김(D4) · 카드 ⋯ 노출 조건·옮김 배지 (TRIP-1793)', () => {
    const slots = [
      named('a', '황령산 전망대'),
      named('b', '부산시립미술관'),
      named('c', '감천문화마을'),
    ];
    const key = (poiId: string): string => buildSlotKey(DATE, poiId);
    const { cb, redraw } = mountPicker({
      days: buildPlanDayTabs(daysOf(DATE, DATE2)),
      slots,
    });

    // D12 — a, b 를 체크한 뒤 a 가 방문 완료로 바뀐다(조회가 늦게 도착): a 는 대상에서 빠진다.
    press('editor-select-toggle');
    press(CHECK('a'));
    press(CHECK('b'));
    redraw({ completedSlotKeys: [key('a')] });
    expect(screen.getByTestId(CHECK('a'))).toBeDisabled();
    expect(screen.getByTestId('editor-select-delete')).toHaveTextContent(
      '1곳 빼기'
    );
    press('editor-select-delete');
    press('editor-select-confirm-ok');
    expect(cb.onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteSelected).toHaveBeenCalledWith(['b']);

    // 고른 곳이 전부 잠기면 「빼기」는 다시 비활성이고 눌러도 확인창이 없다.
    redraw({ completedSlotKeys: [] });
    press('editor-select-toggle');
    press(CHECK('b'));
    redraw({ completedSlotKeys: [key('a'), key('b')] });
    expect(screen.getByTestId('editor-select-delete')).toHaveTextContent(
      '빼기'
    );
    expect(screen.getByTestId('editor-select-delete')).toBeDisabled();
    press('editor-select-delete');
    expect(screen.queryByTestId(CONFIRM)).toBeNull();

    // D3 — 선택 모드에서 일차 칩을 누르면 일차 이동 콜백과 함께 모드가 즉시 꺼지고 체크가 비워진다.
    press('itinerary-edit-day-2');
    expect(cb.onSelectDay).toHaveBeenCalledTimes(1);
    expect(cb.onSelectDay).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('editor-select-count')).toBeNull();
    expect(screen.getByTestId('editor-select-toggle')).toBeOnTheScreen();
    redraw({ completedSlotKeys: [] });
    press('editor-select-toggle');
    expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
      '0곳 선택'
    );
    expect(screen.getByTestId(CHECK('b'))).not.toBeSelected();
    press('editor-select-cancel');

    // D4 — 안 잠긴 카드가 하나도 없는 날은 「선택」을 숨긴다. 하나라도 남으면 다시 나온다.
    redraw({ completedSlotKeys: [key('a'), key('b'), key('c')] });
    expect(screen.queryByTestId('editor-select-toggle')).toBeNull();
    redraw({ completedSlotKeys: [key('a'), key('b')] });
    expect(screen.getByTestId('editor-select-toggle')).toBeOnTheScreen();

    // ── TRIP-1793 · 카드 ⋯ (다른 날로 옮기기) — 같은 인스턴스에 prop 만 바꿔 노출 조건을 차례로 잰다(새 mount 0, 소음 예산).
    //  이 `it` 의 준비는 이미 이틀 일정(a·b·c, 둘 다 안 고정)이고 선택 모드는 위에서 취소로 나왔다.
    const MORE = (poiId: string): string => `editor-slot-more-${poiId}`;
    const moreIds = (): string[] =>
      screen
        .queryAllByTestId(/^editor-slot-more-/)
        .map((node) => node.props.testID as string);
    const onPressMore = jest.fn();

    // ① 콜백을 안 준 화면(직접 짜기)은 ⋯ 가 없다 — 카드 3장이 있고 이틀 일정이라 "숨을 이유"가 없는데도.
    redraw({ completedSlotKeys: [] });
    expect(moreIds()).toEqual([]);

    // ② 주면 안 잠긴 카드마다 ⋯ 가 슬롯 순서로 서고, 누르면 poiId 로 콜백한다.
    redraw({ completedSlotKeys: [], onPressMore });
    expect(moreIds()).toEqual([MORE('a'), MORE('b'), MORE('c')]);
    press(MORE('b'));
    expect(onPressMore).toHaveBeenCalledTimes(1);
    expect(onPressMore).toHaveBeenCalledWith('b');

    // ③ 방문 완료 카드엔 ⋯ 가 없다.
    redraw({ completedSlotKeys: [key('a')], onPressMore });
    expect(moreIds()).toEqual([MORE('b'), MORE('c')]);

    // ④ 고정(isFixed) 카드에도 없다 — 끌기와 같은 isPinned 기준.
    redraw({
      completedSlotKeys: [],
      onPressMore,
      slots: [
        named('a', '황령산 전망대'),
        named('b', '부산시립미술관'),
        named('c', '감천문화마을', { isFixed: true }),
      ],
    });
    expect(moreIds()).toEqual([MORE('a'), MORE('b')]);

    // ⑤ 선택 모드에서는 전부 사라지고, 취소하면 돌아온다.
    redraw({ completedSlotKeys: [], onPressMore });
    press('editor-select-toggle');
    expect(moreIds()).toEqual([]);
    press('editor-select-cancel');
    expect(moreIds()).toEqual([MORE('a'), MORE('b'), MORE('c')]);

    // ⑥ 일정이 하루뿐이면 옮길 날이 없어 ⋯ 가 없다. 다시 이틀이면 돌아온다.
    redraw({
      completedSlotKeys: [],
      onPressMore,
      days: buildPlanDayTabs(daysOf(DATE)),
    });
    expect(moreIds()).toEqual([]);
    redraw({ completedSlotKeys: [], onPressMore });
    expect(moreIds()).toEqual([MORE('a'), MORE('b'), MORE('c')]);

    // ⑦ 옮김 배지 — 뷰가 일차 목록(`days`)에서 출발 날짜의 일차를 찾아 「N일차에서 옮김」을 카드에 내린다.
    const movedId = (poiId: string): string =>
      `slot-stopcard-moved-${key(poiId)}`;
    const withMoved = (poiId: string, from: string): EditorSlot =>
      ({ ...named(poiId, `장소-${poiId}`), movedFromDate: from }) as EditorSlot;
    redraw({
      completedSlotKeys: [],
      onPressMore,
      slots: [
        named('a', '황령산 전망대'),
        withMoved('b', DATE),
        named('c', '감천문화마을'),
      ],
    });
    expect(screen.getByTestId(movedId('b'))).toHaveTextContent(
      '1일차에서 옮김'
    );
    expect(screen.queryByTestId(movedId('a'))).toBeNull();
    expect(screen.queryByTestId(movedId('c'))).toBeNull();
    redraw({
      completedSlotKeys: [],
      onPressMore,
      slots: [
        named('a', '황령산 전망대'),
        withMoved('b', DATE2),
        named('c', '감천문화마을'),
      ],
    });
    expect(screen.getByTestId(movedId('b'))).toHaveTextContent(
      '2일차에서 옮김'
    );
    // 일정에 없는 날짜면 뷰가 일차를 지어내지 않는다 — 배지 없음.
    redraw({
      completedSlotKeys: [],
      onPressMore,
      slots: [
        named('a', '황령산 전망대'),
        withMoved('b', '2099-01-01'),
        named('c', '감천문화마을'),
      ],
    });
    expect(screen.queryByTestId(movedId('b'))).toBeNull();
  });
});
