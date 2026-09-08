import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrefOverrideSheet } from './PrefOverrideSheet';

/**
 * TRIP-669 (S5) g01 취향 편집 바텀시트 — **props-only 무상태 프레젠테이션**(01b D3·D6).
 *
 * 무엇을 보장하나: 시트가 넘겨받은 드래프트(`selected`, 한국어 STYLE 라벨 배열)로 ① 7칩(휴양·미식·
 * 자연·문화예술·액티비티·관광·쇼핑, Figma 순서)과 안내 2문구·단일 적용 버튼을 그리고 ② 선택 칩만
 * **accessibilityState.selected 로** 표시하며 ③ 칩/적용 press 를 받은 콜백으로 정확히 올린다.
 * 이 시트는 **상태를 안 가진다** — 드래프트·오픈은 배선(TripNewStep1Page)이 소유하고, 시트는
 * 완성형 props 를 받아 그릴 뿐이다(자매 CompanionEditSheet 선례).
 *
 * 왜 선택을 색 fill 이 아니라 accessibilityState 로 잠그나: 칩이 선택되면 배경(className)·아이콘
 * (SVG fill)이 바뀌는데, **아이콘 fill 은 jest 렌더 트리에 안 남는다**(repo-traps "글리프 fill
 * 무심판"). 그래서 색으로 선택을 표현하면 뒤바뀜·교차가 안 잡힌다(맹점①). `toBeSelected()` 매처는
 * `computeAriaSelected`(=accessibilityState.selected)만 읽어 className·fill·텍스트와 무관하다
 * (실검증 02a §5-2) — fill 만 바꾸는 뮤턴트도 여기서 red 다.
 *
 * 무엇을 **못** 보나(6-b 실기 전용): `__mocks__/@gorhom/bottom-sheet.tsx`가 통과형 목이라(마운트하면
 * children 무조건 렌더) 실제 슬라이드업·딤 전면 커버·터치 차단은 jest 원리적 사각이다(AC-7·AC-8).
 *
 * 왜 store 실반영을 여기서 안 잠그나: 시트는 props-only 라 store·toggleMulti·null→[] 매핑을 모른다.
 * "적용→setPrefStyleOverride·전해제→[] 저장"의 실반영은 배선 통합 테스트
 * (`TripNewStep1Page.preferenceSheet.integration`)가 store 상태로 증명한다 — 여기선 "칩 press→onToggle,
 * 적용 press→onApply"(배선 신호)까지만 잠근다.
 *
 * 3동작 뼈대: 준비=render(선택 상태 주입) → 실행=press → 단언=toBeSelected/콜백.
 */

// slug ↔ 한국어 라벨(STYLE 카탈로그 순서 = Figma 칩 순서). 시트가 내부에서 STYLE + OnboardingGlyphs
// 로 이 매핑을 만든다(01b D6) — 테스트는 그 결과(순서·라벨·slug testID)를 대조한다.
const CHIPS: { slug: string; label: string }[] = [
  { slug: 'rest', label: '휴양' },
  { slug: 'gourmet', label: '미식' },
  { slug: 'nature', label: '자연' },
  { slug: 'art', label: '문화예술' },
  { slug: 'activity', label: '액티비티' },
  { slug: 'sightseeing', label: '관광' },
  { slug: 'shopping', label: '쇼핑' },
];

interface SheetPropsForTest {
  selected: readonly string[];
  onToggle: (label: string) => void;
  onApply: () => void;
}

function renderSheet(overrides: Partial<SheetPropsForTest> = {}) {
  const spies = {
    onToggle: jest.fn(),
    onApply: jest.fn(),
  };
  const props: SheetPropsForTest = {
    selected: [],
    ...spies,
    ...overrides,
  };
  render(<PrefOverrideSheet {...props} />);
  return spies;
}

