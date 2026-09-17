import { Image, StyleSheet, View } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { HOME_DEFAULT_PROPS, HOME_LOADING_PROPS } from '../model/homeFixtures';
import type { HomePhase } from '../model/homeTypes';
import { HeartOutlineGlyph } from './HomeGlyphs';
import { HomeScreen } from './HomeScreen';

/**
 * AC-1~AC-8 — 홈 default 재정합(구 "여행 상태 대시보드" → 신 "발견·영감 피드",
 * 라이브 Figma 2091:1357). props(hero·sections)만 받아 그리는 순수 프레젠테이션 화면.
 *
 * 무엇을 보장하나: 인사·검색바·영감 hero·발견 섹션(요즘 담는 곳/뜨는 장소 — 여행자 일정은
 * TRIP-694로 discovery에서 제거)·온램프(하트 FAB)가 한 화면에 존재하고(AC-1 · discovery
 * 담은 곳 배너는 TRIP-596으로 제거), 섹션 카드가 픽스처 실측값대로 렌더되며
 * (AC-2), 상태별(ready/empty/loading)로 가용 블록은 살고 빈 섹션은 가시 플레이스홀더로
 * 드러나며(AC-4·5·INV-4), 소요시간 문자열은 어디에도 없음(AC-6·INV-3)을 잠근다.
 *
 * TRIP-370 — 홈 CTA 배선. 배선 CTA 3종(FAB·담은 곳·뜨는 장소 더보기)은 넘겨받은 콜백 prop 만
 * 발화하고(370-AC-2, 화면은 라우터 무지), 목적지 없는 컨트롤(검색바·비배선 더보기·벨)은
 * accessibilityRole="button"으로 노출되지 않으며(370-AC-3), discovery 에서 버튼 역할 집합은
 * 배선된 3 CTA 와 정확히 같다(370-AC-4). 구 "CTA 전부 no-op(316-AC-8)" 락은 배선 CTA 를 빼고
 * "비배선 컨트롤은 콜백 0·크래시 0"으로 갱신한다(370-AC-5). 라우터 왕복은 화면이 아니라
 * `(tabs)/index.tsx` seam 이 지므로 `tabsHomeRoute.test.tsx`(370-AC-1)가 별도로 잰다.
 *
 * 텍스트 중복 함정(02a §4-2): 신 화면 중복 리프 — `2박 3일`(일정 0·1), `1박 2일`(컬렉션
 * badge 1 + 일정 2), `당일치기`(컬렉션 badge 0) vs hero chip `당일치기로 충분`, hero chip
 * `야경 명소` vs 스팟 tag `#야경명소`. 모든 카드·hero 내용 단언은 `within(...)`으로 서브트리
 * 를 좁혀 전역 다중매치 throw를 피한다. 개수는 `queryByTestId(n+1)` null로 잠근다.
 *
 * 매처 의미(02a §5): `getByText('문자열')`·`toHaveTextContent('문자열')`은 기본 exact=true라
 * 리프 텍스트 **전체**가 인자와 같아야 매치한다(부분 포함 아님, node_modules `matches.js`
 * L15 실검증). 다중 텍스트 컨테이너엔 정규식(`.test`=부분 매치)을 쓴다.
 */

// 섹션 카드 픽스처 실측값(브리프 §5-C) — 테스트가 잠그는 렌더 계약. implementer의
// HOME_DEFAULT_PROPS.sections가 이 값들을 그려야 green이 된다.
const EXPECTED_COLLECTIONS = [
  { title: '감천문화마을', region: '부산 사하구', badge: '당일치기' },
  { title: '해운대 해변', region: '부산 해운대구', badge: '1박 2일' },
  { title: '해동용궁사', region: '부산 기장군', badge: '반나절' },
] as const;

const EXPECTED_SPOTS = [
  { title: '전포 카페거리', tag: '#감성카페' },
  { title: '자갈치 시장', tag: '#로컬푸드' },
  { title: '광안리 SUP', tag: '#액티비티' },
  { title: '황령산 전망대', tag: '#야경명소' },
] as const;

// TRIP-370 — 배선 CTA(목적지 확정, 버튼 유지) vs 비배선 컨트롤(목적지 없음, 버튼 표식 제거).
// TRIP-453(entry 1) — 검색바가 목적지(/explore/search)를 얻어 배선 CTA 로 승격 → WIRED 로 이동
// (UNWIRED 에서 제거). 세 목록을 함께 손대야 한다(★2): WIRED(+search)·UNWIRED(−search)·
// PLANNING_WIRED(+search·+card). 하나라도 빠뜨리면 371-AC-3/4·AC-7 중 하나가 red 로 새어난다.
const WIRED_CTA_TEST_IDS = [
  'home-create-trip-fab',
  'home-saved-menu-toggle', // TRIP-494 담은 곳 saved-menu FAB(닫힘=하트 토글)
  // TRIP-596 — discovery 담은 곳 배너(home-saved-places-cta)는 제거됨. 하트 FAB이 온램프를
  // 대체(장소→d02·숙소→e04)해 중복이라 discovery 버튼셋에서 빠진다(370-AC-4 재동결).
  'home-spots-more',
  'home-search-bar',
] as const;

// TRIP-694 — 여행자 일정 섹션이 discovery에서 제거되며 `home-itineraries-more`도 사라진다
// (비배선 컨트롤 목록에서 함께 빠진다). 남는 비배선 컨트롤은 컬렉션 더보기·벨 2종.
const UNWIRED_CONTROL_TEST_IDS = [
  'home-collections-more',
  'home-dashboard-bell',
] as const;

