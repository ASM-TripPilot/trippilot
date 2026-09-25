import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { PlaceDetailView } from '@/features/execution/model/placeDetailView';
import { HeartFilledGlyph } from '@/shared/ui/HeartGlyphs';

import { BackArrowGlyph, ShareGlyph } from './ExecutionGlyphs';
import { PlaceDetailScreen } from './PlaceDetailScreen';

/**
 * TRIP-755 · PlaceDetailScreen(i10) — 여행 중 현재 장소 상세, Figma 4159:2673 재작성.
 *
 * 무엇을 보장하나:
 *  - 표면 = 갤러리 히어로(장소명·핀 부제·"1 / N") + 원형 버튼(뒤로·공유·하트) · 추천 카피 · 태그 ·
 *    정보 카드(영업시간·주소·입장료) · 지도 · "이곳의 사진". 옛 제목·"지금 여기"·하단 CTA 는 없다.
 *  - 계약 공백 필드(카피·주소·입장료·사진 수)는 값이 있을 때만 그리거나 "미확인"으로 적는다(INV-1·BR-U4-40).
 *  - 하트는 저장하지 않는다 — 누르면 "준비 중" 한 줄만 뜨고 하트 모양은 그대로다(저장 거짓말 금지).
 *  - 소요시간 단위 문자열은 화면 어디에도 없다(INV-3).
 *
 * TRIP-939(심사 2.1) 계승: 핸들러 없는 버튼 그림은 여전히 그리지 않는다(S6 ①). 이번엔 버튼에 핸들러가
 * 생겨서 그릴 뿐이다 — S5·S6 은 지우지 않고 반대 계약으로 고쳐 썼다.
 *
 * 3동작 뼈대: 준비=뷰(+콜백) → 실행=render/press → 단언=leaf 텍스트·testID·콜백 횟수.
 * (개념) `toHaveTextContent('문자열')` = 자식 텍스트를 이어 붙인 값과 **완전 일치**(부분은 정규식).
 */

// 소요시간 표기 탐지기(INV-3). `HH:mm`(콜론 뒤 숫자)·"쉬는 시간"(숫자 없음)은 안 걸린다.
const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;

const view = (over: Partial<PlaceDetailView> = {}): PlaceDetailView => ({
  name: '광안리 해수욕장',
  category: '해변',
  tags: ['해변', '포토스팟'],
  imageUrl: null,
  galleryUrls: [],
  photoTotal: null,
  pitchTitle: null,
  pitchBody: null,
  openingHours: '09:00~22:00 (상시 개방)',
  openingHoursMissing: false,
  hoursCaption: null,
  address: '부산 수영구 광안해변로 219',
  admissionFee: '무료',
  lat: 35.15,
  lng: 129.11,
  ...over,
});

const PHOTOS = [
  'file:///g1.jpg',
  'file:///g2.jpg',
  'file:///g3.jpg',
  'file:///g4.jpg',
  'file:///g5.jpg',
];

/**
 * 하트 서브트리의 "모양" — 호스트 노드의 타입과 props(함수·children 제외)를 통째로 직렬화한다.
 * SVG `fill`/`stroke` 도 여기 실린다(색은 정수 payload 로 바뀌므로 hex 로 찾지 말고 전후 비교만 한다).
 * 글리프 안에서 fill 만 바꾸는 "저장된 척"도 이 문자열을 바꾼다(02a ★1 — cardFingerprint 가 못 보는 축).
 */
function hostShape(node: ReactTestInstance): unknown {
  const kids = node.children.map((child) =>
    typeof child === 'string' ? child : hostShape(child)
  );
  if (typeof node.type !== 'string') return kids;
  const props = Object.fromEntries(
    Object.entries(node.props).filter(
      ([key, value]) => key !== 'children' && typeof value !== 'function'
    )
  );
  return { type: node.type, props, children: kids };
}