describe('PS-1 · AC-1·AC-4 — 7칩·안내 2문구·단일 적용 렌더', () => {
  it('컨테이너·7칩(Figma 순서)·안내 2문구·적용 버튼을 그린다', () => {
    renderSheet({ selected: [] });

    expect(screen.getByTestId('trip-wizard-pref-sheet')).toBeOnTheScreen();

    // 7칩 — slug testID + 한국어 라벨(getByText 완전일치, 부분포함 오검출 없음).
    for (const { slug, label } of CHIPS) {
      expect(
        screen.getByTestId(`trip-wizard-pref-chip-${slug}`)
      ).toBeOnTheScreen();
      expect(screen.getByText(label)).toBeOnTheScreen();
    }

    // 안내 2문구(AC-4) — 부제 + 하단(완전일치).
    expect(screen.getByText('이 여행에만 적용돼요')).toBeOnTheScreen();
    expect(
      screen.getByText(
        '온보딩에서 고른 취향을 가져왔어요 · 프로필 취향은 바뀌지 않아요'
      )
    ).toBeOnTheScreen();

    // 단일 적용 버튼.
    expect(
      screen.getByTestId('trip-wizard-pref-sheet-apply')
    ).toBeOnTheScreen();
  });
});

describe('PS-2 · AC-1 — 칩 press → onToggle(한국어 라벨)', () => {
  it('미식 칩을 누르면 onToggle 이 "미식"으로 불린다', () => {
    const spies = renderSheet({ selected: [] });

    fireEvent.press(screen.getByTestId('trip-wizard-pref-chip-gourmet'));

    expect(spies.onToggle).toHaveBeenCalledWith('미식');
  });
});

describe('PS-3 · ★ AC-1 선택 표식 교차 — accessibilityState (fill 색 아님)', () => {
  it('selected=[미식,자연] 이면 그 둘만 selected, 나머지 5칩은 not selected', () => {
    renderSheet({ selected: ['미식', '자연'] });

    // 선택된 둘.
    expect(screen.getByTestId('trip-wizard-pref-chip-gourmet')).toBeSelected();
    expect(screen.getByTestId('trip-wizard-pref-chip-nature')).toBeSelected();

    // 교차 부재 — 나머지 5칩은 selected 아님(교차 뮤턴트·fill-only 뮤턴트가 여기서 red).
    for (const slug of ['rest', 'art', 'activity', 'sightseeing', 'shopping']) {
      expect(
        screen.getByTestId(`trip-wizard-pref-chip-${slug}`)
      ).not.toBeSelected();
    }
  });
});

describe('PS-4 · AC-5·AC-6 — 전해제(빈 선택) 허용, 적용 활성', () => {
  it('selected=[] 면 7칩 전부 not selected, 적용 버튼은 활성이다', () => {
    renderSheet({ selected: [] });

    for (const { slug } of CHIPS) {
      expect(
        screen.getByTestId(`trip-wizard-pref-chip-${slug}`)
      ).not.toBeSelected();
    }

    // 최소 0 허용 — 전해제여도 적용 가능(닫기 버튼 없이 적용으로만 닫는다).
    expect(
      screen.getByTestId('trip-wizard-pref-sheet-apply')
    ).not.toBeDisabled();
  });
});

describe('PS-5 · AC-3 — 적용 → onApply 만 (편집 콜백 없음)', () => {
  it('"적용" press 가 onApply 를 한 번 부르고 onToggle 은 안 부른다 (커밋은 배선 몫)', () => {
    const spies = renderSheet({ selected: ['미식'] });

    fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));

    expect(spies.onApply).toHaveBeenCalledTimes(1);
    expect(spies.onToggle).not.toHaveBeenCalled();
  });
});

describe('PS-6 · 닫기 버튼 부재 회귀 (구 2버튼 폐기)', () => {
  it('신 디자인은 단일 적용 — 별도 닫기 버튼을 그리지 않는다', () => {
    renderSheet();

    // 구 시트의 [닫기]/[적용] 2버튼 회귀 트립와이어.
    expect(screen.queryByTestId('trip-wizard-pref-sheet-close')).toBeNull();
  });
});
