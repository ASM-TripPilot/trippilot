import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { Path } from 'react-native-svg';

import { TripWizardHeader } from './TripWizardHeader';
import { BackChevronGlyph } from './TripWizardHeaderGlyphs';

/**
 * 여행 만들기 위저드 공용 헤더(‹ · 제목 · 진행 막대 4칸 · "N / 4") — TRIP-1266(QA F7).
 * 1/4(g01)·2/4(g02)·3/4(h01) 세 화면이 이 한 컴포넌트로 헤더를 그린다. 치수는 Figma g01·g02 앱바
 * (높이 56 = 위아래 16 + 글리프 24, 좌우 16, ‹–제목 10, 막대 14×4 r2 간격 4, 막대–분수 6).
 *
 * 위젯은 features 를 모른다 — "N / 4" 문자열과 채울 칸 수는 소비처가 `progress` 로 넘기고, 위젯은
 * 그대로 그린다. `progress` 가 없으면 진행 표시 통째로 없음(2/4 거점 편집 얼굴).
 *
 * jest 사각: 실제 픽셀 위치(세 화면에서 ‹·제목 x/y 가 같은가)는 6-b 실화면 몫. 여기는 className 까지.
 *
 * 3동작 뼈대: 준비=props 로 렌더 → 실행=없음 / ‹ press → 단언=트리·className 토큰·콜백.
 */

/** className 을 공백으로 쪼갠 토큰 배열 — 부분 문자열 오탐(`bg-primary` ⊂ `bg-primary-pale`)을 막는다. */
function tokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

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

  it('앱바 치수가 g01·g02 기준이다 — 여백·간격 토큰은 정확히 px-lg · py-lg · gap-[10px]', () => {
    renderHeader();

    const rootTokens = tokens(screen.getByTestId('trip-wizard-header'));
    expect(rootTokens).toEqual(
      expect.arrayContaining(['flex-row', 'items-center'])
    );
    // 포함이 아니라 "정확히 이 셋" — 옛 pt-xl·pb-[14px] 같은 토큰이 남으면 뒤 토큰이 이겨 y가 다시 튄다.
    expect(
      rootTokens.filter((t) => /^(p[trblxy]?|gap)-/.test(t)).sort()
    ).toEqual(['gap-[10px]', 'px-lg', 'py-lg']);

    const titleTokens = tokens(screen.getByText('여행 만들기'));
    expect(titleTokens).toEqual(
      expect.arrayContaining(['text-section', 'font-noto-bold', 'text-ink'])
    );
    expect(titleTokens).not.toContain('text-[18px]');
  });

  it.each([1, 2, 3])(
    'filled=%i 이면 그 수만큼 앞 칸만 primary, 나머지는 hairline-strong 이고 4칸 모두 같은 14px 막대다',
    (filled) => {
      renderHeader({ progress: { filled, label: `${filled} / 4` } });

      [1, 2, 3, 4].forEach((n) => {
        const seg = tokens(screen.getByTestId(`trip-wizard-progress-seg-${n}`));
        expect(seg).toContain(
          n <= filled ? 'bg-primary' : 'bg-hairline-strong'
        );
        expect(seg).toEqual(
          expect.arrayContaining(['h-1', 'w-[14px]', 'rounded-[2px]'])
        );
        // 옛 1/4 활성 칸 폭(20)은 사라졌다 — Figma 는 4칸 모두 같은 폭.
        expect(seg).not.toContain('w-[20px]');
      });
      expect(screen.queryByTestId('trip-wizard-progress-seg-5')).toBeNull();
    }
  );

  it('분수는 넘긴 label 그대로 진행 행 안에 있고, 막대–분수 간격은 gap-xs + ml-[2px] 이다', () => {
    renderHeader({ progress: { filled: 3, label: '3 / 4' } });

    const progress = screen.getByTestId('trip-wizard-progress');
    expect(tokens(progress)).toEqual(
      expect.arrayContaining(['flex-row', 'items-center', 'gap-xs'])
    );
    const label = within(progress).getByText('3 / 4');
    expect(tokens(label)).toEqual(
      expect.arrayContaining([
        'font-inter-bold',
        'text-caption',
        'text-muted',
        'ml-[2px]',
      ])
    );
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

  // 5-b 사후 개정 — 위 단언은 전부 Pressable 의 prop 이라 ‹ 글리프를 지워도 green 이었다(빈 버튼).
  it('‹ 버튼 안에 뒤로 글리프(BackChevron 경로)가 그려진다', () => {
    renderHeader({ backTestID: 'x-back' });

    const back = screen.getByTestId('x-back');
    expect(within(back).UNSAFE_getByType(BackChevronGlyph)).toBeTruthy();
    // 다른 글리프로 바꿔 끼운 경우까지 — 경로가 Figma ‹ 그대로인가(SVG 색·굵기는 jest 사각).
    expect(within(back).UNSAFE_getByType(Path).props.d).toBe(
      'M15 18L9 12L15 6'
    );
  });
});
