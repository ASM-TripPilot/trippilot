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
  it('back chevron은 없고 상·하단 건너뛰기만 탈출구로 존재한다', () => {
    // 준비 — 기본 픽스처.
    render(<PrefStep1Screen {...makeProps()} />);

    // 단언(긍정) — 루트가 실제로 그려진다(부재 단언과 짝 — §7-5, 가짜 통과 방지).
    expect(screen.getByTestId('onboarding-pref1-root')).toBeOnTheScreen();

    // 단언(부정) — back chevron은 만들지 않는다(예약 id만 있고 실물 없음).
    expect(screen.queryByTestId('onboarding-pref1-back')).toBeNull();

    // 단언 — 상·하단 skip 두 곳이 모두 존재.
    expect(screen.getByTestId('onboarding-pref1-skip-top')).toBeOnTheScreen();
    expect(
      screen.getByTestId('onboarding-pref1-skip-bottom')
    ).toBeOnTheScreen();

    // 단언 — 같은 문구('나중에 설정하고 시작')가 상·하단 2곳에 나온다(Figma 채택 문구 — §7-15).
    expect(screen.getAllByText('나중에 설정하고 시작')).toHaveLength(2);
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
  it('타이틀·서브·info·스텝번호가 보이고 상·하단 skip이 같은 콜백을 부른다', () => {
    // 준비 — onSkipAll 관찰.
    const onSkipAll = jest.fn();
    render(<PrefStep1Screen {...makeProps({ onSkipAll })} />);

    // 단언 — 핵심 문구·스텝번호.
    expect(screen.getByText('어떤 여행을 좋아하세요?')).toBeOnTheScreen();
    expect(screen.getByText('여러 개 골라도 좋아요')).toBeOnTheScreen();
    expect(screen.getByText('1/2')).toBeOnTheScreen();
    // info 배너는 testID 존재만 단언한다(§7-15 — 본문 카피 결합 회피).
    expect(screen.getByTestId('onboarding-pref1-info')).toBeOnTheScreen();

    // 실행 — 상단 skip 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));
    // 실행 — 하단 skip 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-bottom'));

    // 단언 — 상·하단이 같은 동작(onSkipAll)을 2회 호출한다(AC-11-1·2).
    expect(onSkipAll).toHaveBeenCalledTimes(2);
  });
});
