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
import type { HomePhase } from '../model/homeTypes';
import { HomeScreen } from './HomeScreen';

/**
 * AC-1~AC-8 — 홈 default 재정합(구 "여행 상태 대시보드" → 신 "발견·영감 피드",
 * 라이브 Figma 2091:1357). props(hero·sections)만 받아 그리는 순수 프레젠테이션 화면.
 *
 * 무엇을 보장하나: 인사·검색바·영감 hero·섹션 3종(요즘 담는 곳/뜨는 장소/여행자 일정)·
 * 온램프(softNote+FAB)가 한 화면에 존재하고(AC-1), 섹션 카드가 픽스처 실측값대로 렌더되며
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

const EXPECTED_ITINERARIES = [
  { title: '부산 미식 3일 코스', nights: '2박 3일' },
  { title: '해운대 오션뷰 힐링', nights: '2박 3일' },
  { title: '로컬 시장 & 카페', nights: '1박 2일' },
] as const;

// TRIP-370 — 배선 CTA(목적지 확정, 버튼 유지) vs 비배선 컨트롤(목적지 없음, 버튼 표식 제거).
// TRIP-453(entry 1) — 검색바가 목적지(/explore/search)를 얻어 배선 CTA 로 승격 → WIRED 로 이동
// (UNWIRED 에서 제거). 세 목록을 함께 손대야 한다(★2): WIRED(+search)·UNWIRED(−search)·
// PLANNING_WIRED(+search·+card). 하나라도 빠뜨리면 371-AC-3/4·AC-7 중 하나가 red 로 새어난다.
const WIRED_CTA_TEST_IDS = [
  'home-create-trip-fab',
  'home-saved-places-cta',
  'home-spots-more',
  'home-search-bar',
] as const;

const UNWIRED_CONTROL_TEST_IDS = [
  'home-collections-more',
  'home-itineraries-more',
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
    // 라벨 없는 원형 FAB(Figma 2105:1757) — 보이는 글자는 없고 접근성 이름만 남는다.
    // 텍스트를 지우면서 접근성 이름까지 같이 사라지는 것이 이 칸의 유일한 실패 경로다.
    expect(within(fab).queryByText('여행 만들기')).toBeNull();
    expect(fab).toHaveAccessibleName('여행 만들기');
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

    // 담은 곳 → 담은 장소 콜백만.
    onPressCreateTrip.mockClear();
    fireEvent.press(screen.getByTestId('home-saved-places-cta'));
    expect(onPressSavedPlaces).toHaveBeenCalledTimes(1);
    expect(onPressCreateTrip).not.toHaveBeenCalled();
    expect(onPressSpotsMore).not.toHaveBeenCalled();

    // 뜨는 장소 더 보기 → 스팟 더보기 콜백만.
    onPressSavedPlaces.mockClear();
    fireEvent.press(screen.getByTestId('home-spots-more'));
    expect(onPressSpotsMore).toHaveBeenCalledTimes(1);
    expect(onPressCreateTrip).not.toHaveBeenCalled();
    expect(onPressSavedPlaces).not.toHaveBeenCalled();
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
    fireEvent.press(screen.getByTestId('home-itineraries-more'));
    fireEvent.press(screen.getByTestId('home-collection-card-0'));

    expect(onPressCreateTrip).not.toHaveBeenCalled();
    expect(onPressSavedPlaces).not.toHaveBeenCalled();
    expect(onPressSpotsMore).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-dashboard-root')).toBeOnTheScreen();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-317 — 여행 단계 phase 얼굴 4종 (collecting·planning·upcoming·postTrip).
//
// 무엇을 보장하나: 316 discovery(위 8케이스, 무회귀) 위에 `phase` 판별값으로 4얼굴을
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
const COLLECTING_PHASE: HomePhase = {
  kind: 'collecting',
  greetTitle: '담아둔 곳이 3곳 모였어요',
  greetSubtitle: '마음에 든 곳들을 모아두고 있어요',
  sectionTitle: '내가 담은 곳',
  savedChipLabel: '담은 곳 3',
  collections: [
    {
      title: '감천문화마을',
      region: '부산 사하구',
      badge: '부산',
      savedAtLabel: '7월 30일 담음',
    },
    {
      title: '해운대 해변',
      region: '부산 해운대구',
      badge: '부산',
      savedAtLabel: '7월 28일 담음',
    },
  ],
};

const PLANNING_PHASE: HomePhase = {
  kind: 'planning',
  greetTitle: '부산 여행 D-21',
  trip: {
    badge: '계획 중',
    dday: 'D-21',
    ctaLabel: '일정 이어서 짜기',
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  bridge: {
    title: '담은 곳 3곳이 아직 일정에 없어요',
    subtitle: '남은 자리에 넣어볼까요',
    ctaLabel: '일정에 추가',
  },
};

const UPCOMING_PHASE: HomePhase = {
  kind: 'upcoming',
  greetName: '태현님',
  greetTitle: '부산 여행이 곧 시작돼요',
  trip: {
    badge: '출발 전',
    dday: 'D-3',
    ctaLabel: '오늘 일정 보기',
    title: '부산 여행',
    meta: '6월 10일 – 6월 13일 · 3박 4일 · 2명',
  },
  stats: [
    { label: '일정', value: '9곳 완성' },
    { label: '숙소', value: '3/3', caption: '3박 등록' },
  ],
  nextStop: {
    order: '1',
    time: '09:30 · 활동',
    title: '광안리 해변',
    placeMeta: '24시간 개방 · 숙소서 950m',
  },
  nearby: {
    title: '지금 내 주변 살펴보기',
    subtitle: '부산 해운대구 · 걸어서 갈 만한 곳',
  },
  pastTrips: [
    { title: '경주 여행 2026.04 · 2박' },
    { title: '강릉 여행 2026.02 · 1박' },
  ],
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

describe('HomeScreen — collecting 얼굴 (AC-1 · US-SHELL-05)', () => {
  it('저장개수 greet·"내가 담은 곳"·담은 곳 N 칩·지역 badge+저장일 카드를 그리고 softNote는 숨긴다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={COLLECTING_PHASE} />);

    // 긍정 — collecting 고유 요소.
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(
      /담아둔 곳이 3곳 모였어요/
    );
    expect(screen.getByText('내가 담은 곳')).toBeOnTheScreen();
    expect(screen.getByTestId('home-saved-count-chip')).toHaveTextContent(
      /담은 곳 3/
    );

    // ★4 badge 의미 전환 함정 — collecting 카드는 지역 badge(`부산`)+저장일이지 discovery
    // badge(`당일치기`)가 아니다. within(c0)로 스코프하고, `부산`은 exact라 region `부산 사하구`
    // 리프와 구분된다(02a ★2).
    const c0 = screen.getByTestId('home-collection-card-0');
    expect(within(c0).getByText('부산')).toBeOnTheScreen();
    expect(within(c0).getByText('7월 30일 담음')).toBeOnTheScreen();
    expect(within(c0).queryByText('당일치기')).toBeNull();

    // 부정 짝 — collecting은 softNote 숨김(§3-B).
    expect(screen.queryByTestId('home-soft-note')).toBeNull();

    // INV-3 — 소요시간 문맥 문자열 0.
    expect(screen.queryAllByText(DURATION_RENDER)).toHaveLength(0);
  });
});

describe('HomeScreen — planning 얼굴 (AC-2 · US-SHELL-02)', () => {
  it('tripHero "계획 중"·D-day·「일정 이어서 짜기」 CTA·브릿지행을 그리고 hero·grid는 숨긴다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    // greet(여행명+D-day).
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(
      /부산 여행 D-21/
    );

    // tripHero — 배지·D-day·CTA·메타.
    const hero = screen.getByTestId('home-trip-hero');
    expect(hero).toHaveTextContent(/부산 여행/);
    expect(screen.getByTestId('home-trip-hero-badge')).toHaveTextContent(
      '계획 중'
    );
    expect(screen.getByTestId('home-trip-hero-dday')).toHaveTextContent('D-21');
    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기'
    );
    // 메타는 리프가 쪼개질 수 있어 정규식 부분 매치(자손 텍스트 합침).
    expect(hero).toHaveTextContent(/3박 4일 · 2명/);

    // 브릿지행(softNote 슬롯 재사용) — 담은 곳이 일정에 없다는 잇기 카피 + "일정에 추가".
    const bridge = screen.getByTestId('home-soft-note');
    expect(
      within(bridge).getByText(/담은 곳 3곳이 아직 일정에 없어요/)
    ).toBeOnTheScreen();
    expect(within(bridge).getByText('일정에 추가')).toBeOnTheScreen();

    // 부정 짝 — planning은 magazineHero·"지금 뜨는 장소" grid 숨김(§3-B).
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();

    // INV-3.
    expect(screen.queryAllByText(DURATION_RENDER)).toHaveLength(0);
  });
});

describe('HomeScreen — upcoming 얼굴 (AC-3 · US-SHELL-02)', () => {
  it('이름 greet·tripHero 출발전·스탯타일 2·가장 먼저 갈 곳·지난 여행을 그리고 searchBar 등은 부재하며 소요시간은 0이다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={UPCOMING_PHASE} />);

    // greet — 유일하게 사용자 이름 사용(개인화).
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(/태현님/);

    // tripHero — 출발 전·D-3·오늘 일정 보기.
    expect(screen.getByTestId('home-trip-hero-badge')).toHaveTextContent(
      '출발 전'
    );
    expect(screen.getByTestId('home-trip-hero-dday')).toHaveTextContent('D-3');
    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '오늘 일정 보기'
    );

    // 스탯 타일 2 — 일정 진행률·등록 숙소(US-SHELL-02).
    expect(screen.getByTestId('home-dash-itinerary')).toHaveTextContent(
      /9곳 완성/
    );
    expect(screen.getByTestId('home-dash-stay')).toHaveTextContent(/3\/3/);

    // ★ INV-3 최상위 함정 — nextCard는 시각(09:30)·영업시간(24시간 개방)·거리(950m)를 그린다.
    // 이들은 전부 렌더되어야 하고(허용), 그럼에도 소요시간 정규식은 0을 반환해야 한다.
    const nextStop = screen.getByTestId('home-next-stop');
    expect(within(nextStop).getByText('광안리 해변')).toBeOnTheScreen();
    expect(nextStop).toHaveTextContent(/09:30/);
    expect(nextStop).toHaveTextContent(/24시간 개방/);
    expect(nextStop).toHaveTextContent(/950m/);

    expect(screen.getByTestId('home-nearby-card')).toHaveTextContent(
      /지금 내 주변/
    );

    // 지난 여행 2장.
    expect(screen.getByTestId('home-past-trip-card-0')).toBeOnTheScreen();
    expect(screen.getByTestId('home-past-trip-card-1')).toBeOnTheScreen();

    // 부정 짝 — upcoming만 searchBar 없음(브리프 §8-6). magazineHero·softNote·컬렉션/스팟도 부재.
    expect(screen.queryByTestId('home-search-bar')).toBeNull();
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
    expect(screen.queryByTestId('home-soft-note')).toBeNull();
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();

    // INV-3 — "24시간 개방"은 좁힌 정규식에서 제외되므로 정당 화면이 거짓 red 안 남.
    expect(screen.queryAllByText(DURATION_RENDER)).toHaveLength(0);
  });
});

describe('HomeScreen — postTrip 얼굴 (AC-4 · US-SHELL-02)', () => {
  it('"잘 다녀오셨어요" greet·회고 보기 카드·공유행·추천·지난 여행을 그리고 hero·grid는 숨긴다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={POST_TRIP_PHASE} />);

    expect(screen.getByTestId('home-greeting')).toHaveTextContent(
      /잘 다녀오셨어요/
    );

    // 회고 진입(핵심 AC-4) — 회고 카드 + 방문 수·거리·사진 수(12km 거리 OK, 소요시간 0).
    const recap = screen.getByTestId('home-recap-card');
    expect(within(recap).getByText('부산 여행 회고 보기')).toBeOnTheScreen();
    expect(recap).toHaveTextContent(/4곳 방문 · 12km · 사진 6장/);

    // 공유행(softNote 슬롯 재사용).
    const share = screen.getByTestId('home-soft-note');
    expect(within(share).getByText(/공유 카드로 남기기/)).toBeOnTheScreen();
    expect(within(share).getByText('공유 카드 만들기')).toBeOnTheScreen();

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

    // (2) 같은 화면에 phase=planning 주입 → tripHero로 스위치. discovery로 폴백하지 않는다.
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-401 — planning 얼굴의 버튼 역할 집합 + 브릿지 CTA de-button.
//
// 무엇을 보장하나: planning 얼굴에서 접근성 트리에 버튼으로 읽히는 것은 **배선된 CTA 뿐**이다
// (여행 카드 CTA `home-trip-hero-cta` + FAB). 목적지 없는 브릿지 CTA "일정에 추가"
// (`home-saved-places-cta`, 기능 이연 BR-U3-15)는 렌더는 되지만 버튼 역할이 아니다(죽은 버튼 금지).
//
// 왜 discovery 짝이 필요한가(02a §4-★4): 기존 370-AC-4(discovery 버튼 집합, 위)는 온램프
// `home-saved-places-cta` 가 **콜백 미주입 상태로도** 버튼일 것을 요구한다. 아래 planning 테스트는
// 같은 testID 의 브릿지가 non-button 일 것을 요구한다. 둘을 동시에 만족하는 유일한 형태는 role 을
// `onPressCta` 유무로 파생하지 않고 **명시 `asButton` prop** 으로 굳히는 것(discovery=true·
// planning=false). 두 테스트가 "콜백 유무 파생" 안티패턴을 협공한다.

// planning 얼굴에서 목적지가 있어 버튼이어야 하는 것(구조로 굳힘 — 콜백 미주입에도 버튼).
// TRIP-453 — entry 1 검색바(항해 /explore/search)·entry 3 여행 카드 본체(항해=알약과 동일)가
// planning 얼굴에서도 버튼으로 읽힌다. 카드 본체(home-trip-hero)와 알약(home-trip-hero-cta)은
// 중첩 Pressable 이라 둘 다 버튼 집합에 든다(★1·★3).
const PLANNING_WIRED_CTA_TEST_IDS = [
  'home-create-trip-fab',
  'home-trip-hero-cta',
  'home-search-bar',
  'home-trip-hero',
] as const;

describe('🔴 HomeScreen — planning 버튼 역할 집합 == 배선 CTA 집합 (AC-7 · 370-AC-4 확장)', () => {
  it('planning 접근성 트리에서 버튼으로 읽히는 것은 여행 카드 CTA·FAB 뿐이다', () => {
    // 콜백을 주입하지 않는다 — role 이 콜백 유무 파생이 아니라 구조여야 함을 강제한다(★4).
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID)
      .sort();

    // 집합 동치 — 브릿지 CTA 가 안 벗겨지거나(현행) 배선 CTA 가 벗겨지면 red.
    expect(buttonIds).toEqual([...PLANNING_WIRED_CTA_TEST_IDS].sort());
  });
});

describe('🔴 HomeScreen — planning 브릿지 CTA 죽은 버튼 금지 (AC-6)', () => {
  it('브릿지 "일정에 추가"는 렌더되지만 accessibilityRole="button"으로 노출되지 않는다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} phase={PLANNING_PHASE} />);

    // 긍정 — 브릿지 카드·라벨은 그대로 뜬다(카피를 지우는 게 아니라 버튼 역할만 뗀다).
    const bridge = screen.getByTestId('home-soft-note');
    expect(within(bridge).getByText('일정에 추가')).toBeOnTheScreen();
    expect(screen.getByTestId('home-saved-places-cta')).toBeOnTheScreen();

    // 부정 — 접근성 버튼 집합에 브릿지 CTA 는 없다(목적지 없는 죽은 버튼 제거).
    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID);
    expect(buttonIds).not.toContain('home-saved-places-cta');
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
