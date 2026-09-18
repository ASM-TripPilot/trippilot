import { fireEvent, render, screen } from '@testing-library/react-native';

import type { SavedStay } from '@/shared/api/generated/schemas';
import { formatBaseNightRange } from '@/entities/trip/lib/formatTripPeriod';

import { formatStayDateRange } from '../model/stayDateImport';

import { StaySelectSheet } from './StaySelectSheet';
import { CheckGlyph } from './TripGlyphs';

/**
 * TRIP-673 g02 숙소 선택 시트(S9) → TRIP-741 후보 카드 Figma 정합.
 *
 * 무엇을 보장하나 — 시트는 조회·라우터·드래프트를 모른다. 완성된 props(제목·날짜 라벨·후보·
 * 선택 id·콜백)만 받아 그린다:
 *  - **헤더**(AC-1) 박 라벨·지역 제목 + "{날짜(요일)} 밤 · 어디서 묵을까요?" 부제.
 *  - **후보 카드**(AC-1) 이름 + 날짜 서브라인 = `M/D–M/D · N박`(en dash U+2013, 없으면 "날짜 없음").
 *    옛 `6.10~6.13`(ASCII ~)이 아니다 — S10 이 두 포맷터를 같은 인자로 태워 구분자가 다름을 못박는다.
 *    **가격·거리·사진 미렌더**(SavedStay 계약에 없음 — 발명 금지, INV-1).
 *  - **선택 체크 톤**(AC-2) 선택 후보 체크에 `tone="primary"` 전달(색 자체는 react-native-svg 정수화로
 *    jest 사각 → prop 기록형까지만, 분홍 실색은 6-b).
 *  - **단일 선택**(★2·AC-3) 선택 표식은 색 fill 이 아니라 `accessibilityState={{selected}}`(=`toBeSelected()`).
 *  - **지정 disabled 3단**(★3·AC-7) 선택 없으면 진짜 disabled(press 해도 콜백 0), 선택 시 활성.
 *  - **후보 0건**(AC-5) empty + 둘러보기.
 *  - **실패 인라인**(★4·INV-4) assignFailed → 오류 present.
 *
 * ⚠️ 실개폐·딤·중앙정렬·터치차단·사진 실색·체크 분홍·테두리 분홍은 `@gorhom/bottom-sheet` 통과형 목/
 * react-native-svg 정수화라 jest 원리적 사각(★7) — 6-b 실기 전용(프리뷰 `trip-new-step2-staysheet`).
 * 여기서는 트리 존재·후보 렌더·선택·콜백 배선·tone prop 전달까지만 잰다.
 *
 * 매처 근거: `toHaveTextContent`는 문자열 인자면 완전일치(카드가 여러 Text 를 이어붙이므로 반드시
 * RegExp 부분 포함) · `toBeSelected()`/`toBeDisabled()`는 accessibilityState 를 읽는다(리포 선례 다수) ·
 * `UNSAFE_getByType(CheckGlyph).props`는 합성 컴포넌트 원본 prop 을 노출한다(실측 P2).
 */

function stay(over: Partial<SavedStay> = {}): SavedStay {
  return {
    savedStayId: 'stay-a',
    name: '해운대 오션 호텔',
    coordConfirmed: true,
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

// TRIP-741 픽스처 3건 — 광안리 뷰 호텔(선택)/해운대 오션 호텔/감천 게스트하우스(날짜 없음).
const GWANGALLI = stay({
  savedStayId: 'stay-gwangalli',
  name: '광안리 뷰 호텔',
  checkIn: '2026-06-11',
  checkOut: '2026-06-12',
});
const HAEUNDAE = stay({
  savedStayId: 'stay-haeundae',
  name: '해운대 오션 호텔',
  checkIn: '2026-06-10',
  checkOut: '2026-06-12',
});
const GAMCHEON = stay({
  savedStayId: 'stay-gamcheon',
  name: '감천 게스트하우스',
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
    candidates: [GWANGALLI, HAEUNDAE, GAMCHEON],
    selectedSavedStayId: null,
    onSelect: jest.fn(),
    onBrowse: jest.fn(),
    onAssign: jest.fn(),
    onClose: jest.fn(), // TRIP-683: 딤 바깥 탭 닫힘 콜백(필수 prop 화)
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

describe('S2 · 후보 카드 날짜 서브라인 (AC-1)', () => {
  it('이름과 날짜 서브라인(M/D–M/D · N박 / 없으면 "날짜 없음")을 그린다', () => {
    renderSheet();

    const cardGwangalli = screen.getByTestId(
      'trip-base-staysheet-cand-stay-gwangalli'
    );
    expect(cardGwangalli).toHaveTextContent(/광안리 뷰 호텔/);
    // en dash U+2013·미들닷 U+00B7 — 옛 6.10~6.13(ASCII ~)이 아니다.
    expect(cardGwangalli).toHaveTextContent(/6\/11–6\/12 · 1박/);

    const cardHaeundae = screen.getByTestId(
      'trip-base-staysheet-cand-stay-haeundae'
    );
    expect(cardHaeundae).toHaveTextContent(/6\/10–6\/12 · 2박/);

    const cardGamcheon = screen.getByTestId(
      'trip-base-staysheet-cand-stay-gamcheon'
    );
    expect(cardGamcheon).toHaveTextContent(/감천 게스트하우스/);
    expect(cardGamcheon).toHaveTextContent(/날짜 없음/);
  });

  it('★5 · 가격·거리를 그리지 않는다 (계약 부재 — Figma 목업 복붙 금지, AC-5)', () => {
    renderSheet();

    const card = screen.getByTestId('trip-base-staysheet-cand-stay-gwangalli');
    expect(card).not.toHaveTextContent(/원|₩/); // 가격 없음
    expect(card).not.toHaveTextContent(/\d+\s*m\b|km/); // 거리 없음
  });
});

describe('S3 · 단일 선택 렌더 (AC-3 · ★2)', () => {
  it('선택된 후보만 accessibilityState.selected 다 (색 fill 아님)', () => {
    renderSheet({ selectedSavedStayId: 'stay-gwangalli' });

    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-gwangalli')
    ).toBeSelected();
    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-haeundae')
    ).not.toBeSelected();
  });
});

describe('S4 · 후보 press → onSelect (AC-1)', () => {
  it('누른 후보의 savedStayId 로 onSelect 를 부른다', () => {
    const props = renderSheet();

    fireEvent.press(
      screen.getByTestId('trip-base-staysheet-cand-stay-haeundae')
    );

    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith('stay-haeundae');
  });
});

describe('S5 · 둘러보기 (AC-5)', () => {
  it('숙소 둘러보기 press → onBrowse', () => {
    const props = renderSheet();

    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));

    expect(props.onBrowse).toHaveBeenCalledTimes(1);
  });
});

