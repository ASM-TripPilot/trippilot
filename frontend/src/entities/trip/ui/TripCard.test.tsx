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

describe('🔴 TC7 · 여분 testID 0 (host 필터 — 프로즌 카드 카운트 보호)', () => {
  it('done 카드 하위 host testID 는 root·badge·title·meta·extra 뿐(resume 없음)', () => {
    render(<TripCard vm={vm()} onPress={noop} testIDPrefix="my-trip" />);

    const card = screen.getByTestId('my-trip-card-t1');
    // host 필터 필수 — RN 의 View/Pressable/Text forwardRef 가 testID 를 합성+host 노드에 복제해
    // 필터 없이 세면 개수가 부풀어 영구 red 가 된다(807 SC7 문제로그). `typeof n.type === 'string'`
    // 은 리포 표준(`PlaceExploreScreen.test.tsx:127`).
    const ids = card
      .findAll((n) => typeof n.type === 'string' && n.props.testID != null)
      .map((n) => n.props.testID)
      .sort();
    expect(ids).toEqual(
      [
        'my-trip-card-t1',
        'my-trip-badge-t1',
        'my-trip-title-t1',
        'my-trip-meta-t1',
        'my-trip-extra-t1',
      ].sort()
    );
  });
});

// ── TRIP-788 추가분(additive, 프로즌 TC1~TC7 무회귀) ────────────────────────────
// 두 옵셔널 VM 필드(resume?·imageUrl?)는 default vm() 이 미전달이라 TC1~TC7 을 한 픽셀도 안 건드린다.

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
    expect(photo.props.source).toEqual({ uri: 'file://x.png' });
  });

  it('imageUrl 미전달(프로덕션 항상 null) → 사진 Image 부재, 회색 플레이스홀더', () => {
    render(<TripCard vm={vm()} onPress={noop} testIDPrefix="my-trip" />);

    // 사진 testID 는 imageUrl 있을 때만 붙는다(TC7 여분 testID 0 과 정합).
    expect(screen.queryByTestId('my-trip-photo-t1')).toBeNull();
  });
});
