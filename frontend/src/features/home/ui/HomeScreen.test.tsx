import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  HOME_DEFAULT_PROPS,
  HOME_EMPTY_PROPS,
  HOME_LOADING_PROPS,
  HOME_NO_TRIP_PROPS,
} from '../model/homeFixtures';
import { HomeScreen } from './HomeScreen';

/**
 * AC-1~AC-8 — 홈 default 재정합(구 "여행 상태 대시보드" → 신 "발견·영감 피드",
 * 라이브 Figma 2091:1357). props(hero·sections)만 받아 그리는 순수 프레젠테이션 화면.
 *
 * 무엇을 보장하나: 인사·검색바·영감 hero·섹션 3종(요즘 담는 곳/뜨는 장소/여행자 일정)·
 * 온램프(softNote+FAB)가 한 화면에 존재하고(AC-1), 섹션 카드가 픽스처 실측값대로 렌더되며
 * (AC-2), 상태별(ready/empty/loading)로 가용 블록은 살고 빈 섹션은 가시 플레이스홀더로
 * 드러나며(AC-4·5·INV-4), 소요시간 문자열은 어디에도 없고(AC-6·INV-3), CTA는 전부 no-op
 * (AC-8)임을 잠근다.
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

const EXPECTED_ITINERARIES = [
  { title: '부산 미식 3일 코스', nights: '2박 3일' },
  { title: '해운대 오션뷰 힐링', nights: '2박 3일' },
  { title: '로컬 시장 & 카페', nights: '1박 2일' },
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

    // 섹션 3종 헤더 + 더보기 3(각 헤더 1개씩).
    expect(screen.getByText('요즘 사람들이 담는 곳')).toBeOnTheScreen();
    expect(screen.getByText('지금 뜨는 장소')).toBeOnTheScreen();
    expect(screen.getByText('여행자 일정')).toBeOnTheScreen();
    expect(screen.getAllByText('더 보기')).toHaveLength(3);

    // 섹션당 카드 ≥1.
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();
    expect(screen.getByTestId('home-itinerary-card-0')).toBeOnTheScreen();

    // 온램프 — softNote + FAB.
    expect(screen.getByTestId('home-soft-note')).toBeOnTheScreen();
    const fab = screen.getByTestId('home-create-trip-fab');
    expect(within(fab).getByText('여행 만들기')).toBeOnTheScreen();
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

describe('HomeScreen — 여행자 일정 카드 데이터 (AC-2)', () => {
  it('여행자 일정 카드 3장이 각 픽스처값(제목·N박 M일)으로 렌더되고 4번째는 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    EXPECTED_ITINERARIES.forEach((t, i) => {
      const card = screen.getByTestId(`home-itinerary-card-${i}`);
      expect(within(card).getByText(t.title)).toBeOnTheScreen();
      // `2박 3일`은 일정 0·1 두 카드에 등장하지만 within(card)로 스코프해 각 카드 안에선
      // 단일 매치다.
      expect(within(card).getByText(t.nights)).toBeOnTheScreen();
    });

    // 정확히 3장 — 4번째(index 3)는 없다.
    expect(screen.queryByTestId('home-itinerary-card-3')).toBeNull();
  });
});

describe('HomeScreen — 첫 사용자 온램프 (AC-3 · US-SHELL-05)', () => {
  it('no-trip에서도 softNote·담은 곳·FAB 온램프가 노출되고 피드 섹션도 유지된다', () => {
    render(<HomeScreen {...HOME_NO_TRIP_PROPS} />);

    // 온램프 — 장소 먼저 담기 유도(가정 B: 신 피드는 여행 유무와 무관).
    const softNote = screen.getByTestId('home-soft-note');
    expect(
      within(softNote).getByText('마음에 든 곳이 모이면')
    ).toBeOnTheScreen();
    expect(
      within(softNote).getByText('담아둔 장소로 여행을 만들 수 있어요')
    ).toBeOnTheScreen();
    const savedCta = screen.getByTestId('home-saved-places-cta');
    expect(within(savedCta).getByText('담은 곳')).toBeOnTheScreen();
    expect(screen.getByTestId('home-create-trip-fab')).toBeOnTheScreen();

    // 피드 섹션은 no-trip에서도 그대로(가정 B).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
  });
});

describe('HomeScreen — empty 가시 플레이스홀더 (AC-4 · INV-4)', () => {
  it('빈 섹션은 가시 플레이스홀더로 드러나고 고정 블록은 살아 있으며 실카드·스켈레톤은 없다', () => {
    render(<HomeScreen {...HOME_EMPTY_PROPS} />);

    // 긍정 — 고정 블록은 침묵하지 않고 그대로 표시.
    expect(screen.getByText('오늘은 어디를 상상해볼까요')).toBeOnTheScreen();
    expect(screen.getByTestId('home-search-bar')).toBeOnTheScreen();
    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('home-soft-note')).toBeOnTheScreen();
    expect(screen.getByTestId('home-create-trip-fab')).toBeOnTheScreen();

    // 긍정 — 빈 섹션 3종이 가시 플레이스홀더로 드러난다(침묵 은닉 금지).
    // W1(code-critic) 강화: testID 존재만으로는 빈 View도 통과 → INV-4 미잠금.
    // 안내 문구를 요구해 "침묵 은닉"을 red로 잡는다. toHaveTextContent는 이 리포에서
    // 문자열 인자를 정확 일치로 처리하므로(서브트리 두 텍스트 노드가 연결됨), 이 파일이
    // 이미 쓰는 정규식 부분매치 관용을 따른다(정규식=부분 매치).
    expect(screen.getByTestId('home-collections-empty')).toHaveTextContent(
      /아직 보여드릴 게 없어요/
    );
    expect(screen.getByTestId('home-spots-empty')).toHaveTextContent(
      /아직 보여드릴 게 없어요/
    );
    expect(screen.getByTestId('home-itineraries-empty')).toHaveTextContent(
      /아직 보여드릴 게 없어요/
    );

    // 부정 짝 — empty엔 실카드도 스켈레톤도 없다.
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
    expect(screen.queryByTestId('home-collections-skeleton')).toBeNull();
  });
});

describe('HomeScreen — loading 스켈레톤 (AC-5 · INV-4)', () => {
  it('섹션 3종은 스켈레톤을 그리고 고정 블록은 정상이며 실카드·빈 플레이스홀더는 없다', () => {
    render(<HomeScreen {...HOME_LOADING_PROPS} />);

    // 긍정 — 스켈레톤은 텍스트가 없어 testID가 유일한 관찰 수단이다.
    expect(screen.getByTestId('home-collections-skeleton')).toBeOnTheScreen();
    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
    expect(screen.getByTestId('home-itineraries-skeleton')).toBeOnTheScreen();

    // 긍정 — 이미 가용한 고정 블록은 로딩 중에도 정상 표시(가용 블록 우선).
    expect(screen.getByText('오늘은 어디를 상상해볼까요')).toBeOnTheScreen();
    expect(screen.getByTestId('home-search-bar')).toBeOnTheScreen();
    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('home-soft-note')).toBeOnTheScreen();
    expect(screen.getByTestId('home-create-trip-fab')).toBeOnTheScreen();

    // 부정 짝 — loading엔 실카드도 빈 플레이스홀더도 없다.
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
    expect(screen.queryByTestId('home-collections-empty')).toBeNull();
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

describe('HomeScreen — CTA no-op (AC-8 · Q3 계승)', () => {
  it('벨·검색바·더보기·카드·담은 곳·FAB를 눌러도 예외 없이 루트가 유지된다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    // 홈은 expo-router를 모르므로 이동 자체가 구조적으로 불가능하다 — 핸들러가 없으면
    // press는 no-op로 반환한다(예외 아님, 02a §4-6). 던지면 이 시점에 실패한다.
    fireEvent.press(screen.getByTestId('home-dashboard-bell'));
    fireEvent.press(screen.getByTestId('home-search-bar'));
    fireEvent.press(screen.getByTestId('home-collections-more'));
    fireEvent.press(screen.getByTestId('home-collection-card-0'));
    fireEvent.press(screen.getByTestId('home-saved-places-cta'));
    fireEvent.press(screen.getByTestId('home-create-trip-fab'));

    expect(screen.getByTestId('home-dashboard-root')).toBeOnTheScreen();
  });
});