describe('HomeScreen — 정상 렌더 존재 (AC-1)', () => {
  it('인사·검색바·영감 hero·섹션 3종 헤더·섹션당 카드·온램프가 한 화면에 존재한다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 인사 헤더(고정 카피).
    expect(screen.getByText('오늘은 어디를 상상해볼까요')).toBeOnTheScreen();
    expect(
      screen.getByText('떠나지 않아도, 구경하고 모으는 즐거움')
    ).toBeOnTheScreen();

    // 검색바 — 가짜 검색바(Pressable+Text), 플레이스홀더는 Text 리프(02a §4-8).
    const search = screen.getByTestId('home-search-bar');
    expect(
      within(search).getByText('가고 싶은 도시·장소를 검색해보세요')
    ).toBeOnTheScreen();

    // 영감 hero — eyebrow/title/subtitle/chip 2. within으로 스코프(chip `야경 명소`가 스팟
    // tag `#야경명소`와 헷갈리지 않게).
    const hero = screen.getByTestId('home-magazine-hero');
    expect(within(hero).getByText('오늘의 여행 영감')).toBeOnTheScreen();
    expect(within(hero).getByText('부산 · 광안리의 밤')).toBeOnTheScreen();
    expect(
      within(hero).getByText('다리 위로 번지는 불빛, 상상만으로 설레는 야경')
    ).toBeOnTheScreen();
    expect(within(hero).getByText('당일치기로 충분')).toBeOnTheScreen();
    expect(within(hero).getByText('야경 명소')).toBeOnTheScreen();

    // 발견 섹션 2종 헤더 + 더보기 2(각 헤더 1개씩) — 여행자 일정은 TRIP-694로 discovery에서
    // 제거(전용 describe가 부재를 잠근다).
    expect(screen.getByText('요즘 사람들이 담는 곳')).toBeOnTheScreen();
    expect(screen.getByText('지금 뜨는 장소')).toBeOnTheScreen();
    expect(screen.getAllByText('더 보기')).toHaveLength(2);

    // 섹션당 카드 ≥1.
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();

    // 온램프 — FAB(담은 곳 배너는 TRIP-596으로 제거, 하트 FAB이 대체). 배너 부재 자체는
    // 아래 전용 describe(★V-1 앵커 짝)가 잠근다.
    const fab = screen.getByTestId('home-create-trip-fab');
    // 라벨 없는 원형 FAB(Figma 2105:1757) — 보이는 글자는 없고 접근성 이름만 남는다.
    // 텍스트를 지우면서 접근성 이름까지 같이 사라지는 것이 이 칸의 유일한 실패 경로다.
    expect(within(fab).queryByText('여행 만들기')).toBeNull();
    expect(fab).toHaveAccessibleName('여행 만들기');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-694 — a01 default 픽셀 정합(라이브 Figma 2091:1357). 8개 델타 중 jest로 잠글 수
// 있는 축만 아래 5 describe 로 잠근다. 픽셀 충실도(그림자 농도·원 크기·배지 px)와 글리프 색
// (AC-4 핀 primary — SVG stroke 는 RNTL 트리에서 질의 불가, cardFingerprint fill 미관측
// 트랩)은 6-b 육안 전용이라 여기서 테스트하지 않는다(공허 통과 방지). 드리프트 A(서브카피
// 12.5px·칩 흰22%·배지 10.5px)는 01b 확정 무변경이라 잠글 것이 없다.

describe('🔴 HomeScreen — 히어로 하트 제거 (TRIP-694 AC-1)', () => {
  it('영감 hero 서브트리에 하트 글리프가 0개다(hero 실렌더 앵커 동반)', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 긍정 앵커 — hero(캐러셀 page0)가 실제로 그려졌음을 못박는다(히어로 통삭 시 공허 통과
    // 차단). page0 은 기존 MAGAZINE_HERO 콘텐츠라 이 문구가 within 단일 매치다.
    const hero = screen.getByTestId('home-magazine-hero');
    expect(within(hero).getByText('오늘의 여행 영감')).toBeOnTheScreen();
    expect(within(hero).getByText('부산 · 광안리의 밤')).toBeOnTheScreen();

    // 부정(red-first) — 하트 글리프 컴포넌트 타입 개수 0. UNSAFE_queryAllByType 은 미매치 시
    // []를 돌려주고(throw 안 함) 엘리먼트 type 참조로 센다(RNTL 13.3.3 실검증, 02a §2).
    // 현재 MagazineHero 엔 HeartOutlineGlyph 1개(HomeScreen L167)라 length 1 → red.
    expect(within(hero).UNSAFE_queryAllByType(HeartOutlineGlyph)).toHaveLength(
      0
    );
  });
});

describe('🔴 HomeScreen — 실 5페이지 캐러셀 + 5도트 (TRIP-694 AC-2)', () => {
  it('페이지 컨테이너 5개(home-hero-page-0..4)와 도트 5개가 있고 6번째는 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 앵커 — page0 은 단일 home-magazine-hero 를 유지한다(★F-2 testID 충돌 회피).
    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();

    // 5페이지 — 거짓 인디 방지: 도트가 아니라 **페이지 컨테이너 존재**로 잠근다(도트 5개는
    // 정적 View 로 위조 가능). home-hero-page-N 은 N당 정확히 1노드여야 한다(★F-3).
    [0, 1, 2, 3, 4].forEach((i) => {
      expect(screen.getByTestId(`home-hero-page-${i}`)).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('home-hero-page-5')).toBeNull();

    // 5도트(정확히 5).
    [0, 1, 2, 3, 4].forEach((i) => {
      expect(screen.getByTestId(`home-hero-dot-${i}`)).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('home-hero-dot-5')).toBeNull();

    // 6-b: 실 좌우 스와이프·페이지 전환·활성 도트 하이라이트는 jest 원리적 사각.
  });
});

describe('🔴 HomeScreen — 벨 흰 원형 버튼 + 그림자 (TRIP-694 AC-3)', () => {
  it('home-dashboard-bell 이 bg-canvas+rounded-full+그림자이고 빨간점 배지를 유지한다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    const bell = screen.getByTestId('home-dashboard-bell');

    // red-first — className 은 jest 렌더 트리에 평문 문자열 prop 으로 남는다(02a §2 실측).
    // 현재 벨 className 엔 bg-canvas·rounded-full 이 없다.
    expect(bell.props.className).toContain('bg-canvas');
    expect(bell.props.className).toContain('rounded-full');

    // red-first — softCardShadow(shadowColor 존재). flatten 은 객체/배열/undefined 를
    // 정규화한다(undefined 를 넣지 않게 `?? {}` 가드, 현재 style 미지정 → shadowColor undefined).
    const bellStyle = StyleSheet.flatten(bell.props.style ?? {}) as {
      shadowColor?: unknown;
    };
    expect(bellStyle.shadowColor).toBeDefined();

    // 앵커 — 빨간점 배지(bg-primary View)가 벨 서브트리에 남아 있다(벨 리팩터에 배지가
    // 딸려 사라지지 않게). within(bell)의 UNSAFE_queryAllByType(View)는 자식 View 만 돌려준다
    // (Pressable 호스트 자신은 미포함, 02a §2 실측). px(7→8)·원 크기·그림자 농도는 6-b.
    const badge = within(bell)
      .UNSAFE_queryAllByType(View)
      .find((node) => String(node.props.className).includes('bg-primary'));
    expect(badge).toBeDefined();
  });
});

describe('🔴 HomeScreen — 생성 사진 배선 (TRIP-694 AC-5)', () => {
  it('히어로·컬렉션·스팟 카드가 Image 로 렌더된다(플레이스홀더 View 대체)', () => {
    // 테스트는 에셋을 require 하지 않는다 — Image 엘리먼트 렌더 자체만 잠근다(source uri 가
    // jest 에서 null 이어도 Image 노드는 그려짐, h11 선례). 에셋 부재라도 red 는 "Image 미렌더"
    // 라는 정상 red 다(★F-6). 크래시 안전망은 기존 devPreviewHome.test.tsx 가 겸한다.
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // red-first — 현재 히어로/카드는 bg-surface-strong View 만 있어 Image 0개.
    const hero = screen.getByTestId('home-magazine-hero');
    expect(within(hero).UNSAFE_queryAllByType(Image).length).toBeGreaterThan(0);

    const collection = screen.getByTestId('home-collection-card-0');
    expect(
      within(collection).UNSAFE_queryAllByType(Image).length
    ).toBeGreaterThan(0);

    const spot = screen.getByTestId('home-spot-card-0');
    expect(within(spot).UNSAFE_queryAllByType(Image).length).toBeGreaterThan(0);
  });
});

describe('🔴 HomeScreen — 여행자 일정 섹션 default 제거 (TRIP-694 AC-6)', () => {
  it('discovery 에 여행자 일정 섹션·카드가 없다(컬렉션·스팟 발견 콘텐츠는 유지)', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 긍정 앵커 — 발견 콘텐츠가 실제로 그려졌음을 못박는다(화면 통삭 시 공허 통과 차단).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();

    // 부정(red-first) — 여행자 일정 섹션 흔적 3종이 discovery 에서 사라진다. 현재 DiscoveryBody
    // 가 ItinerariesSection 을 렌더(HomeScreen L814)해 셋 다 present → red. ItinerariesSection
    // 컴포넌트 정의·타입·planning/collecting 얼굴은 유지되므로 homeStructure 소스 스캔은 green.
    expect(screen.queryByText('여행자 일정')).toBeNull();
    expect(screen.queryByTestId('home-itineraries-more')).toBeNull();
    expect(screen.queryByTestId('home-itinerary-card-0')).toBeNull();
  });
});

describe('🔴 HomeScreen — discovery 담은 곳 배너 제거 (TRIP-596 AC-1)', () => {
  it('discovery 얼굴은 그려지지만 담은 곳 배너(softNote·CTA)는 화면에 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 긍정 앵커 — discovery 본문이 실제로 그려졌음을 먼저 못박는다(★V-1). getByTestId 는 못
    // 찾으면 throw 라, 아래 부재 단언이 "화면이 통째로 안 그려져서 통과"하는 공허 통과가 아님을
    // 이 앵커가 보장한다. home-magazine-hero 는 DiscoveryBody 가 그리는 discovery 고유 요소다.
    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();

    // 부정 짝 — 배너 소속 testID 2개(계열 전체)를 함께 잠근다. queryByTestId 는 못 찾으면 null
    // 을 돌려주고(throw 안 함), toBeNull 은 그 값이 null 인지 본다. 오타·컴포넌트 통삭이면 앵커가
    // 먼저 red 를 낸다. 지우는 것은 discovery 인스턴스뿐 — SoftNote 컴포넌트와 planning 브릿지·
    // postTrip 공유 인스턴스는 같은 testID 를 계속 쓰므로 그 얼굴 테스트는 무변경이다.
    expect(screen.queryByTestId('home-soft-note')).toBeNull();
    expect(screen.queryByTestId('home-saved-places-cta')).toBeNull();
  });
});

describe('HomeScreen — 컬렉션 카드 데이터 (AC-2)', () => {
  it('요즘 담는 곳 카드 3장이 각 픽스처값(제목·지역·배지)으로 렌더되고 4번째는 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    EXPECTED_COLLECTIONS.forEach((c, i) => {
      const card = screen.getByTestId(`home-collection-card-${i}`);
      expect(within(card).getByText(c.title)).toBeOnTheScreen();
      expect(within(card).getByText(c.region)).toBeOnTheScreen();
      expect(within(card).getByText(c.badge)).toBeOnTheScreen();
    });

    // 정확히 3장 — 4번째(index 3)는 없다.
    expect(screen.queryByTestId('home-collection-card-3')).toBeNull();
  });
});

