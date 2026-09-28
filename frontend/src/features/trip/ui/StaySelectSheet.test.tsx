import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SavedStay } from '@/shared/api/generated/schemas';

import { StaySelectSheet } from './StaySelectSheet';
import { CheckGlyph } from './TripGlyphs';

/**
 * TRIP-673 g02 숙소 선택 시트(S9) → TRIP-741 후보 카드 Figma 정합.
 *
 * 무엇을 보장하나 — 시트는 조회·라우터·드래프트를 모른다. 완성된 props(제목·날짜 라벨·후보·
 * 선택 id·콜백)만 받아 그린다:
 *  - **헤더**(AC-1) 박 라벨·지역 제목 + "{날짜(요일)} 밤 · 어디서 묵을까요?" 부제.
 *  - **후보 카드**(AC-1) 이름 + 날짜 서브라인 = `M/D–M/D · N박`(en dash U+2013). 날짜가 없는 후보는
 *    그 줄을 그리지 않는다(TRIP-1052 결정 1(b) — '날짜 없음' 문구 금지). 구분자 잠금은
 *    `entities/trip/lib/formatTripPeriod.test.ts` B 가 진다(옛 ASCII ~ 포맷터는 TRIP-1052 에서 삭제).
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
    linkedTripIds: [],
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

// TRIP-741 픽스처 3건 — 광안리 뷰 호텔(선택)/해운대 오션 호텔/감천 게스트하우스(날짜 없는 후보).
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
  linkedTripIds: [],
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

describe('🔴 S2 · 후보 카드 날짜 서브라인 (AC-1 · TRIP-1052 AC-5)', () => {
  it('이름과 날짜 서브라인(M/D–M/D · N박)을 그리고, 날짜가 없는 후보는 그 줄을 그리지 않는다', () => {
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
    // 날짜 없는 후보 — 문자열 인자는 **완전 일치**라 카드 전체 글자가 이름뿐일 때만 통과한다.
    // '날짜 없음'·'미입력'·'–'·'박' 어떤 대체 문구가 붙어도 red(빈 Text 노드는 못 본다 — 6-b).
    expect(cardGamcheon).toHaveTextContent('감천 게스트하우스');
    expect(within(cardGamcheon).queryByText(/날짜 없음|미입력/)).toBeNull();
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

/**
 * 후보 카드 **루트**만 고르는 testID 패턴. `SavedStayCard`는 루트 밑에 `{루트}-photo`·`-photo-placeholder`·
 * `-base-badge`·`-meta`·`-price`(TRIP-1074) 하위 testID를 더 달아서, 접두만 보는 `/^trip-base-staysheet-cand-/`는
 * 카드 한 장을 두 번 센다(실측 3장 → 6). 개수를 셀 때는 이 패턴을 쓴다.
 */
const CARD_ROOT =
  /^trip-base-staysheet-cand-(?!.*-(photo|photo-placeholder|base-badge|meta|price)$)/;

/**
 * TRIP-1011(#036 · D8) — 섹션 렌더. 나누는 계산은 배선·모델 몫이고(`staySheetSections`), 시트는 받은
 * `sections` 를 헤더+카드 묶음으로 그리기만 한다(props-only 유지).
 */