describe('PlaceDetailScreen (i10)', () => {
  it('S1 정상 — 장소명·영업시간·주소·입장료를 각 leaf 로 그리고, "다음 일정까지"는 없다 (AC-2·AC-7)', () => {
    // 준비·실행
    render(<PlaceDetailScreen view={view()} />);

    // 단언 — 문자열 매처 = 완전일치.
    expect(screen.getByTestId('execution-place-title')).toHaveTextContent(
      '광안리 해수욕장'
    );
    expect(screen.getByTestId('execution-place-openhours')).toHaveTextContent(
      '09:00~22:00 (상시 개방)'
    );
    expect(screen.getByTestId('execution-place-address')).toHaveTextContent(
      '부산 수영구 광안해변로 219'
    );
    expect(screen.getByTestId('execution-place-fee')).toHaveTextContent('무료');
    // "다음 일정까지"(여유) 행은 Figma 3행에 맞춰 제거(사용자 결정 2026-09-25).
    expect(screen.queryByTestId('execution-place-slack')).toBeNull();
    expect(screen.queryByText('다음 일정까지')).toBeNull();

    // 값이 있으므로 결측 자리 testID 는 안 뜬다.
    expect(
      screen.queryByTestId('execution-place-unknown-openhours')
    ).toBeNull();
    expect(screen.queryByTestId('execution-place-unknown-address')).toBeNull();
    expect(screen.queryByTestId('execution-place-unknown-fee')).toBeNull();

    // 구조 앵커.
    expect(screen.getByTestId('execution-place-tags')).toBeTruthy();
    expect(screen.getByTestId('execution-place-hero')).toBeTruthy();
  });

  it('S2 결측 — 영업시간·주소·입장료가 없으면 행을 지우지 않고 "미확인"을 다른 testID 로 적는다 (AC-7·BR-U4-40)', () => {
    // 준비·실행
    render(
      <PlaceDetailScreen
        view={view({
          openingHours: '미확인',
          openingHoursMissing: true,
          address: null,
          admissionFee: null,
        })}
      />
    );

    // 단언 — 결측 자리 3종.
    expect(
      screen.getByTestId('execution-place-unknown-openhours')
    ).toHaveTextContent('미확인');
    expect(
      screen.getByTestId('execution-place-unknown-address')
    ).toHaveTextContent('미확인');
    expect(screen.getByTestId('execution-place-unknown-fee')).toHaveTextContent(
      '미확인'
    );
    // 값 자리 testID 는 결측일 때 안 뜬다(기계 구분).
    expect(screen.queryByTestId('execution-place-openhours')).toBeNull();
    expect(screen.queryByTestId('execution-place-address')).toBeNull();
    expect(screen.queryByTestId('execution-place-fee')).toBeNull();
    // 옛 "위치" 행(항상 미확인)은 주소 행으로 바뀌었다.
    expect(screen.queryByTestId('execution-place-unknown-location')).toBeNull();
  });

  it('S3 화면 어디에도 소요시간 단위 문자열이 없다 — 모든 필드를 채워도 (INV-3 · AC-10)', () => {
    // 준비 — 계약 공백 필드까지 전부 채운 뷰(새 문자열 필드가 새는 경로를 막는다).
    render(
      <PlaceDetailScreen
        view={view({
          galleryUrls: PHOTOS,
          photoTotal: 42,
          pitchTitle: '비 오는 날에도 반나절이 아깝지 않은 곳',
          pitchBody: '창가 자리에서 쉬는 시간까지 넉넉히 잡아 두세요.',
        })}
        onPressBack={jest.fn()}
        onPressShare={jest.fn()}
        onPressSeeAll={jest.fn()}
      />
    );

    // 긍정 앵커 — 탐지기가 진짜 소요시간은 잡는다(공허 통과 방지).
    expect(DURATION.test('30분')).toBe(true);
    expect(DURATION.test('소요 2시간')).toBe(true);

    // 렌더된 화면 전체 텍스트 스캔.
    expect(DURATION.test(JSON.stringify(screen.toJSON()))).toBe(false);
    // 렌더 앵커 — 빈 트리 공허 통과 방지.
    expect(screen.getByTestId('execution-place-detail')).toBeTruthy();
  });

  it('S4 데이터 출처 — openingHoursKnown=false 면 "확인 필요" 캡션, 그 외 부재 (AC-7 · Q10)', () => {
    const { rerender } = render(
      <PlaceDetailScreen view={view({ hoursCaption: '확인 필요' })} />
    );
    expect(
      screen.getByTestId('execution-place-hours-caption')
    ).toHaveTextContent('확인 필요');

    rerender(<PlaceDetailScreen view={view({ hoursCaption: null })} />);
    expect(screen.queryByTestId('execution-place-hours-caption')).toBeNull();
  });

  it('S5 (TRIP-939 반전) 옛 콜백을 넘겨도 제목·"지금 여기"·하단 [길찾기]/[일정에서 보기]는 없다 (AC-1)', () => {
    // 준비 — 옛 호출부가 넘기던 콜백을 그대로 넘긴다. 타입에서 prop 만 지우고 렌더 분기를 남긴
    // 구현도 잡으려는 장치(`as object` 스프레드는 초과 속성 검사를 받지 않는다, 02a ★4).
    const legacy = {
      onPressItinerary: jest.fn(),
      onPressDirections: jest.fn(),
    } as object;

    // 실행
    render(<PlaceDetailScreen view={view()} {...legacy} />);

    // 단언(부재) — testID 3종 + 문구 4종.
    expect(screen.queryByTestId('execution-place-cta-itinerary')).toBeNull();
    expect(screen.queryByTestId('execution-place-cta-directions')).toBeNull();
    expect(screen.queryByTestId('execution-place-here')).toBeNull();
    expect(screen.queryByText('현재 장소')).toBeNull();
    expect(screen.queryByText(/지금 여기/)).toBeNull();
    expect(screen.queryByText('일정에서 보기')).toBeNull();
    expect(screen.queryByText('길찾기')).toBeNull();

    // 짝 앵커 — 화면 자체는 그려졌다.
    expect(screen.getByTestId('execution-place-detail')).toBeTruthy();
    expect(screen.getByTestId('execution-place-hero')).toBeTruthy();
  });

  it('S6 (TRIP-939 반전) 원형 버튼 — 콜백이 없으면 뒤로·공유를 그리지 않고, 있으면 누른 쪽 콜백만 1회 (AC-3)', () => {
    // ① 콜백 없음 — 핸들러 없는 그림 금지(심사 2.1)는 그대로 산다.
    const { rerender } = render(<PlaceDetailScreen view={view()} />);
    expect(screen.queryByTestId('execution-place-back')).toBeNull();
    expect(screen.queryByTestId('execution-place-share')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(BackArrowGlyph)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(ShareGlyph)).toHaveLength(0);
    // 짝 앵커 — 하트는 콜백과 무관하게 항상 있다(누르면 안내가 뜨는 반응이 있다, 02a D-a).
    expect(screen.getByTestId('execution-place-save')).toBeTruthy();

    // ② 콜백 둘 — 준비
    const onPressBack = jest.fn();
    const onPressShare = jest.fn();
    rerender(
      <PlaceDetailScreen
        view={view()}
        onPressBack={onPressBack}
        onPressShare={onPressShare}
      />
    );

    // 실행·단언 — 뒤로
    fireEvent.press(screen.getByTestId('execution-place-back'));
    expect(onPressBack).toHaveBeenCalledTimes(1);
    expect(onPressShare).not.toHaveBeenCalled();

    // 실행·단언 — 공유
    fireEvent.press(screen.getByTestId('execution-place-share'));
    expect(onPressShare).toHaveBeenCalledTimes(1);
    expect(onPressBack).toHaveBeenCalledTimes(1);
  });

  it('S7 하트 — 누르면 "저장 기능은 준비 중이에요" 한 줄만 뜨고, 하트 모양·선택 상태는 그대로다 (AC-4 · 저장 거짓말 금지)', () => {
    // 준비
    render(<PlaceDetailScreen view={view()} />);
    const before = JSON.stringify(
      hostShape(screen.getByTestId('execution-place-save'))
    );
    // 공허 방지 — 하트 글리프가 실제로 그려졌다(SVG Path 가 모양에 실렸다).
    expect(before).toContain('RNSVGPath');
    expect(screen.queryByTestId('execution-place-save-notice')).toBeNull();

    // 실행 — 두 번 누른다(토글형 거짓말이면 두 번째에 되돌아가 우연히 같아질 수 있어 매번 잰다).
    fireEvent.press(screen.getByTestId('execution-place-save'));
    const afterFirst = JSON.stringify(
      hostShape(screen.getByTestId('execution-place-save'))
    );
    fireEvent.press(screen.getByTestId('execution-place-save'));
    const afterSecond = JSON.stringify(
      hostShape(screen.getByTestId('execution-place-save'))
    );

    // 단언 ① — 안내 한 줄(완전일치)이 정확히 하나.
    expect(screen.getAllByTestId('execution-place-save-notice')).toHaveLength(
      1
    );
    expect(screen.getByTestId('execution-place-save-notice')).toHaveTextContent(
      '저장 기능은 준비 중이에요'
    );

    // 단언 ② — 하트 서브트리 모양(글리프 fill·stroke·className 포함)이 누르기 전과 같다.
    expect(afterFirst).toBe(before);
    expect(afterSecond).toBe(before);

    // 단언 ③ — 빈 하트 글리프 그대로, 찬 하트는 트리 어디에도 없다, 선택됨이 아니다.
    const heart = screen.getByTestId('execution-place-save');
    expect(
      within(heart).getByTestId('execution-place-save-outline')
    ).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(HeartFilledGlyph)).toHaveLength(0);
    expect(heart).not.toBeSelected();
  });

  it('S8 히어로 — 갤러리는 가로 한 장씩 넘기는 스크롤이고, 사진 수가 있으면 "1 / N" 칩을 단다 (AC-8 · Q9)', () => {
    // ① 사진 3장 + 전체 42장 — 준비·실행
    const { rerender } = render(
      <PlaceDetailScreen
        view={view({ galleryUrls: PHOTOS.slice(0, 3), photoTotal: 42 })}
      />
    );

    // 단언 — 가로 페이징(`pagingEnabled` = 한 장 단위로 멈추는 스크롤). 실제 스와이프는 jest 사각(6-b).
    const gallery = within(
      screen.getByTestId('execution-place-hero')
    ).getByTestId('execution-place-gallery');
    expect(gallery.props.horizontal).toBe(true);
    expect(gallery.props.pagingEnabled).toBe(true);
    // 사진 순서 그대로.
    PHOTOS.slice(0, 3).forEach((uri, index) =>
      expect(
        within(gallery).getByTestId(`execution-place-gallery-${index}`).props
          .source
      ).toEqual({ uri })
    );
    expect(screen.getByTestId('execution-place-photo-count')).toHaveTextContent(
      '1 / 42'
    );

    // ② 운영 기본(사진 없음·사진 수 없음) — 회색 히어로만 남고 갤러리·칩은 없다(INV-1).
    rerender(
      <PlaceDetailScreen view={view({ galleryUrls: [], photoTotal: null })} />
    );
    expect(screen.getByTestId('execution-place-hero')).toBeTruthy();
    expect(screen.queryByTestId('execution-place-gallery')).toBeNull();
    expect(screen.queryByTestId('execution-place-photo-count')).toBeNull();
  });

  it('S9 부제 — 흰 핀 + category 한 줄로 바뀌고, 태그를 " · "로 이은 옛 부제 줄은 없다 (AC-2)', () => {
    // 준비·실행 — category '해변', tags ['해변','포토스팟'].
    render(<PlaceDetailScreen view={view()} />);

    // 단언 — 핀 글리프 + category 텍스트(태그 칩은 "#해변"이라 "해변" 완전일치와 겹치지 않는다).
    expect(screen.getByTestId('execution-place-subtitle-pin')).toBeTruthy();
    expect(screen.getByText('해변')).toBeOnTheScreen();
    // 옛 태그 join 부제 줄은 없다.
    expect(screen.queryByText('해변 · 포토스팟')).toBeNull();
  });

  it('S10 추천 카피 — 제목·본문이 있으면 그리고, 둘 다 null 이면 블록째 없다 (AC-8 · G6)', () => {
    // ① 채움
    const { rerender } = render(
      <PlaceDetailScreen
        view={view({
          pitchTitle: '비 오는 날에도 반나절이 아깝지 않은 곳',
          pitchBody: '상설전은 무료로 열려 있어요.',
        })}
      />
    );
    expect(screen.getByTestId('execution-place-pitch-title')).toHaveTextContent(
      '비 오는 날에도 반나절이 아깝지 않은 곳'
    );
    expect(screen.getByTestId('execution-place-pitch-body')).toHaveTextContent(
      '상설전은 무료로 열려 있어요.'
    );

    // ② 운영(둘 다 null) — 지어내지 않는다.
    rerender(
      <PlaceDetailScreen view={view({ pitchTitle: null, pitchBody: null })} />
    );
    expect(screen.queryByTestId('execution-place-pitch')).toBeNull();
    expect(screen.queryByTestId('execution-place-pitch-title')).toBeNull();
    expect(
      screen.queryByText('비 오는 날에도 반나절이 아깝지 않은 곳')
    ).toBeNull();
  });

  it('S11 정보 카드 — 행은 영업시간 · 주소 · 입장료 3개뿐이다 (AC-7 · Figma 3행)', () => {
    // 준비·실행
    render(<PlaceDetailScreen view={view()} />);

    // 단언 — RNTL 쿼리는 트리를 문서 순서로 훑어 반환 배열 순서 = 화면 순서(02a ★8).
    // 옛 라벨 "위치"·"다음 일정까지"도 패턴에 넣어, 남아 있으면 배열이 달라져 red.
    const labels = within(screen.getByTestId('execution-place-info'))
      .getAllByText(/^(영업시간|주소|입장료|다음 일정까지|위치)$/)
      .map((node) => node.props.children);
    expect(labels).toEqual(['영업시간', '주소', '입장료']);
  });

  describe('S12 지도 — 현재 장소 1핀 · 잠금 · 스케일바 (AC-9 · Q5)', () => {
    // 실 MapView 는 env 키가 있어야 map-native 를 그린다(없으면 map-failure 로 접힘, 02a ★6).
    const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
    const ORIGINAL_CLIENT_ID = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID;
    const GESTURE_TOGGLES = [
      'isScrollGesturesEnabled',
      'isZoomGesturesEnabled',
      'isRotateGesturesEnabled',
      'isTiltGesturesEnabled',
    ] as const;

    beforeEach(() => {
      process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
    });

    afterEach(() => {
      if (ORIGINAL_CLIENT_ID === undefined) {
        delete process.env[CLIENT_ID_KEY];
      } else {
        process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
      }
    });

    it('좌표가 있으면 카드 안에 잠긴 실지도를 그리고, 핀 1개가 그 좌표에 찍히며 스케일바가 켜진다', () => {
      // 준비·실행
      render(<PlaceDetailScreen view={view({ lat: 35.15, lng: 129.11 })} />);
      const map = screen.getByTestId('execution-place-map');
      const native = within(map).getByTestId('map-native');

      // 단언 ① — viewOnly: 제스처 4토글이 개별로 전부 false.
      for (const toggle of GESTURE_TOGGLES) {
        expect(native.props[toggle]).toBe(false);
      }
      // 단언 ② — 스케일바(거리 표기라 INV-3 무위반).
      expect(native.props.isShowScaleBar).toBe(true);
      // 단언 ③ — 핀 1개, 좌표 일치(lat↔lng 스왑 방지 — 둘이 다른 값), 경로선 없음.
      const markers = within(map).getAllByTestId('map-marker');
      expect(markers).toHaveLength(1);
      expect(markers[0].props.latitude).toBe(35.15);
      expect(markers[0].props.longitude).toBe(129.11);
      expect(within(map).queryAllByTestId('map-path')).toHaveLength(0);
    });

    it('좌표가 없으면 지도 카드를 그리지 않는다', () => {
      // 준비·실행
      render(<PlaceDetailScreen view={view({ lat: null, lng: null })} />);

      // 단언 — 지도 부재 + 짝 앵커.
      expect(screen.queryByTestId('execution-place-map')).toBeNull();
      expect(screen.queryByTestId('map-native')).toBeNull();
      expect(screen.getByTestId('execution-place-info')).toBeTruthy();
    });
  });

  describe('S13 이곳의 사진 — 3장 이상일 때만 · 썸네일 3칸 · 마지막 "+N" · "모두 보기"는 핸들러 있을 때만 (AC-8 · Q8)', () => {
    it('5장·전체 42장·모두 보기 핸들러 → 섹션, 앞 3장 썸네일, "+39", 모두 보기 1회', () => {
      // 준비
      const onPressSeeAll = jest.fn();
      render(
        <PlaceDetailScreen
          view={view({ galleryUrls: PHOTOS, photoTotal: 42 })}
          onPressSeeAll={onPressSeeAll}
        />
      );
      const photos = screen.getByTestId('execution-place-photos');

      // 단언 ① — 제목 + 썸네일 정확히 3칸(앞 3장, 순서 그대로).
      expect(within(photos).getByText('이곳의 사진')).toBeOnTheScreen();
      const thumbs = within(photos).getAllByTestId(
        /^execution-place-photo-thumb-\d+$/
      );
      expect(thumbs).toHaveLength(3);
      PHOTOS.slice(0, 3).forEach((uri, index) =>
        expect(
          within(photos).getByTestId(`execution-place-photo-thumb-${index}`)
            .props.source
        ).toEqual({ uri })
      );
      // 단언 ② — 보이는 3장 밖의 수(42 − 3).
      expect(
        within(photos).getByTestId('execution-place-photos-more')
      ).toHaveTextContent('+39');

      // 실행·단언 ③ — 모두 보기.
      fireEvent.press(
        within(photos).getByTestId('execution-place-photos-seeall')
      );
      expect(onPressSeeAll).toHaveBeenCalledTimes(1);
    });

    it('핸들러가 없으면 섹션은 있어도 "모두 보기"는 없다', () => {
      render(
        <PlaceDetailScreen
          view={view({ galleryUrls: PHOTOS.slice(0, 3), photoTotal: 42 })}
        />
      );
      expect(screen.getByTestId('execution-place-photos')).toBeTruthy();
      expect(screen.queryByTestId('execution-place-photos-seeall')).toBeNull();
      expect(screen.queryByText(/모두 보기/)).toBeNull();
    });

    it('사진이 3장 미만이면 섹션째 없다', () => {
      render(
        <PlaceDetailScreen
          view={view({ galleryUrls: PHOTOS.slice(0, 2), photoTotal: 42 })}
          onPressSeeAll={jest.fn()}
        />
      );
      expect(screen.queryByTestId('execution-place-photos')).toBeNull();
      expect(screen.queryByText('이곳의 사진')).toBeNull();
      // 짝 앵커 — 갤러리는 2장으로 그려진다.
      expect(screen.getByTestId('execution-place-gallery-1')).toBeTruthy();
    });

    it('남는 사진이 없거나(전체 3장) 사진 수를 모르면(null) "+N" 칸은 없다', () => {
      // ① 전체 3장 — 3 − 3 = 0.
      const { rerender } = render(
        <PlaceDetailScreen
          view={view({ galleryUrls: PHOTOS.slice(0, 3), photoTotal: 3 })}
        />
      );
      expect(screen.getByTestId('execution-place-photos')).toBeTruthy();
      expect(screen.queryByTestId('execution-place-photos-more')).toBeNull();

      // ② 사진 수 모름.
      rerender(
        <PlaceDetailScreen
          view={view({ galleryUrls: PHOTOS.slice(0, 3), photoTotal: null })}
        />
      );
      expect(screen.getByTestId('execution-place-photos')).toBeTruthy();
      expect(screen.queryByTestId('execution-place-photos-more')).toBeNull();
    });
  });
});