describe('HomeScreen — 스팟 카드 데이터 (AC-2)', () => {
  it('지금 뜨는 장소 카드 4장이 각 픽스처값(제목·해시태그)으로 렌더되고 5번째는 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    EXPECTED_SPOTS.forEach((s, i) => {
      const card = screen.getByTestId(`home-spot-card-${i}`);
      expect(within(card).getByText(s.title)).toBeOnTheScreen();
      expect(within(card).getByText(s.tag)).toBeOnTheScreen();
    });

    // 정확히 4장 — 5번째(index 4)는 없다.
    expect(screen.queryByTestId('home-spot-card-4')).toBeNull();
  });
});

describe('🔴 HomeScreen — no-trip 온램프는 하트 FAB (TRIP-596 AC-1/AC-6 · US-SHELL-05)', () => {
  it('no-trip에서 담은 곳 배너는 없고 하트 FAB 토글이 온램프를 잇는다(피드 섹션은 유지)', () => {
    // no-trip = discovery(가정 B: 신 피드는 여행 유무와 무관)라 배너가 같이 사라진다. 담은 곳
    // 온램프는 배너 대신 하트 FAB(장소→d02·숙소→e04)이 승계한다 — US-SHELL-05의 "저장 POI 진입"
    // 은 배너가 아니라 FAB으로 유지된다. TRIP-701 로 HOME_NO_TRIP_PROPS 가 HOME_DEFAULT_PROPS 와
    // 병합(바이트 동일)돼 default props 로 렌더하되, 이 describe 는 US-SHELL-05 온램프 앵커로 존치한다.
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 부정 — 담은 곳 배너 계열(softNote·CTA)이 no-trip에도 없다.
    expect(screen.queryByTestId('home-soft-note')).toBeNull();
    expect(screen.queryByTestId('home-saved-places-cta')).toBeNull();

    // 긍정(온램프 대체 겸 앵커) — 하트 FAB 토글은 닫힘 상태에서도 항상 present. 담은 곳 진입을
    // 잇는 대체 수단이자, no-trip 화면이 실제로 그려졌음을 보장하는 앵커다(★V-1).
    // FAB → onPressSavedPlaces 발화 자체는 TRIP-494 describe(열림 케이스)가 이미 잠근다.
    expect(screen.getByTestId('home-saved-menu-toggle')).toBeOnTheScreen();

    // 피드 섹션은 no-trip에서도 그대로(가정 B).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
  });
});

describe('HomeScreen — loading 스켈레톤 (AC-5 · INV-4 · TRIP-699)', () => {
  it('히어로는 통짜 스켈레톤이고 섹션도 스켈레톤이며 두 FAB는 숨고 고정 블록·실카드 상태는 유지된다', () => {
    render(<HomeScreen {...HOME_LOADING_PROPS} />);

    // 긍정 — 스켈레톤은 텍스트가 없어 testID가 유일한 관찰 수단이다. 여행자 일정 섹션은
    // TRIP-694로 discovery에서 제거돼 스켈레톤도 함께 사라진다(★F-1).
    expect(screen.getByTestId('home-collections-skeleton')).toBeOnTheScreen();
    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();

    // 긍정 — 이미 가용한 고정 블록은 로딩 중에도 정상 표시(가용 블록 우선, 부재 단언 앵커 겸함).
    expect(screen.getByText('오늘은 어디를 상상해볼까요')).toBeOnTheScreen();
    expect(screen.getByTestId('home-search-bar')).toBeOnTheScreen();

    // TRIP-699 — 로딩이면 히어로는 캐러셀이 아니라 통짜 스켈레톤(Figma 2174:2307). magazine-hero·
    // 캐러셀 페이지는 렌더되지 않는다(694 캐러셀은 ready/discovery 전용).
    expect(screen.getByTestId('home-hero-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
    expect(screen.queryByTestId('home-hero-page-0')).toBeNull();

    // TRIP-699 — 로딩이면 두 FAB(담은 곳 하트·여행 만들기 +)는 숨는다(Figma 2174:2307).
    expect(screen.queryByTestId('home-create-trip-fab')).toBeNull();
    expect(screen.queryByTestId('home-saved-menu-toggle')).toBeNull();

    // 부정 짝 — loading엔 실카드도 빈 플레이스홀더도 없고, 담은 곳 배너(TRIP-596 제거)도 없다.
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
    expect(screen.queryByTestId('home-collections-empty')).toBeNull();
    expect(screen.queryByTestId('home-soft-note')).toBeNull();
  });
});

describe('HomeScreen — INV-3 시간 미표시 (AC-6, 렌더 절반)', () => {
  it('화면 어디에도 소요시간 문자열(분·시간·소요)이 렌더되지 않는다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 신 화면엔 거리도 소요시간도 없다(구 화면의 `도보 850m`·`3분 전`조차 사라짐).
    // 정규식 `.test`는 부분 매치라 리프 어디에 있어도 잡힌다. queryAllByText는 [] 반환
    // (다중 매치라도 throw하지 않음) → length 0이면 시간 표기 0.
    expect(screen.queryAllByText(/소요|\d+\s*분|\d+\s*시간/)).toHaveLength(0);
  });
});

describe('HomeScreen — CTA 콜백 발화·격리 (370-AC-2)', () => {
  it('각 배선 CTA press 는 자기 콜백만 정확히 1회 발화한다(화면은 라우터를 모른다)', () => {
    // 준비 — 배선 콜백 3종을 jest.fn()으로 주입. HomeScreen 은 이 함수만 발화할 뿐 어디로
    // 가는지(라우터)는 모른다 — 목적지 왕복은 tabsHomeRoute.test.tsx(370-AC-1)가 잰다.
    const onPressCreateTrip = jest.fn();
    const onPressSavedPlaces = jest.fn();
    const onPressSpotsMore = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        onPressCreateTrip={onPressCreateTrip}
        onPressSavedPlaces={onPressSavedPlaces}
        onPressSpotsMore={onPressSpotsMore}
      />
    );

    // 실행·단언 — FAB → 여행 생성 콜백만(다른 콜백은 안 건드림 = 오배선 차단).
    fireEvent.press(screen.getByTestId('home-create-trip-fab'));
    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
    expect(onPressSavedPlaces).not.toHaveBeenCalled();
    expect(onPressSpotsMore).not.toHaveBeenCalled();

    // 뜨는 장소 더 보기 → 스팟 더보기 콜백만. (구 담은 곳 배너 CTA press 는 TRIP-596 제거 —
    // 담은 곳 발화는 하트 FAB describe(TRIP-494 열림 케이스)가 잠근다. onPressSavedPlaces 는
    // 계속 주입해 두어 FAB·spots-more 가 실수로 그것을 발화하지 않음을 아래에서 교차 확인한다.)
    onPressCreateTrip.mockClear();
    fireEvent.press(screen.getByTestId('home-spots-more'));
    expect(onPressSpotsMore).toHaveBeenCalledTimes(1);
    expect(onPressCreateTrip).not.toHaveBeenCalled();
    expect(onPressSavedPlaces).not.toHaveBeenCalled();
  });
});