describe('S11 · sections 가 오면 헤더+카드 묶음 두 개로 그린다 (AC-4 · 01b Q3)', () => {
  const SECTIONS = [
    { key: 'here' as const, title: '부산광역시 숙소', candidates: [HAEUNDAE] },
    {
      key: 'other' as const,
      title: '다른 지역 · 위치 확인 안 됨',
      candidates: [GWANGALLI, GAMCHEON],
    },
  ];

  it('두 섹션 헤더 문구가 그대로 뜨고, 카드는 자기 섹션 안에 있다', () => {
    renderSheet({ sections: SECTIONS });

    const here = screen.getByTestId('trip-base-staysheet-section-here');
    const other = screen.getByTestId('trip-base-staysheet-section-other');
    // 헤더 문구 — 문자열 인자라 완전 일치(★1).
    expect(
      screen.getByTestId('trip-base-staysheet-section-here-title')
    ).toHaveTextContent('부산광역시 숙소');
    expect(
      screen.getByTestId('trip-base-staysheet-section-other-title')
    ).toHaveTextContent('다른 지역 · 위치 확인 안 됨');

    // 카드 배치 — 섹션 컨테이너 안에서 센다.
    expect(
      within(here).getByTestId('trip-base-staysheet-cand-stay-haeundae')
    ).toBeOnTheScreen();
    expect(within(here).queryAllByTestId(CARD_ROOT)).toHaveLength(1);
    expect(within(other).queryAllByTestId(CARD_ROOT)).toHaveLength(2);
  });

  it('★ candidates 와 sections 를 함께 받아도 카드는 한 번씩만 그린다 (중복 렌더 0 · 숨김 0)', () => {
    // renderSheet 기본 candidates 는 같은 세 곳이다 — 둘 다 그리면 6장이 된다.
    renderSheet({ sections: SECTIONS });

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(3);
  });

  it('다른 지역 섹션의 카드도 똑같이 선택·지정된다 (D8 — 숨기지도 막지도 않는다)', () => {
    const props = renderSheet({
      sections: SECTIONS,
      selectedSavedStayId: 'stay-gamcheon',
    });

    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-gamcheon')
    ).toBeSelected();
    fireEvent.press(
      screen.getByTestId('trip-base-staysheet-cand-stay-gwangalli')
    );
    expect(props.onSelect).toHaveBeenCalledWith('stay-gwangalli');

    expect(screen.getByTestId('trip-base-staysheet-assign')).toBeEnabled();
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(props.onAssign).toHaveBeenCalledTimes(1);
  });
});

describe('S12 · sections 가 없으면 지금처럼 헤더 없는 한 줄 목록 (01b Q3)', () => {
  it('섹션 컨테이너·헤더가 0건이고 카드는 전부 그린다', () => {
    renderSheet();

    // 긍정 앵커 — 목록 자체는 그려졌다(시트가 통째로 안 그려진 공짜 통과 차단).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(3);
    expect(
      screen.queryAllByTestId(/^trip-base-staysheet-section-/)
    ).toHaveLength(0);
  });
});

/**
 * TRIP-1074 — 시트가 후보의 `region`(배선이 주소에서 뽑아 내린 시군구 라벨)을 평면·섹션 두 경로 모두에서
 * 카드 서브라인으로 넘긴다. 라벨 계산은 시트 밖이라 여기선 region 을 직접 준다(시트는 props-only).
 */
describe('🔴 S13 · 동네 라벨이 서브라인 앞에 붙는다 — 평면·섹션 둘 다 (TRIP-1074 AC-4 · AC-8 · AC-11)', () => {
  const LABELED = { ...GWANGALLI, region: '수영구' };

  it.each<[string, Partial<Parameters<typeof StaySelectSheet>[0]>]>([
    ['평면 목록', { candidates: [LABELED, GAMCHEON] }],
    [
      '섹션 목록',
      {
        candidates: [LABELED, GAMCHEON],
        sections: [
          { key: 'here', title: '부산광역시 숙소', candidates: [LABELED] },
          { key: 'other', title: '다른 지역', candidates: [GAMCHEON] },
        ],
      },
    ],
  ])(
    '%s — 라벨 카드는 "수영구 · 날짜", 라벨·날짜 없는 카드는 서브라인 없음, 가격 줄 0',
    (_, over) => {
      renderSheet(over);

      expect(
        screen.getByTestId('trip-base-staysheet-cand-stay-gwangalli-meta')
      ).toHaveTextContent('수영구 · 6/11–6/12 · 1박');
      expect(
        screen.queryByTestId('trip-base-staysheet-cand-stay-gamcheon-meta')
      ).toBeNull();
      // 실데이터 경로엔 priceLabel 이 없다 — 가격 줄을 지어내지 않는다(결정 4(a)).
      expect(screen.queryAllByTestId(/-price$/)).toHaveLength(0);
    }
  );
});
