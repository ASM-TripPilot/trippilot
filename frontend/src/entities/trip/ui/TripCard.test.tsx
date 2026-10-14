import { fireEvent, render, screen } from '@testing-library/react-native';

import { TripCard } from './TripCard';
import type { MyTripCardVM } from '../model';

/**
 * TRIP-808 · AC-4 — entities/trip/ui/TripCard: h06 "내 여행" 카드(props-only 순수 프레젠테이션).
 * (features/itinerary/ui/MyTripCard 를 이관 — 로직 무변경, testID 를 소비처가 **명시 prefix** 로 제어.)
 *
 * 무엇을 보장하나:
 *  - 🔴 제목·메타줄·부가정보 leaf 는 **값 하나만** 담는다(`toHaveTextContent(문자열)` 완전일치, frozen
 *    MyTripCard.test.tsx 계약 계승 — node_modules matches.js 실검증, 02a §5-a).
 *  - 🔴 배지는 `badge!==null` 일 때만, resume CTA 는 `badge==='draft'` 일 때만 뜬다(파생 — 별도 VM 필드
 *    없음). 배지는 **색이 아니라 텍스트**("완성"≠"작성중")로 가른다(fill 색 렌더 스캔 사각 회피).
 *  - 🔴 testID 는 소비처가 **`testIDPrefix` 로 명시**한다 — 카드가 `my-trip` 을 하드코딩하지 않는다.
 *    h06 는 `testIDPrefix="my-trip"` 으로 `my-trip-card-{id}` 리터럴을 얻고, l03(범위 밖)이 나중에
 *    같은 카드를 쓰면 다른 prefix 로 D1 충돌(둘 다 `my-trip-card-{id}`)을 피한다(01b 제약 D1).
 *
 * *(개념 — testIDPrefix)* 카드는 `${prefix}-card-{id}`·`${prefix}-badge-{id}` … 를 조립한다. 소비처가
 *  prefix 를 정하므로 testID 리터럴의 정본이 소비처에 있다(806 SlotCandidateCard 선례).
 *
 * 3동작 뼈대: 준비=VM+onPress+testIDPrefix → 실행=render/press → 단언=leaf 텍스트/배지/CTA.
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

describe('🔴 TC1 · 제목·메타줄·부가정보 완전일치 + onPress', () => {
  it('leaf 텍스트를 완전일치로 그리고, 카드를 누르면 onPress 가 올라간다', () => {
    const onPress = jest.fn();
    render(<TripCard vm={vm()} onPress={onPress} testIDPrefix="my-trip" />);

    expect(screen.getByTestId('my-trip-title-t1')).toHaveTextContent(
      '서귀포시 여행'
    );
    // ★ 메타줄 완전일치 — `~` 구분자·"N박 M일"·"P명" 형식을 통째로 잠근다(바이트 보존).
    expect(screen.getByTestId('my-trip-meta-t1')).toHaveTextContent(
      '6월 10일 ~ 13일 · 3박 4일 · 2명'
    );
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '확정 장소 12곳'
    );

    fireEvent.press(screen.getByTestId('my-trip-card-t1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TC2 · done 배지 = "완성", resume 없음', () => {
  it('badge=done 이면 "완성" 배지가 뜨고 resume CTA 는 없다', () => {
    render(
      <TripCard
        vm={vm({ badge: 'done' })}
        onPress={noop}
        testIDPrefix="my-trip"
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 TC3 · draft 배지 = "작성중" + resume CTA', () => {
  it('badge=draft 면 "작성중" 배지·부가정보·"일정 이어서 짜기" resume 이 뜬다', () => {
    render(
      <TripCard
        vm={vm({ badge: 'draft', extra: '추천안 준비 중' })}
        onPress={noop}
        testIDPrefix="my-trip"
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

describe('🔴 TC4 · degrade — badge=null 이면 배지·resume 부재, 카드·제목은 뜬다', () => {
  it('itinerary 미도착(badge=null)이면 배지·부가정보·resume 이 없고 카드·제목만 남는다', () => {
    render(
      <TripCard
        vm={vm({ badge: null, extra: null })}
        onPress={noop}
        testIDPrefix="my-trip"
      />
    );

    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    // 짝 — 카드 골격(루트·제목)은 그대로 뜬다(빈 렌더로 위 부정이 공짜 통과하는 것 차단).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});

describe('🔴 TC5 · resume slot — onResume 주면 그것, 없으면 onPress 로 폴백', () => {
  it('onResume 제공 시 resume press → onResume 1회·onPress 0회', () => {
    const onPress = jest.fn();
    const onResume = jest.fn();
    render(
      <TripCard
        vm={vm({ badge: 'draft', extra: '추천안 준비 중' })}
        onPress={onPress}
        onResume={onResume}
        testIDPrefix="my-trip"
      />
    );

    fireEvent.press(screen.getByTestId('my-trip-resume-t1'));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(0);
  });

  it('onResume 미제공 시 resume press → onPress 로 폴백(현 h06 동작 보존)', () => {
    const onPress = jest.fn();
    render(
      <TripCard
        vm={vm({ badge: 'draft', extra: '추천안 준비 중' })}
        onPress={onPress}
        testIDPrefix="my-trip"
      />
    );

    fireEvent.press(screen.getByTestId('my-trip-resume-t1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TC6 · testIDPrefix 는 소비처가 정한다(하드코딩 아님, D1 대비)', () => {
  it('다른 prefix 를 주면 root testID 가 그 prefix 로 바뀐다', () => {
    render(
      <TripCard
        vm={vm({ tripId: 't7' })}
        onPress={noop}
        testIDPrefix="l03-trip"
      />
    );

    expect(screen.getByTestId('l03-trip-card-t7')).toBeOnTheScreen();
    // h06 prefix 로는 안 뜬다(prefix 가 실제로 갈린다는 증거).
    expect(screen.queryByTestId('my-trip-card-t7')).toBeNull();
  });
});

// ── TRIP-788 추가분(additive, 프로즌 TC1~TC6 무회귀) ────────────────────────────
// 두 옵셔널 VM 필드(resume?·imageUrl?)는 default vm() 이 미전달이라 TC1~TC6 을 한 픽셀도 안 건드린다.

describe('🔴 TC8 · resume seam — 배지와 독립(additive `resume` 필드)', () => {
  // 생성중·초안이 같은 draft 배지를 쓰므로 배지로 resume 를 가르면 생성중에 샌다(맹점①).
  // 렌더는 `resume ?? (badge==='draft')` 하나여야 아래 세 케이스가 동시에 참이다.
  it('badge=draft + resume=false → resume 부재(명시 억제 — 생성중 누출 차단)', () => {
    render(
      <TripCard
        vm={vm({ badge: 'draft', extra: 'AI가 일정을 짜는 중', resume: false })}
        onPress={noop}
        testIDPrefix="my-trip"
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });

  it('badge=draft + resume 미전달 → resume 존재(배지 파생 폴백 — TC3/TC5 무회귀 짝)', () => {
    render(
      <TripCard
        vm={vm({ badge: 'draft', extra: '추천안 준비 중' })}
        onPress={noop}
        testIDPrefix="my-trip"
      />
    );

    expect(screen.getByTestId('my-trip-resume-t1')).toHaveTextContent(
      '일정 이어서 짜기'
    );
  });

  it('badge=draft + resume=true → resume 존재(명시 노출)', () => {
    render(
      <TripCard
        vm={vm({ badge: 'draft', extra: '추천안 준비 중', resume: true })}
        onPress={noop}
        testIDPrefix="my-trip"
      />
    );

    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
  });
});

describe('🔴 TC9 · 카드 사진(G7) — imageUrl 있으면 Image, 없으면 회색', () => {
  it('imageUrl(옵셔널·픽스처 전용) 있으면 사진 Image 를 그린다', () => {
    render(
      <TripCard
        vm={vm({ imageUrl: 'file://x.png' })}
        onPress={noop}
        testIDPrefix="my-trip"
      />
    );

    const photo = screen.getByTestId('my-trip-photo-t1');
    expect(photo).toBeOnTheScreen();
    // source uri 가 그 픽스처 값이어야 한다(엉뚱한 소스면 red).
    expect(photo.props.source).toEqual([{ uri: 'file://x.png' }]);
  });

  it('imageUrl 미전달(프로덕션 항상 null) → 사진 Image 부재, 회색 플레이스홀더', () => {
    render(<TripCard vm={vm()} onPress={noop} testIDPrefix="my-trip" />);

    // 사진 testID 는 imageUrl 있을 때만 붙는다.
    expect(screen.queryByTestId('my-trip-photo-t1')).toBeNull();
  });
});

// TRIP-1055 · 옛 MyTripCard.menu.test.tsx → TRIP-1357 로 MyTripCard 래퍼와 함께 이 파일로 이관
describe('⋯ 버튼과 삭제 메뉴', () => {
  /**
   * TRIP-1055 · h06 작성중 카드의 ⋯ 버튼과 삭제 메뉴 — 카드는 **props 만 받아 그린다**.
   *
   * 무엇을 보장하나:
   *  - `onPressDelete` 를 받은 카드만 ⋯ 를 그린다(안 받으면 기존 카드 그대로).
   *  - ⋯ 는 `onPressMenu` 만 올린다 — 카드 이동(`onPress`)도 삭제(`onPressDelete`)도 안 부른다.
   *  - `menuOpen` 이면 메뉴 상자와 '삭제' 항목이 뜨고, 항목은 `onPressDelete` 만 올린다.
   *  - AC-10: ⋯ 는 버튼 역할·"여행 메뉴" 라벨·44 터치(hitSlop). 모양·열림 색·메뉴 치수는 실화면 몫(TRIP-1367).
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

  describe('🔴 TRIP-1055 · ⋯ 는 onPressDelete 를 받은 카드에만 있다', () => {
    it('onPressDelete 를 안 주면 ⋯ 가 없다 (기존 소비처 무변경)', () => {
      // 준비·실행 — 작성중 카드인데 삭제 콜백 없음.
      render(<TripCard testIDPrefix="my-trip" vm={vm()} onPress={noop} />);

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
        <TripCard
          testIDPrefix="my-trip"
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
        <TripCard
          testIDPrefix="my-trip"
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
    it('닫힌 ⋯ : 버튼 역할 · "여행 메뉴" 라벨 · hitSlop 포함 44 이상', () => {
      // 준비·실행
      render(
        <TripCard
          testIDPrefix="my-trip"
          vm={vm()}
          onPress={noop}
          onPressMenu={noop}
          onPressDelete={noop}
        />
      );
      const dots = screen.getByTestId('my-trip-menu-t1');

      // 단언 — 접근성.
      expect(dots.props.accessibilityRole).toBe('button');
      expect(dots.props.accessibilityLabel).toBe('여행 메뉴');

      // 단언 — 보이는 크기 36 + hitSlop 이 세로·가로 모두 44 이상.
      const [vertical, horizontal] = slopSums(dots.props.hitSlop);
      expect(36 + vertical).toBeGreaterThanOrEqual(44);
      expect(36 + horizontal).toBeGreaterThanOrEqual(44);
    });
  });
});