describe('HomeScreen — 담은 곳 saved-menu FAB (TRIP-494)', () => {
  it('닫힌 상태: 하트 토글 press → onToggleSavedMenu 만 부른다(미니 FAB 은 아직 없다)', () => {
    const onToggleSavedMenu = jest.fn();
    const onPressSavedPlaces = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        savedMenuOpen={false}
        onToggleSavedMenu={onToggleSavedMenu}
        onPressSavedPlaces={onPressSavedPlaces}
      />
    );

    // 닫힘 — 미니 FAB 은 트리에 없다.
    expect(screen.queryByTestId('home-saved-places-fab')).toBeNull();
    expect(screen.queryByTestId('home-saved-stays-fab')).toBeNull();

    fireEvent.press(screen.getByTestId('home-saved-menu-toggle'));
    expect(onToggleSavedMenu).toHaveBeenCalledTimes(1);
    expect(onPressSavedPlaces).not.toHaveBeenCalled(); // 토글은 이동이 아니라 펼침이다
  });

  it('열린 상태: 담은 장소 미니 FAB→onPressSavedPlaces · 저장한 숙소 미니 FAB→onPressSavedStays', () => {
    const onPressSavedPlaces = jest.fn();
    const onPressSavedStays = jest.fn();
    const onPressCreateTrip = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        savedMenuOpen
        onPressSavedPlaces={onPressSavedPlaces}
        onPressSavedStays={onPressSavedStays}
        onPressCreateTrip={onPressCreateTrip}
      />
    );

    fireEvent.press(screen.getByTestId('home-saved-places-fab'));
    expect(onPressSavedPlaces).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('home-saved-stays-fab'));
    expect(onPressSavedStays).toHaveBeenCalledTimes(1);

    expect(onPressCreateTrip).not.toHaveBeenCalled(); // + FAB 과 안 헷갈림
  });
});

// TRIP-695 — 담은 곳 미니 FAB 우상단 개수 배지(핑크 원). 열림+count≥1일 때만 뜨고, 텍스트는
// 100 이상이면 '99+'로 접힌다(formatCountBadge, AC-2). 지름 20px·흰 2px 테두리·shadow·우상단
// flush 위치는 6-b 육안 전용(jest 사각) — 여기선 배지 유무·개수 텍스트·bg-primary className만
// 잠근다(01 §85: 배지는 View+NativeWind라 className 관측됨, 미니FAB 안 SVG 글리프 색과 다름).
// 기대 텍스트는 리터럴('7'·'3'·'99+')로 박는다 — formatCountBadge 모듈을 여기서 import 하면
// 미존재 시 이 파일 전체가 로드 실패해 무회귀 describe 까지 통째 red 가 된다(02a ★D1). 포맷터
// 정확성은 formatCountBadge.test.ts 가 독립으로 잠근다.
describe('HomeScreen — 담은 곳 배지 표시/미표시 (TRIP-695 AC-1)', () => {
  it('열림+savedPlacesCount≥1 → 장소 배지 present·개수 텍스트·bg-primary', () => {
    render(
      <HomeScreen {...HOME_DEFAULT_PROPS} savedMenuOpen savedPlacesCount={7} />
    );

    // toHaveTextContent(문자열)은 기본 exact=true — 배지 전체 텍스트가 '7'과 완전일치해야
    // 매치한다(node_modules matches.js L8 default exact=true, 02a §10-1). 배지는 count 단일
    // 리프라 '70' 같은 뮤턴트는 '7'≠'70'으로 red.
    const badge = screen.getByTestId('home-saved-places-badge');
    expect(badge).toHaveTextContent('7');
    // className 은 jest 렌더 트리에 평문 prop 으로 남는다(벨 배지 L196 선례와 동형).
    // 토큰 배열로 완전일치 — `bg-primary-pale` 같은 다른 토큰이 부분매치로 통과하는 걸 막는다
    // (code-critic 참고-2, split(/\s+/) 관용).
    expect(String(badge.props.className).split(/\s+/)).toContain('bg-primary');
  });

  it('열림+savedPlacesCount=1 → 경계값 1에서도 장소 배지 present (경계, code-critic 경고-1)', () => {
    // count≥1 게이트의 경계값 1이 렌더되는지 못박는다. 이게 없으면 게이트를 `< 2`로 바꿔도
    // (1곳 담김에서 배지 소멸) 다른 테스트가 count {0,7,100}만 봐 green으로 샌다(뮤테이션 실측).
    render(
      <HomeScreen {...HOME_DEFAULT_PROPS} savedMenuOpen savedPlacesCount={1} />
    );

    expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
      '1'
    );
  });

  it('열림+savedStaysCount≥1 → 숙소 배지 present·개수 텍스트', () => {
    render(
      <HomeScreen {...HOME_DEFAULT_PROPS} savedMenuOpen savedStaysCount={3} />
    );

    expect(screen.getByTestId('home-saved-stays-badge')).toHaveTextContent('3');
  });

  it('열림+count≥100 → 배지 텍스트가 "99+"로 접힌다(화면이 폴딩값을 표시)', () => {
    // AC-1↔AC-2 연결 — 화면이 100을 그대로 '100'으로 그리지 않고 '99+'로 접어 보이는가.
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        savedMenuOpen
        savedPlacesCount={100}
      />
    );

    expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
      '99+'
    );
  });

  it('열림+count 0/미지정 → 두 배지 모두 absent (BR-U1-06/09, count≥1 게이트)', () => {
    // 장소=0, 숙소=미지정. 빈 핑크 원이 뜨면 안 된다(컴포넌트가 count 로 먼저 가른다).
    render(
      <HomeScreen {...HOME_DEFAULT_PROPS} savedMenuOpen savedPlacesCount={0} />
    );

    expect(screen.queryByTestId('home-saved-places-badge')).toBeNull();
    expect(screen.queryByTestId('home-saved-stays-badge')).toBeNull();
  });

  it('닫힘(savedMenuOpen=false)+count 지정 → 배지 absent(미니 FAB 자체가 없다)', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        savedMenuOpen={false}
        savedPlacesCount={7}
        savedStaysCount={3}
      />
    );

    // 닫힘 = 미니 FAB 부재(TRIP-494 계약) → 그 안의 배지도 없다.
    expect(screen.queryByTestId('home-saved-places-fab')).toBeNull();
    expect(screen.queryByTestId('home-saved-places-badge')).toBeNull();
    expect(screen.queryByTestId('home-saved-stays-badge')).toBeNull();
  });
});