describe('S6 · 지정 disabled 3단 (AC-7 · ★3)', () => {
  it('선택이 없으면 지정이 진짜 disabled — 눌러도 onAssign 0회', () => {
    const props = renderSheet({ selectedSavedStayId: null });

    const assign = screen.getByTestId('trip-base-staysheet-assign');
    expect(assign).toBeDisabled();

    fireEvent.press(assign);
    expect(props.onAssign).not.toHaveBeenCalled();
  });

  it('짝 · 선택이 있으면 활성 — 누르면 onAssign 1회', () => {
    const props = renderSheet({ selectedSavedStayId: 'stay-gwangalli' });

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

describe('S8 · 실패 인라인 (INV-4)', () => {
  it('assignFailed 면 인라인 오류를 그린다', () => {
    renderSheet({ selectedSavedStayId: 'stay-gwangalli', assignFailed: true });

    expect(screen.getByTestId('trip-base-staysheet-error')).toBeOnTheScreen();
  });

  it('짝 · assignFailed 가 아니면 오류를 안 그린다', () => {
    renderSheet({ selectedSavedStayId: 'stay-gwangalli' });

    expect(screen.queryByTestId('trip-base-staysheet-error')).toBeNull();
  });
});

describe('S9 · 선택 체크 톤 (AC-2)', () => {
  it('선택 후보의 체크 글리프에 tone="primary" 가 전달된다 (분홍 실색은 6-b)', () => {
    renderSheet({ selectedSavedStayId: 'stay-gwangalli' });

    // 글리프 stroke 색은 react-native-svg 가 정수로 가공해 jest 가 못 읽는다(실측 P3) →
    // "tone prop 이 primary 로 전달됐는가"만 잰다(prop 기록형). 단일 선택이라 CheckGlyph 는 1개.
    const check = screen.UNSAFE_getByType(CheckGlyph);
    expect(check.props.tone).toBe('primary');
  });

  it('짝 · 미선택 후보엔 체크가 없다 (색이 아니라 존재로 잼)', () => {
    renderSheet({ selectedSavedStayId: 'stay-gwangalli' });

    // 선택 1개 → CheckGlyph 정확히 1개(2개 이상이면 UNSAFE_getAllByType 로 검출됨).
    expect(screen.UNSAFE_getAllByType(CheckGlyph)).toHaveLength(1);
  });
});

describe('S10 · 새 포맷터 ≠ 옛 formatStayDateRange (★ en dash 함정)', () => {
  it('formatBaseNightRange 는 en dash(U+2013), formatStayDateRange 는 ASCII ~(U+007E) — 둘을 같은 인자로 태워 구분자가 다름을 못박는다', () => {
    const newLine = formatBaseNightRange('2026-06-10', '2026-06-12');
    const oldLine = formatStayDateRange('2026-06-10', '2026-06-12');

    expect(newLine).toContain('–'); // U+2013
    expect(newLine).not.toContain('~');
    expect(oldLine).toContain('~'); // U+007E — 옛 포맷터는 살려 두되 재사용 금지
    expect(oldLine).not.toContain('–');
  });
});
