import type { ComponentProps } from 'react';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { MyPageScreen } from './MyPageScreen';

/**
 * TRIP-776 · l03 마이페이지 empty(Figma 1603:2414) — 순수 화면(props + 콜백)의 빈 상태·CTA·캘린더 링크.
 *
 * 무엇을 보장하나:
 *  - AC-1 예정 탭이 비었으면 문구가 **한 조각** "예정된 여행이 없어요 · 새 여행을 만들어 보세요" 다.
 *    진행 중·종료 탭의 빈 문구는 그대로다.
 *  - AC-2 CTA 글자는 "새 여행 만들기" 하나뿐이다("+ " 글자 없음). 플러스는 글자가 아니라 버튼 안 글리프
 *    (`my-create-trip-plus`)다. 누르면 콜백이 정확히 1회.
 *  - AC-6(캘린더) "지난 여행" 섹션에 "캘린더" 링크(`my-past-calendar`)가 있고 누르면 콜백이 1회다.
 *    섹션이 없거나 콜백이 안 들어오면 링크도 없다(누르면 반응 없는 것 0 — TRIP-939). 종료 여행이 0건이어도
 *    링크는 남는다 — 캘린더는 회고 진입이 아니다(BR-U6-23 이 숨기는 것은 회고 진입뿐, US-REC-14).
 *
 * 문구 왼쪽 정렬·CTA 높이 50·반경 12 는 픽셀이라 [검증] 스크린샷 대조 몫이다.
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
    active: 'upcoming',
    onChangeSegment: noop,
    cards: null,
    activeEmpty: true,
    onPressCreateTrip: noop,
    showPast: true,
    pastCards: null,
    pastEmpty: true,
    ...over,
  };
}

describe('🔴 AC-1 · 빈 상태 문구', () => {
  it('예정 탭이 비었으면 "예정된 여행이 없어요 · 새 여행을 만들어 보세요" 한 조각이 뜬다', () => {
    // 준비·실행
    render(<MyPageScreen {...base()} />);

    // 단언: 완전일치 한 조각(두 조각으로 쪼개면 red), 같은 문구가 두 번 뜨지도 않는다.
    expect(
      screen.getByText('예정된 여행이 없어요 · 새 여행을 만들어 보세요')
    ).toBeOnTheScreen();
    expect(screen.queryAllByText(/예정된 여행이 없어요/)).toHaveLength(1);
  });

  it.each([
    ['active', '진행 중인 여행이 없어요'],
    ['ended', '종료된 여행이 없어요'],
  ] as const)('%s 탭 빈 문구는 그대로 "%s" 다', (active, text) => {
    render(<MyPageScreen {...base({ active, showPast: false })} />);

    expect(screen.getByText(text)).toBeOnTheScreen();
    // CTA 는 예정 탭에만 있다(기존 규칙).
    expect(screen.queryByTestId('my-create-trip')).toBeNull();
  });
});

describe('🔴 AC-2 · 새 여행 CTA', () => {
  it('글자는 "새 여행 만들기" 하나, 플러스는 버튼 안 글리프이고, 누르면 콜백 1회', () => {
    // 준비
    const onPressCreateTrip = jest.fn();
    render(<MyPageScreen {...base({ onPressCreateTrip })} />);
    const cta = screen.getByTestId('my-create-trip');

    // 단언(모양): 라벨 완전일치 · "+" 글자 0 · 플러스 글리프가 버튼 안에 있다.
    expect(within(cta).getByText('새 여행 만들기')).toBeOnTheScreen();
    expect(within(cta).queryAllByText(/\+/)).toHaveLength(0);
    expect(within(cta).getByTestId('my-create-trip-plus')).toBeOnTheScreen();
    expect(cta.props.accessibilityRole).toBe('button');

    // 실행 → 단언(동작)
    fireEvent.press(cta);
    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
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