// TRIP-695 AC-3 — 백드롭이 + FAB(여행 만들기)도 덮도록 z-order 를 바꾼다(목표 스택 뒤→위:
// CreateTripFab → 백드롭 → 미니 FAB+토글). ⚠️ 실제 딤이 +FAB 을 덮는지는 RN 문서순+zIndex 라
// jest 원리적 사각(바텀시트 딤 함정 동형) — 6-b 육안 전용. 여기 두 it 은 **이동 회귀 앵커**다:
// 지금도 green 이고 implementer 가 백드롭을 HomeScreen 레벨로 승격해도 testID·onPress 가
// 살아있어야 green(트리 순서 단언은 취약해서 안 한다, 01 §128).
describe('HomeScreen — saved-menu z-order 회귀 앵커 (TRIP-695 AC-3)', () => {
  it('열림 시 백드롭·토글·장소FAB·숙소FAB·CreateTripFab 이 공존한다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} savedMenuOpen />);

    expect(screen.getByTestId('home-saved-menu-backdrop')).toBeOnTheScreen();
    expect(screen.getByTestId('home-saved-menu-toggle')).toBeOnTheScreen();
    expect(screen.getByTestId('home-saved-places-fab')).toBeOnTheScreen();
    expect(screen.getByTestId('home-saved-stays-fab')).toBeOnTheScreen();
    expect(screen.getByTestId('home-create-trip-fab')).toBeOnTheScreen();
  });

  it('백드롭 press → onToggleSavedMenu 발화(바깥 탭으로 메뉴 닫힘)', () => {
    const onToggleSavedMenu = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        savedMenuOpen
        onToggleSavedMenu={onToggleSavedMenu}
      />
    );

    fireEvent.press(screen.getByTestId('home-saved-menu-backdrop'));
    expect(onToggleSavedMenu).toHaveBeenCalledTimes(1);
  });
});

describe('HomeScreen — 비배선 컨트롤은 버튼 역할이 아니다 (370-AC-3 · 부정)', () => {
  it('목적지 없는 컨트롤(검색바·비배선 더보기·벨)은 accessibilityRole="button"으로 노출되지 않는다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // queryAllByRole('button')은 accessibilityRole/role 이 'button'인 접근성 요소만 돌려준다
    // (RNTL 13.3.3 role.js 실검증, 02a §5). onPress 유무가 아니라 role 이 소속을 정한다 —
    // 목적지 없는 컨트롤은 role 을 떼야 접근성 트리에서 버튼으로 안 읽힌다.
    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID);

    UNWIRED_CONTROL_TEST_IDS.forEach((id) => {
      expect(buttonIds).not.toContain(id);
    });
  });
});

describe('HomeScreen — 버튼 역할 집합 == 배선된 CTA 집합 (370-AC-4 · 회귀)', () => {
  it('discovery 접근성 트리에서 버튼으로 읽히는 것은 배선된 3개 CTA 뿐이다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 실제 onPress 목적지가 있는 요소만 버튼이어야 한다 — 집합 동치라 (a)비배선이 안 벗겨짐
    // (b)배선 CTA 가 벗겨짐 (c)공유 SectionHeader 를 전부 벗겨 spots-more 도 사라짐 (d)새 버튼
    // 유입, 넷 다 red 로 잡힌다.
    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID)
      .sort();

    expect(buttonIds).toEqual([...WIRED_CTA_TEST_IDS].sort());
  });
});

