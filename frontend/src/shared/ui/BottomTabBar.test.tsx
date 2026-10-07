import { readFileSync } from 'fs';
import { join } from 'path';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { BlurView } from 'expo-blur';
import type { ReactTestInstance } from 'react-test-renderer';
import { Path } from 'react-native-svg';

import { BottomTabBar } from './BottomTabBar';

/**
 * AC-6~AC-8 · Q4 — 순수 뷰 탭바(`shared/ui/BottomTabBar`).
 *
 * 무엇을 보장하나: 탭바는 네비게이션을 몰라야 한다(`activeKey`·`onPressTab` prop만으로
 * 동작하는 순수 뷰) — 5탭 렌더 · 활성/비활성 표시 · press 콜백 세 가지를 이 파일이 잠근다.
 * Q4(탭바 전면 커스텀)가 요구하는 접근성 속성(`accessibilityRole="tab"`·
 * `accessibilityState.selected`) 수동 보강이 여기서 강제된다.
 */

const TAB_KEYS = ['home', 'explore', 'itinerary', 'records', 'my'] as const;

// key ↔ Figma 라벨 텍스트 매핑 — B-1이 5개 라벨 전부를 확인한다.
const TAB_LABELS: Record<(typeof TAB_KEYS)[number], string> = {
  home: '홈',
  explore: '탐색',
  itinerary: '일정',
  records: '기록',
  my: '마이',
};

describe('BottomTabBar — 5탭 렌더 (AC-6 · Q4 접근성)', () => {
  it('5개 탭 testID·라벨과 accessibilityRole=tab 요소 5개가 렌더된다', () => {
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    TAB_KEYS.forEach((key) => {
      expect(screen.getByTestId(`shell-tabbar-tab-${key}`)).toBeOnTheScreen();
      expect(screen.getByText(TAB_LABELS[key])).toBeOnTheScreen();
    });

    // Q4: 접근성 수동 보강의 계약 — 5개 탭 모두 role="tab"이어야 한다.
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });
});

describe('BottomTabBar — 활성/비활성 (AC-7)', () => {
  it('activeKey에 해당하는 탭만 selected + 채움 글리프이고, rerender로 활성 탭이 옮겨간다', () => {
    const { rerender } = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );

    // home만 selected + 채움(active) 글리프, 아웃라인(inactive) 글리프는 없다(배타).
    expect(screen.getByTestId('shell-tabbar-tab-home')).toBeSelected();
    expect(
      screen.getByTestId('shell-tabbar-icon-home-active')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('shell-tabbar-icon-home-inactive')).toBeNull();

    // 나머지 4탭은 반대(비활성) 상태.
    TAB_KEYS.filter((key) => key !== 'home').forEach((key) => {
      expect(screen.getByTestId(`shell-tabbar-tab-${key}`)).not.toBeSelected();
      expect(
        screen.getByTestId(`shell-tabbar-icon-${key}-inactive`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`shell-tabbar-icon-${key}-active`)
      ).toBeNull();
    });

    // rerender: 같은 트리에 새 props를 흘려 넣는다(라우트 전환 시 활성 탭 이동의 축소판).
    rerender(<BottomTabBar activeKey="records" onPressTab={jest.fn()} />);

    expect(screen.getByTestId('shell-tabbar-tab-records')).toBeSelected();
    expect(
      screen.getByTestId('shell-tabbar-icon-records-active')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('shell-tabbar-tab-home')).not.toBeSelected();
    expect(
      screen.getByTestId('shell-tabbar-icon-home-inactive')
    ).toBeOnTheScreen();
  });
});

describe('BottomTabBar — press 콜백 (AC-8)', () => {
  it('탭을 누르면 onPressTab이 눌린 순서대로 해당 key로 호출된다', () => {
    const onPressTab = jest.fn();
    render(<BottomTabBar activeKey="home" onPressTab={onPressTab} />);

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-explore'));
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-my'));

    expect(onPressTab).toHaveBeenNthCalledWith(1, 'explore');
    expect(onPressTab).toHaveBeenNthCalledWith(2, 'my');
  });
});

/**
 * TRIP-1104 — 사진 위 가독성: 알약 블러를 올리고(24 → 70) 아이콘·라벨 색은 그대로 둔다.
 * 블러의 실제 세기는 jest 가 못 본다(BlurView prop 까지만) — 눈으로 보는 확인은 6-b 몫.
 */

// 아이콘 안 SVG Path 들의 stroke·fill 색을 대문자로 모아 중복 없이 돌려준다.
function iconColors(icon: ReactTestInstance): string[] {
  const colors = icon
    .findAllByType(Path)
    .flatMap((p) => [p.props.stroke, p.props.fill])
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.toUpperCase());
  return [...new Set(colors)];
}

describe('BottomTabBar — 알약 블러 세기 (TRIP-1104 AC-1)', () => {
  it('알약 BlurView 는 하나이고 intensity 70 · tint light 로 렌더된다', () => {
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    const blurs = screen.UNSAFE_getAllByType(BlurView);
    expect(blurs).toHaveLength(1);
    expect({
      intensity: blurs[0].props.intensity,
      tint: blurs[0].props.tint,
    }).toEqual({ intensity: 70, tint: 'light' });
  });
});

