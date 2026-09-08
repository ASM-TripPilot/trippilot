import { fireEvent, render, screen } from '@testing-library/react-native';

import type { SavedStay } from '@/shared/api/generated/schemas';

import { StaySelectSheet } from './StaySelectSheet';

/**
 * TRIP-673 g02 숙소 선택 시트(S9) — **무상태 시트 유닛(props-only).**
 *
 * 무엇을 보장하나 — 시트는 조회·라우터·드래프트를 모른다. 완성된 props(제목·날짜 라벨·후보·
 * 선택 id·콜백)만 받아 그린다:
 *  - **헤더**(AC-1) 박 라벨·지역 제목 + "{날짜(요일)} 밤 · 어디서 묵을까요?" 부제.
 *  - **후보 카드**(AC-2) 이름 + 날짜 서브라인(checkIn~checkOut 있으면 `6.10~6.13`, 없으면 "날짜 없음") +
 *    단일 선택 체크. **가격·거리·사진 미렌더**(SavedStay 계약에 price·imageUrl 없음 — 발명 금지).
 *  - **단일 선택**(★2) 선택 표식은 색 fill 이 아니라 `accessibilityState={{selected}}`(=`toBeSelected()`).
 *  - **지정 disabled 3단**(★3) 선택 없으면 진짜 disabled(press 해도 콜백 0), 선택 시 활성.
 *  - **후보 0건**(AC-5) empty + 둘러보기.
 *  - **실패 인라인**(★4·INV-4) assignFailed → 오류 present.
 *
 * ⚠️ 실개폐·딤·중앙정렬·터치차단은 `@gorhom/bottom-sheet` 통과형 목이라 jest 원리적 사각(★7) —
 * 6-b 실기 전용. 여기서는 트리 존재·후보 렌더·선택·콜백 배선까지만 잰다.
 *
 * 매처 근거: `toHaveTextContent`는 문자열 인자면 완전일치(카드가 여러 Text 를 이어붙이므로 반드시
 * RegExp 부분 포함) · `toBeSelected()`는 accessibilityState.selected 를 읽는다(리포 선례 다수).
 */

function stay(over: Partial<SavedStay> = {}): SavedStay {
  return {
    savedStayId: 'stay-a',
    name: '해운대 오션 호텔',
    coordConfirmed: true,
    checkIn: '2026-06-10',
    checkOut: '2026-06-13',
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

const STAY_A = stay();
const STAY_B = stay({
  savedStayId: 'stay-b',
  name: '감천문화마을 게스트하우스',
  checkIn: null,
  checkOut: null,
  coordConfirmed: false,
});

function renderSheet(
  over: Partial<Parameters<typeof StaySelectSheet>[0]> = {}
) {
  const props = {
    title: '2박 · 부산',
    dateLabel: '6/11(목)',
    candidates: [STAY_A, STAY_B],
    selectedSavedStayId: null,
    onSelect: jest.fn(),
    onBrowse: jest.fn(),
    onAssign: jest.fn(),
    ...over,
  };
  render(<StaySelectSheet {...props} />);
  return props;
}

describe('S1 · 헤더 (AC-1)', () => {
  it('박 라벨·지역 제목과 "{날짜(요일)} 밤 · 어디서 묵을까요?" 부제를 그린다', () => {
    renderSheet();

    const root = screen.getByTestId('trip-base-staysheet');
    // 여러 Text 가 이어붙으므로 RegExp(부분 포함)로 잰다 — 문자열이면 완전일치라 항상 실패.
    expect(root).toHaveTextContent(/2박 · 부산/);
    expect(root).toHaveTextContent(/6\/11\(목\) 밤/);
    expect(root).toHaveTextContent(/어디서 묵을까요/);
  });
});

describe('S2 · 후보 카드 (AC-2)', () => {
  it('이름과 날짜 서브라인(있으면 6.10~6.13 / 없으면 "날짜 없음")을 그린다', () => {
    renderSheet();

    const cardA = screen.getByTestId('trip-base-staysheet-cand-stay-a');
    expect(cardA).toHaveTextContent(/해운대 오션 호텔/);
    expect(cardA).toHaveTextContent(/6\.10~6\.13/);

    const cardB = screen.getByTestId('trip-base-staysheet-cand-stay-b');
    expect(cardB).toHaveTextContent(/감천문화마을 게스트하우스/);
    expect(cardB).toHaveTextContent(/날짜 없음/);
  });

  it('★5 · 가격·거리를 그리지 않는다 (계약 부재 — Figma 목업 복붙 금지)', () => {
    renderSheet();

    const cardA = screen.getByTestId('trip-base-staysheet-cand-stay-a');
    expect(cardA).not.toHaveTextContent(/원|₩/); // 가격 없음
    expect(cardA).not.toHaveTextContent(/\d+\s*m\b|km/); // 거리 없음 (FG-2)
  });
});

describe('S3 · 단일 선택 렌더 (AC-2 · ★2)', () => {
  it('선택된 후보만 accessibilityState.selected 다 (색 fill 아님)', () => {
    renderSheet({ selectedSavedStayId: 'stay-a' });

    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-a')
    ).toBeSelected();
    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-b')
    ).not.toBeSelected();
  });
});

describe('S4 · 후보 press → onSelect (AC-2)', () => {
  it('누른 후보의 savedStayId 로 onSelect 를 부른다', () => {
    const props = renderSheet();

    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-b'));

    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith('stay-b');
  });
});

describe('S5 · 둘러보기 (AC-3)', () => {
  it('숙소 둘러보기 press → onBrowse', () => {
    const props = renderSheet();

    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));

    expect(props.onBrowse).toHaveBeenCalledTimes(1);
  });
});

describe('S6 · 지정 disabled 3단 (AC-4 · ★3)', () => {
  it('선택이 없으면 지정이 진짜 disabled — 눌러도 onAssign 0회', () => {
    const props = renderSheet({ selectedSavedStayId: null });

    const assign = screen.getByTestId('trip-base-staysheet-assign');
    expect(assign).toBeDisabled();

    fireEvent.press(assign);
    expect(props.onAssign).not.toHaveBeenCalled();
  });

  it('짝 · 선택이 있으면 활성 — 누르면 onAssign 1회', () => {
    const props = renderSheet({ selectedSavedStayId: 'stay-a' });

    const assign = screen.getByTestId('trip-base-staysheet-assign');
    expect(assign).not.toBeDisabled();

    fireEvent.press(assign);
    expect(props.onAssign).toHaveBeenCalledTimes(1);
  });
});

describe('S7 · 후보 0건 empty (AC-5)', () => {
  it('후보가 없으면 empty 안내 + 둘러보기만, 카드는 0장', () => {
    renderSheet({ candidates: [] });

    expect(screen.getByTestId('trip-base-staysheet-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-staysheet-browse')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^trip-base-staysheet-cand-/)).toHaveLength(
      0
    );
  });
});

describe('S8 · 실패 인라인 (AC-4 · INV-4)', () => {
  it('assignFailed 면 인라인 오류를 그린다', () => {
    renderSheet({ selectedSavedStayId: 'stay-a', assignFailed: true });

    expect(screen.getByTestId('trip-base-staysheet-error')).toBeOnTheScreen();
  });

  it('짝 · assignFailed 가 아니면 오류를 안 그린다', () => {
    renderSheet({ selectedSavedStayId: 'stay-a' });

    expect(screen.queryByTestId('trip-base-staysheet-error')).toBeNull();
  });
});