describe('HomeScreen — 비배선 컨트롤은 콜백 0·크래시 0 (370-AC-5 · 구 316-AC-8 갱신)', () => {
  it('벨·검색바·비배선 더보기·카드를 눌러도 배선 콜백이 0회이고 루트가 유지된다', () => {
    // 구 AC-8 은 FAB·담은 곳을 "눌러도 아무 일 없음(no-op)"으로 단언해 배선(370-AC-1/2)과
    // 충돌했다 → 배선 CTA 는 이 목록에서 빠지고 발화는 위 370-AC-2 가 잰다. 여기 남는 것은
    // 목적지 없는 컨트롤뿐 — 배선 콜백 3종을 전부 주입한 채 눌러 (a)이들이 실수로 배선 콜백을
    // 발화하는 오배선과 (b)testID 유실(마크업이 통째로 사라짐)을 red 로 잡는다.
    const onPressCreateTrip = jest.fn();
    const onPressSavedPlaces = jest.fn();
    const onPressSpotsMore = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        onPressCreateTrip={onPressCreateTrip}
        onPressSavedPlaces={onPressSavedPlaces}
        onPressSpotsMore={onPressSpotsMore}
      />
    );

    fireEvent.press(screen.getByTestId('home-dashboard-bell'));
    fireEvent.press(screen.getByTestId('home-search-bar'));
    fireEvent.press(screen.getByTestId('home-collections-more'));
    // home-itineraries-more 는 TRIP-694로 discovery에서 제거돼 여기서 누를 대상이 아니다(★F-1).
    fireEvent.press(screen.getByTestId('home-collection-card-0'));

    expect(onPressCreateTrip).not.toHaveBeenCalled();
    expect(onPressSavedPlaces).not.toHaveBeenCalled();
    expect(onPressSpotsMore).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-dashboard-root')).toBeOnTheScreen();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-317 — 여행 단계 phase 얼굴 (planning·postTrip). collecting·upcoming 얼굴 describe 와
// 로컬 phase 리터럴은 TRIP-701(a01·프리뷰 정리)로 프리뷰 키·픽스처가 삭제되며 함께 제거됐다
// (라이브 미도달·가정 E — 서버가 이 단계를 줄 계약이 없다). 이 파일에 남는 phase 얼굴은 2종.
//
// 무엇을 보장하나: 316 discovery(무회귀) 위에 `phase` 판별값으로 이 2얼굴을
// 그리되, 화면은 phase.kind로 스위치만 하고 단계를 스스로 도출하지 않는다(AC-5). 각 얼굴은
// 브리프 §3 델타의 고유 요소(tripHero·스탯타일·회고카드 등)를 그리고 숨겨야 할 요소는
// 부재하며(부정 짝), 어떤 얼굴에도 소요시간 문자열은 렌더되지 않는다(AC-6·INV-3).
//
// ★ INV-3 렌더 정규식 좁히기(브리프 §8-1): 316의 넓은 정규식 `/소요|\d+\s*분|\d+\s*시간/`은
// upcoming nextCard의 "24시간 개방"(영업시간)에 거짓 매치한다(실검증 OLD.test=true). 아래
// DURATION_RENDER는 이동·소요 키워드 + 수량이 붙은 것만 duration으로 보아 영업시간·시각·
// 박수·거리를 제외한다. verify317.mjs 실행: 4얼굴+discovery 렌더 문자열 37종 0매치, 진짜
// duration("소요 30분"·"도보 15분" 등) 전부 포착 확인(02a §5).
const DURATION_RENDER =
  /소요|(?:도보|차로|버스|버스로|자전거|자동차|걸어서|이동)\s*(?:약\s*)?\d+\s*(?:분|시간)|\d+\s*(?:분|시간)\s*(?:소요|이동|걸림|거리)/;

// 테스트-로컬 phase 상수(픽스처 신설 안 함 — 가정 E: (tabs) 착지는 discovery 유지). 각 렌더는
// {...HOME_DEFAULT_PROPS}로 안전한 discovery 기저를 깔고 phase를 주입한다 — 구 화면이 phase를
// 무시하고 discovery를 크래시 없이 그린 뒤 신 단언이 깨끗이 red(02a ★9).
const PLANNING_PHASE: HomePhase = {
  kind: 'planning',
  greetTitle: '부산 여행 D-21',
  greetSubtitle: '일정을 이어서 짜볼까요', // TRIP-696 인사 2줄 서브카피
  collectionsTitle: '부산에서 담을 만한 곳', // TRIP-696 지역 컬렉션 헤더(기본 "요즘 사람들이 담는 곳" 대체)
  trip: {
    badge: '계획 중',
    badgeSub: '· D-21', // TRIP-696 두 톤 배지 보조(구 dday 흡수)
    ctaLabel: '일정 이어서 짜기 ›', // 꺾쇠(›) 포함 문자열
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  // bridge 는 TRIP-646으로 렌더에서 빠졌지만 HomePhase.planning 타입엔 잔존(§696 미변경).
  bridge: {
    title: '담은 곳 3곳이 아직 일정에 없어요',
    subtitle: '남은 자리에 넣어볼까요',
    ctaLabel: '일정에 추가',
  },
};

const POST_TRIP_PHASE: HomePhase = {
  kind: 'postTrip',
  greetTitle: '부산 여행 잘 다녀오셨어요?',
  recap: {
    title: '부산 여행 회고 보기',
    meta: '4곳 방문 · 12km · 사진 6장 · 6.10–6.13',
  },
  share: {
    title: '공유 카드로 남기기',
    subtitle: '사진·동선을 카드 한 장으로',
    ctaLabel: '공유 카드 만들기',
  },
  recommendationTitle: '다음엔 여기 어때요',
  recommendations: [
    { title: '통영 동피랑', region: '경남 통영', badge: '당일치기' },
  ],
  pastTrips: [{ title: '경주 여행 2026.04 · 2박' }],
};

// TRIP-697 — '여행 중' 얼굴(통합 히어로의 planning 변형). 계획 중(PLANNING_PHASE)과 kind 는
// 같은 'planning' 이고 아래만 다르다: 배지 "여행 중"+"· 1 일차", 인사 이름줄 greetName("태현님,")
// + 타이틀("부산 여행 1일차예요")·서브 없음, CTA "오늘 일정 보기 ›", showSpots=true(2섹션),
// collectionsTitle 없음(→ 기본 "요즘 사람들이 담는 곳"). 픽스처 HOME_TRAVELING_PROPS 를 이 파일에
// import 하지 않고 로컬 리터럴로 두는 이유: 그 픽스처는 implementer 산출물이라 아직 없고(미존재
// import 시 파일 로드가 흔들림, ★D1 선례), {...HOME_DEFAULT_PROPS} 위에 phase 만 얹으면 안전한
// discovery 기저가 깔려 신 단언이 깨끗이 red 난다(PLANNING_PHASE 와 동형). bridge 는 planning
// 타입 필수라 넣는다(§697 렌더 무관 — TRIP-646 으로 렌더에서 빠짐).
const TRAVELING_PHASE: HomePhase = {
  kind: 'planning',
  greetName: '태현님,', // 여행 중 인사 이름줄(이름↑ → 타이틀↓ 순서) — 라이브엔 소스 없어 픽스처 전용
  greetTitle: '부산 여행 1일차예요', // Figma 2091:1717 정본(티켓 "…곧 시작돼요"는 폐기, OQ-1)
  showSpots: true, // 2섹션 판별(컬렉션 + 지금 뜨는 장소)
  // greetSubtitle 없음(여행 중 인사는 2줄이지만 이름+타이틀, 서브카피 없음) · collectionsTitle 없음(기본)
  trip: {
    badge: '여행 중',
    badgeSub: '· 1 일차', // 두 톤 배지 보조 — N일차(공백 O). 여행 첫날 = 1일차
    ctaLabel: '오늘 일정 보기 ›', // 꺾쇠(›) 포함 문자열
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  bridge: {
    title: '담은 곳 3곳이 아직 일정에 없어요',
    subtitle: '남은 자리에 넣어볼까요',
    ctaLabel: '일정에 추가',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-696 — 계획 중 얼굴을 구 300px 2페이지 HeroCarousel 에서 풀블리드 5페이지 통합 히어로로
// 재작성. 무엇을 보장하나: (1) 두 톤 배지("계획 중"+"· D-21")·꺾쇠 CTA·타이틀·메타를 한
// 히어로(home-trip-hero)에 그리고(AC-696-1), (2) 구 우상단 대형 D-day(home-trip-hero-dday)·
// 구 2페이지 캐러셀(home-hero-carousel)이 사라지고 5페이지 컨테이너로 대체되며(AC-696-2),
// (3) 본문이 컬렉션 1섹션만 남아 "지금 뜨는 장소"·"여행자 일정"이 사라지고(AC-696-3), (4) 인사가
// 타이틀+서브 2줄이 되고(AC-696-4), (5) 소요시간 0(AC-696-6)을 잠근다.
//
// ★D1 — 구 planning describe 는 home-trip-hero-dday·home-hero-carousel 을 getBy 로 참조해
// 구현이 그 testID 를 지우면 하드 FAIL 하므로 통째 재작성한다. 부정 단언마다 긍정 앵커 짝.
// ★D2 — 통합 히어로 page1~4 는 매거진을 home-hero-slide-N 으로 품는다(page0 만 트립). planning
// 테스트는 home-magazine-hero 를 참조하지 않는다(다중매치 throw 회피, traps-home). 페이지 수는
// home-hero-page-N 컨테이너로만 잠근다(도트는 위조 가능 — 약한 앵커).
// 시각(폰트 px·3-stop 그라디언트·배지 테두리·도트 정렬/활성·좌우 스와이프)은 jest 원리적 사각 → 6-b.

describe('🔴 HomeScreen — planning 통합 히어로 렌더 (TRIP-696 AC-696-1)', () => {
  it('두 톤 배지("계획 중"+"· D-21")·꺾쇠 CTA·타이틀·메타를 한 히어로(home-trip-hero)에 그린다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    // 앵커 — 통합 히어로 컨테이너 실존(부정·부분 단언 공허 통과 차단).
    const hero = screen.getByTestId('home-trip-hero');

    // 두 톤 배지 — 같은 배지 안에 "계획 중"(primary)·"· D-21"(ink) 두 host <Text> 리프가 함께
    // 있다. within(badge)로 좁히고 getByText 는 리프 텍스트 **완전일치**(02a §5-c)라 두 리프가
    // 각각 잡혀야 통과 → "두 톤(별개 Text 2개)" 구조가 잠긴다. 현 히어로는 dday 를 별도 우상단에
    // 그려 배지엔 "· D-21" 리프가 없다 → getByText throw → red.
    const badge = screen.getByTestId('home-trip-hero-badge');
    expect(within(badge).getByText('계획 중')).toBeOnTheScreen();
    expect(within(badge).getByText('· D-21')).toBeOnTheScreen();

    // 꺾쇠 CTA — toHaveTextContent(문자열)은 요소 전체 텍스트 **완전일치**(02a §5-c(a))라 꺾쇠(›)를
    // 뺀 뮤턴트를 red 로 잡는다. 픽스처 ctaLabel 이 이미 꺾쇠 포함이라 이 단언 자체는 선제 green.
    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기 ›'
    );

    // 타이틀·메타 — 히어로 서브트리는 여러 Text 리프라 정규식 부분 매치(02a §5-c(b)).
    expect(hero).toHaveTextContent(/부산 여행/);
    expect(hero).toHaveTextContent(/3박 4일 · 2명/);
  });
});

describe('🔴 HomeScreen — planning 구 히어로 요소 제거 + 5페이지 (TRIP-696 AC-696-2)', () => {
  it('구 우상단 D-day·2페이지 캐러셀이 없고 5페이지 컨테이너·5도트로 대체된다(home-trip-hero 앵커)', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    // 긍정 앵커 — 통합 히어로가 실제로 그려졌다(부정 단언 공허 통과 차단).
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();

    // 부정 — 구 우상단 대형 D-day·구 2페이지 캐러셀 testID 소멸(D-day 는 배지 보조로 흡수).
    // 현재 planning 은 둘 다 present → toBeNull red.
    expect(screen.queryByTestId('home-trip-hero-dday')).toBeNull();
    expect(screen.queryByTestId('home-hero-carousel')).toBeNull();

    // 긍정(진짜 앵커) — 5페이지 컨테이너로 페이지 수를 잠근다(도트 위조 방지, traps-home).
    // page0=트립 히어로, page1~4=매거진. N당 1노드, 6번째는 없다. 현 planning 은 HeroCarousel 이라
    // home-hero-page-N 을 아예 안 써 getByTestId throw → red.
    [0, 1, 2, 3, 4].forEach((i) =>
      expect(screen.getByTestId(`home-hero-page-${i}`)).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('home-hero-page-5')).toBeNull();

    // 약한 앵커 — 도트 5(정확). 현 planning 은 2도트라 dot-2 throw → red.
    [0, 1, 2, 3, 4].forEach((i) =>
      expect(screen.getByTestId(`home-hero-dot-${i}`)).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('home-hero-dot-5')).toBeNull();

    // 6-b: 좌우 스와이프·페이지 전환·활성 도트 하이라이트는 jest 원리적 사각.
  });
});

describe('🔴 HomeScreen — planning 본문 1섹션(컬렉션만) (TRIP-696 AC-696-3)', () => {
  it('지역 컬렉션 헤더·카드는 있고 "지금 뜨는 장소"·"여행자 일정"은 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    // 긍정 — 컬렉션 카드 실재(앵커) + 헤더가 지역 카피(collectionsTitle). planning 은 기본
    // "요즘 사람들이 담는 곳"이 아니라 픽스처의 "부산에서 담을 만한 곳"을 그린다 → 현재는 헤더가
    // 하드코딩 "요즘 사람들이 담는 곳"이라 getByText throw → red(파라미터화 red-first).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
    expect(screen.getByText('부산에서 담을 만한 곳')).toBeOnTheScreen();

    // 부정 — 기본 컬렉션 카피·스팟 섹션·여행자 일정 섹션이 planning 에서 사라진다. 현
    // PlanningBody 는 셋 다 렌더(HomeScreen L924-926)라 전부 present → toBeNull red.
    expect(screen.queryByText('요즘 사람들이 담는 곳')).toBeNull();
    expect(screen.queryByText('지금 뜨는 장소')).toBeNull();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
    expect(screen.queryByTestId('home-itineraries-more')).toBeNull();
  });
});

describe('🔴 HomeScreen — planning 인사 2줄 + INV-3 (TRIP-696 AC-696-4·6)', () => {
  it('home-greeting 이 타이틀 "부산 여행 D-21"과 서브 "일정을 이어서 짜볼까요"를 함께 그리고 소요시간은 0이다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    // 인사 컨테이너는 타이틀+서브 두 리프라 정규식 부분 매치(02a §5-c(b)). 현 PlanningBody 는
    // subtitle 을 안 넘겨(GreetingHeader title 만) 서브 라인이 없어 둘째 단언 red.
    const greeting = screen.getByTestId('home-greeting');
    expect(greeting).toHaveTextContent(/부산 여행 D-21/);
    expect(greeting).toHaveTextContent(/일정을 이어서 짜볼까요/);

    // INV-3 — planning 얼굴 어디에도 소요시간 문자열 없음(선제 green 회귀 앵커).
    expect(screen.queryAllByText(DURATION_RENDER)).toHaveLength(0);
  });
});

describe('HomeScreen — postTrip 얼굴 (AC-4 · US-SHELL-02)', () => {
  it('"잘 다녀오셨어요" greet·회고 보기 카드·추천·지난 여행을 그리고 공유행·hero·grid는 숨긴다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={POST_TRIP_PHASE} />);

    expect(screen.getByTestId('home-greeting')).toHaveTextContent(
      /잘 다녀오셨어요/
    );

    // 회고 진입(핵심 AC-4) — 회고 카드 + 방문 수·거리·사진 수(12km 거리 OK, 소요시간 0).
    const recap = screen.getByTestId('home-recap-card');
    expect(within(recap).getByText('부산 여행 회고 보기')).toBeOnTheScreen();
    expect(recap).toHaveTextContent(/4곳 방문 · 12km · 사진 6장/);

    // 공유행(softNote)은 TRIP-646으로 제거됐다.
    expect(screen.queryByTestId('home-soft-note')).toBeNull();

    // 추천 섹션 + 지난 여행.
    expect(screen.getByText('다음엔 여기 어때요')).toBeOnTheScreen();
    expect(screen.getByTestId('home-past-trip-card-0')).toBeOnTheScreen();

    // 부정 짝 — postTrip은 magazineHero·grid 숨김(§3-B).
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();

    // INV-3.
    expect(screen.queryAllByText(DURATION_RENDER)).toHaveLength(0);
  });
});

describe('HomeScreen — phase 미도출·주입 (AC-5 금지 · TRIP-206 S-6)', () => {
  it('phase 미전달이면 discovery 얼굴이고, phase 주입 시 그 얼굴로 스위치한다(화면은 단계를 도출하지 않는다)', () => {
    // (1) phase 미전달 → discovery 폴백. 화면은 여행 유무를 추론하지 않는다.
    const view = render(<HomeScreen {...HOME_DEFAULT_PROPS} />);
    expect(screen.getByText('오늘은 어디를 상상해볼까요')).toBeOnTheScreen();
    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
    view.unmount();

    // (2) 같은 화면에 phase=planning 주입 → 통합 트립 히어로로 스위치. discovery로 폴백하지 않는다.
    // (home-trip-hero·home-trip-hero-badge 는 planning 전용 — discovery 얼굴엔 없어 판별자로 쓴다.
    // TRIP-696: 구 판별자 home-hero-carousel 소멸 → 배지로 교체, 현·후 둘 다 present 회귀 앵커.)
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('home-trip-hero-badge')).toBeOnTheScreen();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-696 — planning 통합 히어로 재작성 후 버튼 역할 집합(AC-696-5).
//
// 무엇을 보장하나: planning(1섹션) 얼굴에서 접근성 트리에 버튼으로 읽히는 것은 **배선된 CTA 뿐**이다
// — 여행 카드 본체(home-trip-hero)+알약(home-trip-hero-cta)+검색바+두 FAB. 본문이 컬렉션 1섹션이라
// "지금 뜨는 장소 더보기"(home-spots-more)가 사라져 구 집합에서 빠진다. 콜백을 주입하지 않고도 이
// 집합이 유지돼야 role 이 콜백 유무 파생이 아니라 구조임을 강제한다(★D4).

// planning 얼굴에서 목적지가 있어 버튼이어야 하는 것(구조로 굳힘 — 콜백 미주입에도 버튼).
// TRIP-453 — 검색바·여행 카드 본체(항해=알약과 동일)가 버튼. 카드 본체(home-trip-hero)와
// 알약(home-trip-hero-cta)은 중첩 Pressable 이라 둘 다 버튼 집합에 든다(★1·★3).
const PLANNING_WIRED_CTA_TEST_IDS = [
  'home-create-trip-fab',
  'home-saved-menu-toggle', // TRIP-494 담은 곳 saved-menu FAB(모든 얼굴 공통, 닫힘=하트 토글)
  'home-trip-hero-cta',
  'home-search-bar',
  'home-trip-hero',
  // TRIP-696 — home-spots-more 제거: 계획 중 본문이 컬렉션 1섹션이라 스팟 섹션(및 그 더보기 버튼)이
  // 사라진다. 현 planning 은 아직 6버튼(spots-more 포함)이라 이 5집합과 불일치 → red.
] as const;

describe('🔴 HomeScreen — planning 버튼 역할 집합 == 배선 CTA 집합 (TRIP-696 AC-696-5)', () => {
  it('planning 접근성 트리에서 버튼으로 읽히는 것은 여행 카드 CTA·검색바·FAB 5개 뿐이다(home-spots-more 제외)', () => {
    // 콜백을 주입하지 않는다 — role 이 콜백 유무 파생이 아니라 구조여야 함을 강제한다(★D4).
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID)
      .sort();

    // 집합 동치 — spots-more 가 안 빠지거나(현행) 배선 CTA 가 벗겨지면 red.
    expect(buttonIds).toEqual([...PLANNING_WIRED_CTA_TEST_IDS].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-453 — 진입점 미배선 연결(화면측 콜백 배선). 라우터 왕복은 화면이 아니라
// `(tabs)/index.tsx` seam 이 지므로 tabsHomeRoute/tabsHomeItineraryCta 가 별도로 잰다.
// 여기서는 화면이 넘겨받은 콜백만 정확히 발화하는지(오배선·이중발화 없음)를 잠근다.

describe('🔴 HomeScreen — 검색바 배선 (AC-1a · entry 1 화면측)', () => {
  it('검색바 press 는 onPressSearch 만 정확히 1회 발화한다(다른 콜백 0회)', () => {
    // 준비 — 4콜백 주입. 화면은 검색바→onPressSearch 로만 스레딩해야 하고, 다른 배선 CTA 의
    // 콜백을 실수로 발화하면(오배선) red. onPressSearch 는 아직 HomeScreenProps 에 없지만 jest
    // (babel)는 타입을 벗기고, 미소비 prop 은 런타임에 무시되므로 오늘은 0회로 정상 red 다.
    const onPressSearch = jest.fn();
    const onPressCreateTrip = jest.fn();
    const onPressSavedPlaces = jest.fn();
    const onPressSpotsMore = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        onPressSearch={onPressSearch}
        onPressCreateTrip={onPressCreateTrip}
        onPressSavedPlaces={onPressSavedPlaces}
        onPressSpotsMore={onPressSpotsMore}
      />
    );

    // 실행·단언 — 검색바 → 검색 콜백만.
    fireEvent.press(screen.getByTestId('home-search-bar'));
    expect(onPressSearch).toHaveBeenCalledTimes(1);
    expect(onPressCreateTrip).not.toHaveBeenCalled();
    expect(onPressSavedPlaces).not.toHaveBeenCalled();
    expect(onPressSpotsMore).not.toHaveBeenCalled();
  });
});

// entry 3(여행 카드 본체 → 일정)의 화면측 실판정은 **위 AC-7 planning 버튼-집합**이 진다:
// home-trip-hero 가 accessibilityRole="button" 을 얻어 버튼 집합에 드는지가 유일하게 신뢰 가능한
// 신호다. press 기반 화면 테스트는 **의도적으로 두지 않는다** — `TripHero` 는 onPress 를 prop 으로
// 받는 합성 컴포넌트라, RNTL findEventHandler 가 위로 올라가다 TripHero 합성요소의 props.onPress
// 를 집어(실검증 발견) home-trip-hero(순수 View)를 눌러도 onPressTripHeroCta 가 발화한다 →
// 배선 여부와 무관한 공허 통과다. 게다가 Pressable host 요소는 props.onPress 를 노출하지 않아
// (RN 내부 responder) 요소 단위 onPress 대조도 불가. 그래서 role(구조)만이 실판정이고, 목적지·
// 이중발화 회귀는 라우트 층(tabsHomeItineraryCta)의 **구현 후 앵커**로 둔다(02a ★3·§5 (a)).

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-697 — '여행 중' 얼굴(TRIP-696 통합 히어로의 planning 변형). 무엇을 보장하나:
// (1) 배지가 두 톤으로 "여행 중"+"· 1 일차", CTA 가 꺾쇠 포함 "오늘 일정 보기 ›"(AC-697-1),
// (2) 인사가 이름줄 "태현님,"(greetName) + 타이틀 "부산 여행 1일차예요" 2줄이고(AC-697-3),
// (3) 본문이 2섹션(컬렉션 + 지금 뜨는 장소)이며 "여행자 일정"은 없고(AC-697-4), (4) 어디에도
// 소요시간 문자열이 없다(AC-697-6·INV-3).
//
// ★D2(이름줄 red-first) — 현 PlanningBody 는 GreetingHeader 에 title/subtitle 만 넘겨 name 을
//   스레딩하지 않는다(HomeScreen L954). greetName 을 줘도 이름줄이 안 떠 "태현님," 단언이 red.
//   (GreetingHeader 는 이미 name prop 을 받으므로 배선만 이으면 된다 — 스타일 13.5·muted 는 6-b.)
// ★D3(showSpots 2섹션 red-first) — 현 PlanningBody 는 CollectionsSection 1섹션만 렌더(L962).
//   showSpots=true 여도 SpotsSection 이 없어 home-spot-card-0 이 부재 → red. **부정 짝**은 위
//   TRIP-696 '본문 1섹션' describe(PLANNING_PHASE, showSpots 미설정 → 스팟 부재)가 진다 — 둘이
//   함께 "showSpots 가 실제로 2섹션을 가른다(true=present · 미설정=absent)"를 잠근다(공허 통과 방지).
// ★D4(꺾쇠·두 톤은 선제 green) — CTA/배지는 데이터(trip)를 그대로 그리는 IntegratedTripHero 라
//   TRAVELING_PHASE 값으로 바로 green. red 주동은 이름줄·스팟 섹션. 완전일치 매처로 꺾쇠·서식은 잠근다.
// 시각(이름 13.5 muted·타이틀 20 bold·배지 테두리·도트 정렬)은 jest 원리적 사각 → 6-b.

describe('🔴 HomeScreen — 여행 중 배지·CTA·인사 2줄 (TRIP-697 AC-697-1·3)', () => {
  it('배지 "여행 중"+"· 1 일차"·CTA "오늘 일정 보기 ›"·인사 "태현님,"+"부산 여행 1일차예요"를 그린다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={TRAVELING_PHASE} />);

    // 두 톤 배지 — 같은 배지 안 "여행 중"(primary)·"· 1 일차"(ink) 두 host <Text> 리프. within
    // 으로 좁혀 getByText 완전일치(02a §5-c)로 각각 잡히면 "두 톤(분리 Text)" 구조가 잠긴다.
    const badge = screen.getByTestId('home-trip-hero-badge');
    expect(within(badge).getByText('여행 중')).toBeOnTheScreen();
    expect(within(badge).getByText('· 1 일차')).toBeOnTheScreen();

    // 꺾쇠 CTA — toHaveTextContent(문자열)은 요소 전체 텍스트 완전일치(02a §5-c(a))라 꺾쇠(›)를
    // 뺀 뮤턴트를 red 로 잡는다. 픽스처 ctaLabel 이 이미 꺾쇠 포함이라 이 단언은 선제 green.
    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '오늘 일정 보기 ›'
    );

    // 인사 2줄 — home-greeting 은 이름줄+타이틀 두 리프라 정규식 부분매치(02a §5-c(b)). 현
    // PlanningBody 는 name 을 안 스레딩(★D2)해 "태현님," 라인이 없어 첫 단언 red. 타이틀은 넘어가 green.
    const greeting = screen.getByTestId('home-greeting');
    expect(greeting).toHaveTextContent(/태현님,/);
    expect(greeting).toHaveTextContent(/부산 여행 1일차예요/);
  });
});

describe('🔴 HomeScreen — 여행 중 본문 2섹션 + INV-3 (TRIP-697 AC-697-4·6)', () => {
  it('컬렉션·"지금 뜨는 장소" 2섹션이 모두 있고 여행자 일정은 없으며 소요시간은 0이다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={TRAVELING_PHASE} />);

    // 긍정 앵커 — 컬렉션 카드 실재(showSpots 미해석 시에도 1섹션은 떠, 공허 통과 차단).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();

    // red-first(★D3) — showSpots=true 가 SpotsSection 을 켜야 한다. 현 PlanningBody 는 1섹션이라
    // 스팟 카드·"지금 뜨는 장소" 헤더가 없어 둘 다 throw → red. 부정 짝(계획 중=스팟 부재)은 위
    // TRIP-696 '본문 1섹션' describe 가 진다.
    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();
    expect(screen.getByText('지금 뜨는 장소')).toBeOnTheScreen();

    // 부정 — 여행자 일정 섹션은 여행 중에도 없다(PlanningBody 가 ItinerariesSection 미렌더 —
    // 697 구현자가 죽은 ItinerariesSection 정의를 지워도 이 단언은 green 유지, queryByTestId=null).
    expect(screen.queryByTestId('home-itineraries-more')).toBeNull();

    // INV-3 — 여행 중 얼굴 어디에도 소요시간 문자열 없음(선제 green 회귀 앵커, DURATION_RENDER 0매치
    // 실검증 완료). '· 1 일차'·'1일차예요'의 '일차'는 duration 키워드 아님(02a §5-c 조합 확인).
    expect(screen.queryAllByText(DURATION_RENDER)).toHaveLength(0);
  });
});
