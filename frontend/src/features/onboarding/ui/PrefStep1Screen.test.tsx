import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrefStep1Screen, type PrefStep1ScreenProps } from './PrefStep1Screen';

/**
 * AC1 · US-ONB-05(스타일 복수)·US-ONB-15(페이스 단일)·US-ONB-11(탈출구) — 취향 1/2 화면
 * 프레젠테이션.
 *
 * 무엇을 보장하나: Figma c09 그대로 스타일 7카드 + 페이스 3항목을 그리고, 선택 상태를
 * accessibilityState.selected로 보여주며, back chevron 없이 상·하단 '나중에 설정하고
 * 시작'만 탈출구로 남고, CTA는 0개 선택에도 항상 활성이다. 네트워크·스토어를 모르는
 * 순수 프레젠테이션이라 props 픽스처만으로 검증한다.
 *
 * 3동작: 준비(props 픽스처) → 실행(렌더/탭) → 단언(무엇이 보이고 무엇이 호출되는가).
 */

const STYLE_SLUGS = [
  'rest',
  'gourmet',
  'nature',
  'art',
  'activity',
  'sightseeing',
  'shopping',
] as const;

const PACE_SLUGS = ['relaxed', 'balanced', 'packed'] as const;

function makeProps(
  overrides: Partial<PrefStep1ScreenProps> = {}
): PrefStep1ScreenProps {
  return {
    selectedStyles: null,
    selectedPace: null,
    onToggleStyle: jest.fn(),
    onTogglePace: jest.fn(),
    onNext: jest.fn(),
    onSkipAll: jest.fn(),
    ...overrides,
  };
}

describe('PrefStep1Screen — 스타일 그리드 (AC1 · US-ONB-05 · 3-1 · 3-2 · 3-3)', () => {
  it('스타일 카드 7개가 전부 렌더된다 (3-1)', () => {
    // 준비 — 전 축 미설정 픽스처.
    render(<PrefStep1Screen {...makeProps()} />);

    // 단언 — 7개 slug 카드가 모두 존재한다(개수 고정 — 6개로 줄면 red).
    STYLE_SLUGS.forEach((slug) => {
      expect(
        screen.getByTestId(`onboarding-pref1-style-${slug}`)
      ).toBeOnTheScreen();
    });
  });

  it('선택된 카드는 selected로 표시되고 미선택 카드는 아니다 (3-2)', () => {
    // 준비 — rest·gourmet이 이미 선택된 상태.
    render(
      <PrefStep1Screen
        {...makeProps({ selectedStyles: ['rest', 'gourmet'] })}
      />
    );

    // 단언 — accessibilityState.selected를 toBeSelected()로 확인(§3-2 관찰 계약).
    expect(screen.getByTestId('onboarding-pref1-style-rest')).toBeSelected();
    expect(screen.getByTestId('onboarding-pref1-style-gourmet')).toBeSelected();
    expect(
      screen.getByTestId('onboarding-pref1-style-nature')
    ).not.toBeSelected();
  });

  it('카드를 탭하면 그 slug로 콜백이 호출된다 (3-3)', () => {
    // 준비 — 콜백을 jest.fn으로 관찰.
    const onToggleStyle = jest.fn();
    render(<PrefStep1Screen {...makeProps({ onToggleStyle })} />);

    // 실행 — 'nature' 카드를 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-style-nature'));

    // 단언 — 탭한 카드의 slug로 정확히 1회 호출된다.
    expect(onToggleStyle).toHaveBeenCalledWith('nature');
    expect(onToggleStyle).toHaveBeenCalledTimes(1);
  });
});

describe('PrefStep1Screen — 페이스 (AC1 · US-ONB-15 · 3-4)', () => {
  it('페이스 항목 3개가 렌더되고 탭하면 그 slug로 콜백이 호출된다', () => {
    // 준비 — 기본 픽스처. onTogglePace를 나중에 단언하려고 변수로 꺼내 둔다.
    const props = makeProps();
    render(<PrefStep1Screen {...props} />);

    // 단언(존재) — 3개 항목 전부.
    PACE_SLUGS.forEach((slug) => {
      expect(
        screen.getByTestId(`onboarding-pref1-pace-${slug}`)
      ).toBeOnTheScreen();
    });

    // 실행 — 'balanced' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-pace-balanced'));

    // 단언(콜백) — 탭한 slug로 정확히 호출된다.
    expect(props.onTogglePace).toHaveBeenCalledWith('balanced');
  });
});

