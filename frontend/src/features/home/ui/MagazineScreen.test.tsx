import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { MagazineScreenProps } from '../model/magazineTypes';
import { MagazineScreen } from './MagazineScreen';

/**
 * TRIP-700 a02 "여행지 둘러보기" 매거진 목록 화면 — props(칩·에디토리얼·카드)만 받아 그리는
 * 순수 프레젠테이션 화면(라이브 Figma 2091:1940). ⚠️ 이 슬라이스엔 아직 MagazineScreen.tsx 가
 * 없어 **파일 부재로 크래시-red** 다(새 화면 정상 red, 02a §판정). implementer 가 화면을 만들면
 * 아래 단언이 red→green 으로 뒤집힌다.
 *
 * 무엇을 보장하나(구조 가드 — 픽셀·폰트·스크림·매서너리 높이·칩 잘림은 6-b 육안 전용):
 *  - AC-1 존재: 앱바(뒤로가기·"여행지 둘러보기"·돋보기)·인트로 2줄·필터 칩 5·에디토리얼 카드
 *    (알약·타이틀·서브·칩2)·gridHead("테마로 골라보기"+"전체")·매서너리 카드 6장이 한 화면에.
 *  - AC-2 칩: 정확히 1개만 bg-ink 선택(0/2 선택은 red)이고 selected 를 따라 이동하며,
 *    칩 press 는 onSelectChip 을 누른 칩 값으로 발화한다.
 *  - AC-3 카드: 매서너리 카드가 정확히 6장(7번째 없음), 각 카드에 타이틀·태그·하트가 있고
 *    카드 press 는 onPressCard 를 누른 카드로 발화한다.
 *  - AC-4 INV-3: 화면 어디에도 소요시간 문자열(분·시간·소요)이 렌더되지 않는다(거리·해시태그만).
 *  - 앱바 뒤로가기·돋보기 press → onBack·onSearch 발화. FAB 2종은 시각 전용(role 없음).
 *
 * 텍스트 중복 함정(02a §4-F1) — 같은 문자열이 여러 존에 산다: "전체"(칩0 + gridHead 전체보기),
 * "당일치기"(칩1 + 에디토리얼 칩). 그래서 모든 존별 단언은 `within(...)`로 서브트리를 좁혀
 * 전역 다중매치 throw 를 피한다(HomeScreen.test 파일 관례 계승).
 *
 * 매처 의미(02a §5) — `within(x).getByText('문자열')`은 기본 exact=true 라 리프 텍스트 완전일치.
 * `getAllByTestId(/^…$/)`는 ^$ 앵커 정규식 test() 라 접두 오탐 없음. className 은 jest 렌더
 * 트리에 평문 `props.className` 문자열로 남아 토큰 관측 가능(HomeScreen.test L179·L451 실측).
 */

// 브리프 §화면·IO(Figma 2091:1940 실측) 그대로의 테스트 픽스처 — implementer 의
// magazineFixtures.ts(MAGAZINE_DEFAULT_PROPS)가 이 값들을 그려야 green 이 된다. 픽스처를 import
// 하지 않고 로컬로 두는 이유: magazineFixtures.ts 는 implementer 산출물이라 아직 없고, 미존재
// import 는 파일 로드를 흔든다(HomeScreen.test ★D1 선례). imageUrl 은 null(사진 자리 토큰 tint).
const CHIPS = ['전체', '당일치기', '1박 2일', '2박 3일', '한 달 살기'] as const;

const EDITORIAL = {
  eyebrow: '이 주의 여행 이야기',
  title: '골목마다 색이 다른 마을',
  subtitle: '감천문화마을에서 반나절, 사진만 담아도 하루가 채워져요',
  chips: ['당일치기', '포토 명소'],
  imageUrl: null,
} as const;

// 좌열(200/250/180) → 우열(260/190/220) 순으로 6장. card-i = cards[i](배열 인덱스 = testID 번호).
const CARDS = [
  { title: '전포 카페 투어', tag: '#감성카페', height: 200, imageUrl: null },
  { title: '해운대 오션뷰', tag: '#바다멍', height: 250, imageUrl: null },
  { title: '자갈치 먹방', tag: '#로컬푸드', height: 180, imageUrl: null },
  { title: '부산 야경 명소', tag: '#야경', height: 260, imageUrl: null },
  { title: '바다 위 사찰', tag: '#힐링', height: 190, imageUrl: null },
  { title: '광안리 산책', tag: '#노을', height: 220, imageUrl: null },
] as const;

const MAGAZINE_PROPS: MagazineScreenProps = {
  chips: CHIPS,
  selected: '전체',
  editorial: EDITORIAL,
  cards: CARDS,
};

