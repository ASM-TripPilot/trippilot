import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MyPageScreen } from './MyPageScreen';

/**
 * TRIP-776 · l03 마이페이지 empty — 순수 화면(props + 콜백)의 "지난 여행" 섹션·캘린더 링크.
 * TRIP-1123 · Figma 4755:3123 로 교체 — 세그·여행 카드·빈 문구·[새 여행 만들기] CTA 가 사라졌다(결정 2(b)).
 *
 * 무엇을 보장하나:
 *  - 🔴 1123 AC-2(화면) 예정이 0건이어도 빈 문구("예정된 여행이 없어요…")·CTA(`my-create-trip`)·세그
 *    (`my-trip-segment*`)가 없다. 화면 props 에서도 세그·카드·CTA 자리가 빠졌다(타입 계약).
 *  - 🔴 1123 AC-6(배선) 화면은 `onPressCount` 를 프로필 카드로 그대로 넘긴다 — 칸을 누르면 그 칸 이름으로 1회.
 *    `counts` 가 null 이면 숫자 자리가 `–` 다(AC-5 표시).
 *  - AC-6(캘린더, TRIP-776) "지난 여행" 섹션에 "캘린더" 링크(`my-past-calendar`)가 있고 누르면 콜백이 1회다.
 *    섹션이 없거나 콜백이 안 들어오면 링크도 없다(누르면 반응 없는 것 0 — TRIP-939). 종료 여행이 0건이어도
 *    링크는 남는다 — 캘린더는 회고 진입이 아니다(BR-U6-23 이 숨기는 것은 회고 진입뿐, US-REC-14).
 *
 * *(개념 — `ComponentProps<typeof X>`)* 컴포넌트 X 가 받는 props 의 타입을 그대로 꺼내 쓴다. 기본 props
 *  한 벌을 만들고 케이스마다 필요한 칸만 덮어쓴다(`{ ...base(), ...over }`).
 *
 * 3동작: 준비(props) → 실행(render·press) → 단언.
 */

type Props = ComponentProps<typeof MyPageScreen>;

const noop = () => {};

function base(over: Partial<Props> = {}): Props {
  return {
    nickname: '여행자123',
    email: 'trippilot@email.com',
    counts: { upcoming: 0, active: 0, ended: 0 },
    showPast: true,
    pastCards: null,
    pastEmpty: true,
    ...over,
  };
}

describe('🔴 1123 AC-2 · 목록·빈 문구·CTA 가 없다', () => {
  it('예정 0건이어도 빈 문구·[새 여행 만들기]·세그가 없고, 프로필 카드와 지난 여행은 있다', () => {
    // 준비·실행 — 옛 화면이면 이 조건에서 빈 문구와 CTA 가 떴다.
    render(<MyPageScreen {...base({ onPressCalendar: noop })} />);

    // 단언(부재)
    expect(screen.queryAllByText(/예정된 여행이 없어요/)).toHaveLength(0);
    expect(screen.queryByTestId('my-create-trip')).toBeNull();
    expect(screen.queryByTestId('my-create-trip-plus')).toBeNull();
    expect(screen.queryByText('새 여행 만들기')).toBeNull();
    expect(screen.queryAllByTestId(/^my-trip-segment/)).toHaveLength(0);
    // 단언(존재 짝) — 화면이 통째로 안 그려져 공짜 통과하는 것을 막는다.
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
    expect(screen.getByText('아직 종료된 여행이 없습니다')).toBeOnTheScreen();
  });
});

describe('🔴 1123 AC-6·AC-5 · 숫자 칸 배선(화면 → 프로필 카드)', () => {
  it('onPressCount 를 받으면 종료 칸을 눌렀을 때 "ended" 로 1회 불린다', () => {
    const onPressCount = jest.fn();
    render(<MyPageScreen {...base({ onPressCount })} />);

    fireEvent.press(screen.getByTestId('my-profile-count-ended'));

    expect(onPressCount).toHaveBeenCalledTimes(1);
    expect(onPressCount).toHaveBeenCalledWith('ended');
  });

  it('counts 가 null 이면 세 칸 숫자 자리가 – 다', () => {
    render(<MyPageScreen {...base({ counts: null, showPast: false })} />);

    (['upcoming', 'active', 'ended'] as const).forEach((bucket) => {
      expect(
        screen.getByTestId(`my-profile-count-${bucket}-value`)
      ).toHaveTextContent('\u2013');
    });
  });
});

describe('🔴 AC-6 · 지난 여행 "캘린더" 링크', () => {
  it('섹션이 보이고 콜백이 있으면 링크가 있고, 누르면 콜백 1회', () => {
    const onPressCalendar = jest.fn();
    render(
      <MyPageScreen
        {...base({ pastEmpty: false, pastCards: null, onPressCalendar })}
      />
    );

    const link = screen.getByTestId('my-past-calendar');
    expect(link.props.accessibilityRole).toBe('button');
    // 글자는 "캘린더"를 담는다(› 는 글자든 글리프든 자유 — 정규식 = 부분 일치).
    expect(link).toHaveTextContent(/캘린더/);

    fireEvent.press(link);
    expect(onPressCalendar).toHaveBeenCalledTimes(1);
  });

  it('종료 여행이 0건이어도 링크는 남고, 안내 문구가 뜨고, 회고 진입은 0이다', () => {
    render(
      <MyPageScreen {...base({ pastEmpty: true, onPressCalendar: noop })} />
    );

    expect(screen.getByTestId('my-past-calendar')).toBeOnTheScreen();
    expect(screen.getByText('아직 종료된 여행이 없습니다')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^my-trip-reflection-/)).toHaveLength(0);
  });

  it('섹션이 안 보이면(showPast=false) 콜백이 있어도 링크가 없다', () => {
    render(
      <MyPageScreen {...base({ showPast: false, onPressCalendar: noop })} />
    );

    expect(screen.queryByTestId('my-past-calendar')).toBeNull();
    expect(screen.queryByText(/캘린더/)).toBeNull();
    // 짝 앵커 — 화면은 그려졌다.
    expect(screen.getByTestId('my-page-root')).toBeOnTheScreen();
  });

  it('콜백이 안 들어오면 섹션이 보여도 링크를 그리지 않는다(누를 곳 없는 링크 0)', () => {
    render(<MyPageScreen {...base()} />);

    expect(screen.queryByTestId('my-past-calendar')).toBeNull();
    expect(screen.queryByText(/캘린더/)).toBeNull();
    // 짝 앵커 — 섹션은 보인다.
    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
  });
});
