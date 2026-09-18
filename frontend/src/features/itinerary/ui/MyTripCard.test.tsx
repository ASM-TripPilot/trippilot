import { fireEvent, render, screen } from '@testing-library/react-native';

import { MyTripCard } from './MyTripCard';
import type { MyTripCardVM } from './MyTripCard';

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