/** 칩 컨테이너(magazine-chip-N)의 className 토큰에 'bg-ink'가 있는 칩 수(= 선택 상태 개수). */
function selectedChipCount(): number {
  return screen
    .getAllByTestId(/^magazine-chip-\d+$/)
    .filter((node) =>
      String(node.props.className).split(/\s+/).includes('bg-ink')
    ).length;
}

describe('🔴 MagazineScreen — 정상 렌더 존재 (TRIP-700 AC-1)', () => {
  it('앱바·인트로 2줄·칩 5·에디토리얼 카드·gridHead·매서너리 6장이 한 화면에 존재한다', () => {
    render(<MagazineScreen {...MAGAZINE_PROPS} />);

    // 앱바 — 뒤로가기·타이틀·돋보기. 타이틀은 유일 문자열이라 전역 getByText.
    expect(screen.getByTestId('magazine-appbar-back')).toBeOnTheScreen();
    expect(screen.getByText('여행지 둘러보기')).toBeOnTheScreen();
    expect(screen.getByTestId('magazine-appbar-search')).toBeOnTheScreen();

    // 인트로 2줄 — 유일 문자열.
    expect(screen.getByText('책장 넘기듯, 여행을 상상해요')).toBeOnTheScreen();
    expect(
      screen.getByText('가고 싶은 곳을 눈으로 먼저 다녀오세요')
    ).toBeOnTheScreen();

    // 필터 칩 5 — 라벨이 다른 존과 겹치므로(전체·당일치기) 각 칩 서브트리로 좁혀 확인.
    CHIPS.forEach((label, i) => {
      const chip = screen.getByTestId(`magazine-chip-${i}`);
      expect(within(chip).getByText(label)).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('magazine-chip-5')).toBeNull();

    // 에디토리얼 카드 — 알약·타이틀·서브·칩2 를 카드 서브트리로 좁혀(칩 "당일치기" 중복 회피).
    const editorial = screen.getByTestId('magazine-editorial');
    expect(
      within(editorial).getByText('이 주의 여행 이야기')
    ).toBeOnTheScreen();
    expect(
      within(editorial).getByText('골목마다 색이 다른 마을')
    ).toBeOnTheScreen();
    expect(
      within(editorial).getByText(
        '감천문화마을에서 반나절, 사진만 담아도 하루가 채워져요'
      )
    ).toBeOnTheScreen();
    expect(within(editorial).getByText('당일치기')).toBeOnTheScreen();
    expect(within(editorial).getByText('포토 명소')).toBeOnTheScreen();

    // gridHead — "테마로 골라보기" + 전체보기 "전체"(칩 "전체"와 중복이라 gridHead 서브트리로).
    const gridHead = screen.getByTestId('magazine-grid-head');
    expect(within(gridHead).getByText('테마로 골라보기')).toBeOnTheScreen();
    expect(within(gridHead).getByText('전체')).toBeOnTheScreen();

    // 매서너리 카드 6장 존재(내용·개수는 AC-3 이 잠근다).
    [0, 1, 2, 3, 4, 5].forEach((i) => {
      expect(screen.getByTestId(`magazine-card-${i}`)).toBeOnTheScreen();
    });
  });
});

describe('🔴 MagazineScreen — 칩 정확히 1 선택 + onSelectChip (TRIP-700 AC-2)', () => {
  it('정확히 1개 칩만 bg-ink 선택이고 selected 를 따라 이동한다(0/2 선택은 red)', () => {
    // selected='전체'(chip-0). ★ 부정 장치 — bg-ink 칩 수가 정확히 1: 아무 칩도 하이라이트하지
    // 않으면(0) 또는 selected 외 칩까지 물들이면(2) red. 단일 단언이 양극을 잡는다.
    const view = render(<MagazineScreen {...MAGAZINE_PROPS} />);
    expect(selectedChipCount()).toBe(1);
    expect(
      String(screen.getByTestId('magazine-chip-0').props.className).split(/\s+/)
    ).toContain('bg-ink');

    // selected 이동 — '1박 2일'(chip-2)로 바꾸면 선택이 chip-2 로 옮겨가고 chip-0 은 해제된다
    // (선택을 chip-0 에 하드코딩한 구현을 red 로 잡는다). 여전히 정확히 1개만 선택.
    view.rerender(<MagazineScreen {...MAGAZINE_PROPS} selected="1박 2일" />);
    expect(selectedChipCount()).toBe(1);
    expect(
      String(screen.getByTestId('magazine-chip-2').props.className).split(/\s+/)
    ).toContain('bg-ink');
    expect(
      String(screen.getByTestId('magazine-chip-0').props.className).split(/\s+/)
    ).not.toContain('bg-ink');
  });

  it('칩 press 는 onSelectChip 을 누른 칩 라벨로 정확히 1회 발화한다', () => {
    const onSelectChip = jest.fn();
    render(<MagazineScreen {...MAGAZINE_PROPS} onSelectChip={onSelectChip} />);

    fireEvent.press(screen.getByTestId('magazine-chip-1')); // 당일치기
    expect(onSelectChip).toHaveBeenCalledTimes(1);
    expect(onSelectChip).toHaveBeenCalledWith('당일치기');
  });
});

describe('🔴 MagazineScreen — 매서너리 카드 6장 + onPressCard (TRIP-700 AC-3)', () => {
  it('카드가 정확히 6장이고 각 카드에 타이틀·태그·하트가 있으며 7번째는 없다', () => {
    render(<MagazineScreen {...MAGAZINE_PROPS} />);

    // 정확히 6 — ^$ 앵커 정규식이라 magazine-heart-N 같은 형제 testID 는 안 걸린다(02a §5).
    expect(screen.getAllByTestId(/^magazine-card-\d+$/)).toHaveLength(6);
    expect(screen.queryByTestId('magazine-card-6')).toBeNull();

    // card-i = cards[i] — 각 카드 서브트리로 좁혀 타이틀·태그 완전일치 + 하트 존재.
    CARDS.forEach((card, i) => {
      const node = screen.getByTestId(`magazine-card-${i}`);
      expect(within(node).getByText(card.title)).toBeOnTheScreen();
      expect(within(node).getByText(card.tag)).toBeOnTheScreen();
      expect(screen.getByTestId(`magazine-heart-${i}`)).toBeOnTheScreen();
    });
  });

  it('카드 press 는 onPressCard 를 누른 카드로 정확히 1회 발화한다', () => {
    const onPressCard = jest.fn();
    render(<MagazineScreen {...MAGAZINE_PROPS} onPressCard={onPressCard} />);

    fireEvent.press(screen.getByTestId('magazine-card-0'));
    expect(onPressCard).toHaveBeenCalledTimes(1);
    expect(onPressCard).toHaveBeenCalledWith(CARDS[0]);
  });
});

describe('🔴 MagazineScreen — INV-3 시간 미표시 (TRIP-700 AC-4)', () => {
  it('화면 어디에도 소요시간 문자열(분·시간·소요)이 렌더되지 않는다', () => {
    render(<MagazineScreen {...MAGAZINE_PROPS} />);

    // 필터 칩·해시태그·카피만 쓴다 — 거리도 소요시간도 없다. 정규식 부분매치라 리프 어디에 있어도
    // 잡히고, queryAllByText 는 다중매치라도 [] 반환(throw 안 함). 소스 절반은 homeStructure D-2 가
    // features/home 재귀 스캔으로 자동 편입해 잠근다(이 렌더 단언과 이중).
    expect(screen.queryAllByText(/소요|\d+\s*분|\d+\s*시간/)).toHaveLength(0);
  });
});

describe('🔴 MagazineScreen — 앱바 뒤로가기·돋보기 배선 (TRIP-700 AC-1·8 화면측)', () => {
  it('뒤로가기 press → onBack, 돋보기 press → onSearch 만 각각 1회 발화한다', () => {
    const onBack = jest.fn();
    const onSearch = jest.fn();
    render(
      <MagazineScreen {...MAGAZINE_PROPS} onBack={onBack} onSearch={onSearch} />
    );

    fireEvent.press(screen.getByTestId('magazine-appbar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('magazine-appbar-search'));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1); // 재발화 없음
  });
});

describe('🔴 MagazineScreen — FAB 2종은 시각 전용(role 없음) (TRIP-700 · 01b Q2)', () => {
  it('+ FAB·하트 FAB 는 화면에 그려지지만 접근성 트리에서 버튼이 아니다(죽은 버튼 회피)', () => {
    render(<MagazineScreen {...MAGAZINE_PROPS} />);

    // 시각으로는 존재한다(Figma 정합).
    expect(screen.getByTestId('magazine-fab-create')).toBeOnTheScreen();
    expect(screen.getByTestId('magazine-fab-saved')).toBeOnTheScreen();

    // queryAllByRole('button')은 accessibilityRole='button' 요소만 돌려준다(HomeScreen.test §5
    // 실검증). 항해 컨트롤(뒤로가기)은 버튼이라 집합이 비지 않는 앵커가 되고(비공허), FAB 2종은
    // role 이 없어 그 집합에 들면 안 된다.
    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID);
    expect(buttonIds).toContain('magazine-appbar-back');
    expect(buttonIds).not.toContain('magazine-fab-create');
    expect(buttonIds).not.toContain('magazine-fab-saved');
  });
});
