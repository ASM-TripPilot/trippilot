import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { MyTripCard, type MyTripCardVM } from './MyTripCard';

/**
 * TRIP-468 · h37 "내 여행" 목록 카드 — **props-only** 순수 프레젠테이션. 완성된 VM 을 넣어 그림만 잰다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-4** 카드는 제목·메타줄·배지·부가정보를 그리고, 누르면 onPress 가 올라간다.
 *    메타줄은 **완전일치**로 잠근다 — 날짜 구분자 `~`(Figma, Q5)·박수 형식이 en-dash `–`(공유
 *    formatConfirmedDateRange, 미수정)로 새면 red(02a ★6·§5-a).
 *  - 🔴 **AC-5(표현)** badge='done'→"완성"·resume 없음 / badge='draft'→"작성중"+resume CTA /
 *    badge=null(itinerary 미도착)→배지·resume 부재, 카드·제목은 그대로(degrade).
 *
 * *(개념)* `toHaveTextContent('문자열')` 은 이 리포에서 **완전일치**(leaf 하나에 값 하나만 담는
 *   전제, node_modules matches.js 실검증 — 02a §5-a). 부분일치가 필요하면 정규식을 준다.
 *   배지는 색이 아니라 **텍스트**("완성"≠"작성중")로 가른다 — fill·색 토큰은 렌더 스캔 사각(★7).
 *
 * 3동작 뼈대: 준비=VM+onPress → 실행=render → 단언=leaf 텍스트/배지/CTA.
 */

const noop = () => {};

/** done 카드 VM 기본값 — 케이스마다 필요한 필드만 덮어쓴다. */
function vm(over: Partial<MyTripCardVM> = {}): MyTripCardVM {
  return {
    tripId: 't1',
    title: '서귀포시 여행',
    metaLine: '6월 10일 ~ 13일 · 3박 4일 · 2명',
    badge: 'done',
    extra: '확정 장소 12곳',
    ...over,
  };
}