describe('PrefStep1Screen — 탈출구 구성 (AC1 · US-ONB-11 · 3-5)', () => {
  it('back chevron은 없고 상단 건너뛰기만 탈출구로 존재한다 (TRIP-718 · 하단 링크 제거)', () => {
    // 준비 — 기본 픽스처.
    render(<PrefStep1Screen {...makeProps()} />);

    // 단언(긍정) — 루트가 실제로 그려진다(부재 단언과 짝 — §7-5, 가짜 통과 방지).
    expect(screen.getByTestId('onboarding-pref1-root')).toBeOnTheScreen();

    // 단언(부정) — back chevron은 만들지 않는다(예약 id만 있고 실물 없음).
    expect(screen.queryByTestId('onboarding-pref1-back')).toBeNull();

    // 단언 — 상단 skip 만 존재. TRIP-718: Figma 1643:1183 에 CTA 아래 하단 링크가 없어 제거했다
    // (US-ONB-11 탈출구는 상단 하나로 충족 — queryBy* 로 부재 단언).
    expect(screen.getByTestId('onboarding-pref1-skip-top')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-pref1-skip-bottom')).toBeNull();

    // 단언 — '나중에 설정하고 시작' 은 이제 상단 1곳에만 나온다.
    expect(screen.getAllByText('나중에 설정하고 시작')).toHaveLength(1);
  });
});

describe('PrefStep1Screen — 0개 선택에도 진행 (AC1 · 인터뷰4 · 3-6)', () => {
  it('아무것도 안 골라도 다음 버튼은 활성이고 탭하면 onNext가 호출된다', () => {
    // 준비 — 전 축 null + onNext 관찰.
    const onNext = jest.fn();
    render(<PrefStep1Screen {...makeProps({ onNext })} />);

    // 단언 — CTA에 disabled prop이 없다(인터뷰4: 항상 활성). toBeEnabled로 명시 확인
    // ("탭이 된다"만 보면 언젠가 disabled가 생겨도 잡지 못한다 — §7-9).
    expect(screen.getByTestId('onboarding-pref1-next')).toBeEnabled();

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-next'));

    // 단언 — onNext가 호출된다.
    expect(onNext).toHaveBeenCalled();
  });
});

describe('PrefStep1Screen — 핵심 문구·skip 콜백 (AC1 · 3-7)', () => {
  it('타이틀·서브·info·스텝번호가 보이고 상단 skip이 콜백을 부른다', () => {
    // 준비 — onSkipAll 관찰.
    const onSkipAll = jest.fn();
    render(<PrefStep1Screen {...makeProps({ onSkipAll })} />);

    // 단언 — 핵심 문구·스텝번호. TRIP-718: Figma 는 공백 포함 "1 / 2".
    expect(screen.getByText('어떤 여행을 좋아하세요?')).toBeOnTheScreen();
    expect(screen.getByText('여러 개 골라도 좋아요')).toBeOnTheScreen();
    expect(screen.getByText('1 / 2')).toBeOnTheScreen();
    // info 배너는 testID 존재만 단언한다(§7-15 — 본문 카피 결합 회피).
    expect(screen.getByTestId('onboarding-pref1-info')).toBeOnTheScreen();

    // 실행 — 상단 skip 탭(TRIP-718 로 하단 링크 제거, 탈출구는 상단 하나).
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));

    // 단언 — onSkipAll 1회 호출(AC-11-1).
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });
});

describe('PrefStep1Screen — 진행점 색 (TRIP-718 · Figma 1643:1183)', () => {
  // className 은 NativeWind 가 소비 전이라 jest 렌더 트리에 평문 prop 으로 남는다 — 공백으로
  // 쪼갠 '토큰 배열'로 비교한다(부분 문자열 오탐 차단: 'bg-hairline' 은 'bg-hairline-strong'
  // 의 부분열이지만 토큰 배열에는 원소로 없다). TripWizardStep1Screen 진행 세그 심판과 동형.
  const tokens = (testID: string): string[] =>
    String(screen.getByTestId(testID).props.className)
      .split(/\s+/)
      .filter(Boolean);

  it('채움 점은 bg-primary, 빈 점은 bg-hairline 이다 (bg-ink·bg-hairline-strong 회귀 금지)', () => {
    render(<PrefStep1Screen {...makeProps()} />);

    // 채움 점 — Figma 는 primary(코랄). 종전 bg-ink 로 회귀하면 토큰 배열에 'bg-primary' 부재 → red.
    expect(tokens('onboarding-pref1-progress-active')).toContain('bg-primary');
    // 빈 점 — Figma 실측 hairline(옅음). bg-hairline-strong 로 회귀하면 'bg-hairline' 원소 부재 → red.
    expect(tokens('onboarding-pref1-progress-empty')).toContain('bg-hairline');
  });
});