describe('BottomTabBar — 비활성 색 유지 (TRIP-1104 AC-2 · 흰색안 기각)', () => {
  it('비활성 4탭의 아이콘은 MUTED(#6A6A6A)만 쓰고 라벨은 text-muted 이며 흰색이 없다', () => {
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    TAB_KEYS.filter((key) => key !== 'home').forEach((key) => {
      const icon = screen.getByTestId(`shell-tabbar-icon-${key}-inactive`);
      // 앵커 — Path 를 못 찾으면 아래 "흰색 없음"이 빈 배열로 거짓 통과한다.
      expect(icon.findAllByType(Path).length).toBeGreaterThan(0);
      expect(iconColors(icon)).toEqual(['#6A6A6A']);

      const classes = String(
        screen.getByText(TAB_LABELS[key]).props.className
      ).split(/\s+/);
      expect({
        muted: classes.includes('text-muted'),
        onPrimary: classes.includes('text-on-primary'),
        white: classes.includes('text-white'),
      }).toEqual({ muted: true, onPrimary: false, white: false });
    });
  });
});

describe('BottomTabBar — 활성 무회귀 (TRIP-1104 AC-3)', () => {
  it('어느 탭이 활성이든 아이콘은 primary(#FF385C)로 채워지고 라벨은 text-primary 다', () => {
    const { rerender } = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );

    TAB_KEYS.forEach((key) => {
      rerender(<BottomTabBar activeKey={key} onPressTab={jest.fn()} />);

      const icon = screen.getByTestId(`shell-tabbar-icon-${key}-active`);
      expect(iconColors(icon)).toContain('#FF385C');
      expect(iconColors(icon)).not.toContain('#6A6A6A');

      const classes = String(
        screen.getByText(TAB_LABELS[key]).props.className
      ).split(/\s+/);
      expect(classes).toContain('text-primary');
    });
  });
});

describe('BottomTabBar.tsx 주석 — 확정값 표기 (TRIP-1104 AC-4 · 소스 스캔)', () => {
  const SOURCE = readFileSync(join(__dirname, 'BottomTabBar.tsx'), 'utf8');

  // `<BlurView` 줄과 `intensity=` 줄 사이의 `//` 주석 줄만 꺼낸다(없으면 null).
  function blurComment(source: string): string | null {
    const lines = source.split('\n');
    const start = lines.findIndex((l) => l.trim().startsWith('<BlurView'));
    const end = lines.findIndex(
      (l, i) => i > start && /^\s*intensity=/.test(l)
    );
    if (start < 0 || end < 0) return null;
    return lines
      .slice(start + 1, end)
      .filter((l) => l.trim().startsWith('//'))
      .join('\n');
  }

  it('"캘리브레이션 노브" 표기가 사라지고, intensity 바로 위 주석이 확정값과 근거(60~80 범위·기기)를 적는다', () => {
    const comment = blurComment(SOURCE);

    expect(comment).not.toBeNull();
    expect({
      calibrationKnob: SOURCE.includes('캘리브레이션 노브'),
      confirmed: comment?.includes('확정'),
      range: comment?.includes('60~80'),
      device: comment?.includes('기기'),
      ponytailMarker: comment?.includes('ponytail:'),
    }).toEqual({
      calibrationKnob: false,
      confirmed: true,
      range: true,
      device: true,
      ponytailMarker: false,
    });
  });
});

// TRIP-1270 — 최대 글자 크기에서 탭바가 잘리지 않게. 실제 잘림은 jest 가 못 본다(레이아웃 엔진 없음) — 6-b 몫.
describe('BottomTabBar — 큰 글자 대응 (AC-1)', () => {
  const tokens = (el: { props: { className?: unknown } }): string[] =>
    String(el.props.className ?? '')
      .split(/\s+/)
      .filter(Boolean);

  it('루트는 고정 높이 h-[96px] 대신 최소 높이 min-h-[96px] 이고, 나머지 위치 토큰은 그대로다', () => {
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    const root = tokens(screen.getByTestId('shell-tabbar-root'));
    expect(root).toContain('min-h-[96px]');
    // 토큰 배열 toContain 은 원소 완전 일치라 'min-h-[96px]' 가 여기 걸리지 않는다.
    expect(root).not.toContain('h-[96px]');
    expect(root).toEqual(
      expect.arrayContaining([
        'absolute',
        'inset-x-0',
        'bottom-0',
        'px-[30px]',
        'pt-[26px]',
      ])
    );
  });

  it('활성·비활성 다섯 라벨 모두 한 줄(numberOfLines 1)이고 폭이 모자랄 때만 줄여 맞춘다(adjustsFontSizeToFit)', () => {
    // activeKey=home 하나로 활성 라벨 1 + 비활성 라벨 4 — className 삼항의 두 분기를 다 본다.
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    TAB_KEYS.forEach((key) => {
      const label = screen.getByText(TAB_LABELS[key]);
      expect({
        key,
        numberOfLines: label.props.numberOfLines,
        adjustsFontSizeToFit: label.props.adjustsFontSizeToFit,
      }).toEqual({ key, numberOfLines: 1, adjustsFontSizeToFit: true });
    });
  });
});