describe('🔴 AC-4 · 카드 = 제목·메타줄·배지·부가정보 + onPress', () => {
  it('제목·메타줄·부가정보를 그리고, 카드를 누르면 onPress 가 올라간다', () => {
    // 준비 — done 카드 + 콜백.
    const onPress = jest.fn();
    render(<MyTripCard vm={vm()} onPress={onPress} />);

    // 제목·부가정보 leaf.
    expect(screen.getByTestId('my-trip-title-t1')).toHaveTextContent(
      '서귀포시 여행'
    );
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '확정 장소 12곳'
    );

    // ★ 메타줄 완전일치 — `~` 구분자·"N박 M일"·"P명" 형식을 통째로 잠근다.
    expect(screen.getByTestId('my-trip-meta-t1')).toHaveTextContent(
      '6월 10일 ~ 13일 · 3박 4일 · 2명'
    );

    // 카드 루트 press → 콜백 1회.
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC-5(표현) · done 배지 = "완성", resume 없음', () => {
  it('badge=done 이면 "완성" 배지가 뜨고 resume CTA 는 없다', () => {
    render(<MyTripCard vm={vm({ badge: 'done' })} onPress={noop} />);

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    // 짝 — 완성 카드엔 "일정 이어서 짜기" resume 이 없다.
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-5(표현) · draft 배지 = "작성중" + resume CTA', () => {
  it('badge=draft 면 "작성중" 배지·"추천안 준비 중"·resume CTA 가 뜬다', () => {
    render(
      <MyTripCard
        vm={vm({ badge: 'draft', extra: '추천안 준비 중' })}
        onPress={noop}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-resume-t1')).toHaveTextContent(
      '일정 이어서 짜기'
    );
  });
});

describe('🔴 AC-5(표현) · degrade — badge=null 이면 배지·resume 부재, 카드는 뜬다', () => {
  it('itinerary 미도착(badge=null)이면 배지·부가정보·resume 이 없고 카드·제목만 남는다', () => {
    render(<MyTripCard vm={vm({ badge: null, extra: null })} onPress={noop} />);

    // 배지 미정 — 배지·부가정보·resume 부재.
    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    // 짝 — 카드 골격(루트·제목)은 그대로 뜬다(아무것도 안 그려서 위 부정이 공짜 통과하는 것 방지).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});

// TRIP-1055 · 옛 MyTripCard.menu.test.tsx
describe('⋯ 버튼과 삭제 메뉴', () => {
  /**
   * TRIP-1055 · h06 작성중 카드의 ⋯ 버튼과 삭제 메뉴 — 카드는 **props 만 받아 그린다**.
   *
   * 무엇을 보장하나:
   *  - `onPressDelete` 를 받은 카드만 ⋯ 를 그린다(안 받으면 기존 카드 그대로).
   *  - ⋯ 는 `onPressMenu` 만 올린다 — 카드 이동(`onPress`)도 삭제(`onPressDelete`)도 안 부른다.
   *  - `menuOpen` 이면 메뉴 상자와 '삭제' 항목이 뜨고, 항목은 `onPressDelete` 만 올린다.
   *  - AC-10 구조: ⋯ 36 원형·열림 색·44 터치(hitSlop)·배지와 한 줄 / 메뉴 160·radius 12·hairline / '삭제' primary.
   *
   * 메뉴 열림을 prop 으로 받는 이유: entities 카드는 `useState` 를 두지 않는다(옛 가드 `entitiesTripStructure` G0 는 TRIP-1145 로 지웠다).
   * 열림 상태는 컨테이너가 쥔다(`TripCardContainer.test.tsx` 「⋯ 삭제 진입점」 describe 가 그 배선을 잰다).
   *
   * 메뉴 위치(⋯ 바로 아래 오른쪽 맞춤)·그림자는 픽셀이라 jest 가 못 본다 — 6-b 몫.
   */

  const noop = () => {};

  function vm(over: Partial<MyTripCardVM> = {}): MyTripCardVM {
    return {
      tripId: 't1',
      title: '제주 여행',
      metaLine: '6월 10일 ~ 13일 · 3박 4일 · 2명',
      badge: 'draft',
      extra: '아직 일정이 없어요',
      resume: false,
      ...over,
    };
  }

  /** className 을 토큰 배열로 — 부분 문자열 비교(`bg-canvas` ⊂ 다른 값)를 피한다. */
  function tokens(el: ReactTestInstance): string[] {
    return String(el.props.className ?? '')
      .split(/\s+/)
      .filter(Boolean);
  }

  /** 가장 가까운 host View 조상 — 합성 컴포넌트 층을 건너뛴다. */
  function hostParent(el: ReactTestInstance): ReactTestInstance | null {
    let cur = el.parent;
    while (cur && (cur.type as unknown) !== 'View') cur = cur.parent;
    return cur;
  }

  /** hitSlop(숫자 또는 {top,bottom,left,right}) 을 [세로 합, 가로 합] 으로. */
  function slopSums(value: unknown): [number, number] {
    if (typeof value === 'number') return [value * 2, value * 2];
    const s = (value ?? {}) as {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    };
    return [(s.top ?? 0) + (s.bottom ?? 0), (s.left ?? 0) + (s.right ?? 0)];
  }

  const SIZE_36_H = ['h-[36px]', 'h-9', 'size-9', 'size-[36px]'];
  const SIZE_36_W = ['w-[36px]', 'w-9', 'size-9', 'size-[36px]'];
  const HEIGHT_44 = ['h-[44px]', 'h-11'];

  describe('🔴 TRIP-1055 · ⋯ 는 onPressDelete 를 받은 카드에만 있다', () => {
    it('onPressDelete 를 안 주면 ⋯ 가 없다 (기존 소비처 무변경)', () => {
      // 준비·실행 — 작성중 카드인데 삭제 콜백 없음.
      render(<MyTripCard vm={vm()} onPress={noop} />);

      // 단언 — 배지는 뜬다(앵커), ⋯ 는 없다.
      expect(screen.getByTestId('my-trip-badge-t1')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
    });

    it('⋯ 를 누르면 onPressMenu 만 올라가고, 카드 이동·삭제는 안 불린다', () => {
      // 준비 — 삭제 콜백을 받은 닫힌 카드.
      const onPress = jest.fn();
      const onPressMenu = jest.fn();
      const onPressDelete = jest.fn();
      render(
        <MyTripCard
          vm={vm()}
          onPress={onPress}
          onPressMenu={onPressMenu}
          onPressDelete={onPressDelete}
        />
      );
      // 닫힌 상태 — 메뉴 상자·항목은 아직 없다.
      expect(screen.queryByTestId('my-trip-menu-panel-t1')).toBeNull();
      expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

      // 실행 — ⋯ 를 누른다.
      fireEvent.press(screen.getByTestId('my-trip-menu-t1'));

      // 단언 — 메뉴 열기 요청만 1번.
      expect(onPressMenu).toHaveBeenCalledTimes(1);
      expect(onPress).not.toHaveBeenCalled();
      expect(onPressDelete).not.toHaveBeenCalled();
    });

    it('menuOpen 이면 "삭제" 항목이 뜨고, 누르면 onPressDelete 만 1번 올라간다', () => {
      // 준비 — 메뉴가 열린 카드.
      const onPress = jest.fn();
      const onPressDelete = jest.fn();
      render(
        <MyTripCard
          vm={vm()}
          onPress={onPress}
          menuOpen
          onPressMenu={noop}
          onPressDelete={onPressDelete}
        />
      );
      expect(screen.getByTestId('my-trip-menu-panel-t1')).toBeOnTheScreen();
      const item = screen.getByTestId('my-trip-menu-delete-t1');
      expect(item).toHaveTextContent('삭제');

      // 실행 — '삭제' 항목을 누른다.
      fireEvent.press(item);

      // 단언 — 삭제 요청 1번, 카드 이동 0번.
      expect(onPressDelete).toHaveBeenCalledTimes(1);
      expect(onPress).not.toHaveBeenCalled();
    });
  });

  describe('🔴 TRIP-1055 AC-10 · ⋯ 와 메뉴의 구조 (Figma 4682:2573)', () => {
    it('닫힌 ⋯ : 36 원형 · 흰 바탕 · 버튼 역할 · "여행 메뉴" 라벨 · hitSlop 포함 44 이상', () => {
      // 준비·실행
      render(
        <MyTripCard
          vm={vm()}
          onPress={noop}
          onPressMenu={noop}
          onPressDelete={noop}
        />
      );
      const dots = screen.getByTestId('my-trip-menu-t1');
      const t = tokens(dots);

      // 단언 — 모양.
      expect(t).toContain('rounded-pill');
      expect(t.some((x) => SIZE_36_H.includes(x))).toBe(true);
      expect(t.some((x) => SIZE_36_W.includes(x))).toBe(true);
      expect(t).toContain('bg-canvas');
      expect(t).not.toContain('bg-surface-strong');

      // 단언 — 접근성.
      expect(dots.props.accessibilityRole).toBe('button');
      expect(dots.props.accessibilityLabel).toBe('여행 메뉴');

      // 단언 — 보이는 크기 36 + hitSlop 이 세로·가로 모두 44 이상.
      const [vertical, horizontal] = slopSums(dots.props.hitSlop);
      expect(36 + vertical).toBeGreaterThanOrEqual(44);
      expect(36 + horizontal).toBeGreaterThanOrEqual(44);
    });

    it('열린 ⋯ 는 회색(surface-strong)이고, 메뉴 상자·항목이 Figma 값이다', () => {
      // 준비·실행
      render(
        <MyTripCard
          vm={vm()}
          onPress={noop}
          menuOpen
          onPressMenu={noop}
          onPressDelete={noop}
        />
      );

      // 단언 — ⋯ 열림 색.
      const dots = tokens(screen.getByTestId('my-trip-menu-t1'));
      expect(dots).toContain('bg-surface-strong');
      expect(dots).not.toContain('bg-canvas');

      // 단언 — 메뉴 상자: 너비 160 · radius 12 · hairline 테두리 · 흰 바탕.
      const panel = tokens(screen.getByTestId('my-trip-menu-panel-t1'));
      expect(panel).toEqual(
        expect.arrayContaining([
          'w-[160px]',
          'rounded-button',
          'border-hairline',
          'bg-canvas',
        ])
      );

      // 단언 — 항목 높이 44, '삭제' 글자는 primary.
      const item = screen.getByTestId('my-trip-menu-delete-t1');
      expect(tokens(item).some((x) => HEIGHT_44.includes(x))).toBe(true);
      expect(tokens(screen.getByText('삭제'))).toContain('text-primary');
    });

    it('배지와 ⋯ 는 같은 줄(flex-row · gap-sm)에 선다', () => {
      // 준비·실행
      render(
        <MyTripCard
          vm={vm()}
          onPress={noop}
          onPressMenu={noop}
          onPressDelete={noop}
        />
      );
      const badgeRow = hostParent(screen.getByTestId('my-trip-badge-t1'));
      const dotsRow = hostParent(screen.getByTestId('my-trip-menu-t1'));

      // 단언 — 둘의 가장 가까운 host 부모가 같은 View 이고, 그 View 가 가로 줄 + 간격 8 이다.
      expect(badgeRow).not.toBeNull();
      expect(dotsRow).toBe(badgeRow);
      expect(tokens(badgeRow as ReactTestInstance)).toEqual(
        expect.arrayContaining(['flex-row', 'gap-sm'])
      );
    });
  });
});
