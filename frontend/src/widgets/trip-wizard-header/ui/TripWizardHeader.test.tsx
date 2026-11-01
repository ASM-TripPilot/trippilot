import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { TripWizardHeader } from './TripWizardHeader';

/**
 * 여행 만들기 위저드 공용 헤더(‹ · 제목 · 진행 막대 4칸 · "N / 4") — TRIP-1266(QA F7).
 * 1/4(g01)·2/4(g02)·3/4(h01) 세 화면이 이 한 컴포넌트로 헤더를 그린다. 치수는 Figma g01·g02 앱바
 * (높이 56 = 위아래 16 + 글리프 24, 좌우 16, ‹–제목 10, 막대 14×4 r2 간격 4, 막대–분수 6).
 *
 * 위젯은 features 를 모른다 — "N / 4" 문자열과 채울 칸 수는 소비처가 `progress` 로 넘기고, 위젯은
 * 그대로 그린다. `progress` 가 없으면 진행 표시 통째로 없음(2/4 거점 편집 얼굴).
 *
 * jest 사각: 치수·실제 픽셀 위치·진행 칸 색·‹ 글리프는 실화면 QA 몫.
 *
 * 3동작 뼈대: 준비=props 로 렌더 → 실행=없음 / ‹ press → 단언=트리·콜백.
 */

function renderHeader(
  over: Partial<Parameters<typeof TripWizardHeader>[0]> = {}
) {
  const props = {
    title: '여행 만들기',
    onBack: jest.fn(),
    backTestID: 'x-back',
    progress: { filled: 1, label: '1 / 4' },
    ...over,
  };
  render(<TripWizardHeader {...props} />);
  return props;
}

describe('위저드 공용 헤더', () => {
  it('루트 testID 안에 제목이 그대로 그려진다', () => {
    renderHeader();

    const root = screen.getByTestId('trip-wizard-header');
    expect(within(root).getByText('여행 만들기')).toBeOnTheScreen();
  });

  // 진행 칸 색(filled 만큼 primary)·막대 폭은 jest-cut 에서 지웠다 — 색 토큰이라 실화면 QA 몫(trip-create.md).

  it('분수는 넘긴 label 그대로 진행 행 안에 있다', () => {
    renderHeader({ progress: { filled: 3, label: '3 / 4' } });

    const progress = screen.getByTestId('trip-wizard-progress');
    expect(within(progress).getByText('3 / 4')).toBeOnTheScreen();
  });

  it('progress 가 없으면 진행 막대·분수가 통째로 없다(편집 얼굴) — 제목·‹ 는 남는다', () => {
    renderHeader({ title: '거점 숙소', progress: undefined });

    // 긍정 짝 — 헤더가 아예 안 그려져서 부정 단언이 공짜로 통과하는 것을 막는다.
    const root = screen.getByTestId('trip-wizard-header');
    expect(within(root).getByText('거점 숙소')).toBeOnTheScreen();
    expect(within(root).getByTestId('x-back')).toBeOnTheScreen();

    expect(screen.queryAllByTestId(/^trip-wizard-progress/)).toHaveLength(0);
    expect(screen.queryByText(/\/ 4/)).toBeNull();
  });

  it('‹ 는 받은 testID 로 그려지고, 버튼·"뒤로" 라벨을 갖고, 누르면 onBack 을 한 번 부른다', () => {
    const props = renderHeader({ backTestID: 'x-back' });

    const back = screen.getByTestId('x-back');
    expect(back.props.accessibilityRole).toBe('button');
    expect(back.props.accessibilityLabel).toBe('뒤로');

    fireEvent.press(back);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  // ‹ 글리프(BackChevronGlyph) 존재 단언은 jest-cut 에서 지웠다 — SVG 생김새라 실화면 QA 몫.
});
