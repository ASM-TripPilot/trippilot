import { fireEvent, render, screen } from '@testing-library/react-native';

import MagazineRoute from '@/app/magazine';

/**
 * TRIP-700 a02 매거진 목록 라우트 + 컨테이너 배선. ⚠️ 라우트(`app/magazine.tsx`)·페이지
 * (`pages/magazine/ui/MagazinePage.tsx`)·화면이 아직 없어 **파일 부재로 크래시-red** 다(새 화면
 * 정상 red). implementer 가 3층을 채우면 green 으로 뒤집힌다.
 *
 * 무엇을 보장하나: 라우트를 통째로 렌더해(tabsHomeRoute 선례 — route→page→screen 실체인)
 *  - AC-8: `/magazine` 라우트가 화면을 그리고, 앱바 뒤로가기 press → `router.back()`(라우트가
 *    항법을 지고 화면은 넘겨받은 onBack 만 발화한다).
 *  - AC-2 라운드트립: 컨테이너 selectedChip useState 가 실제로 선택을 옮긴다 — 기본 '전체'(chip-0)
 *    선택에서 다른 칩을 누르면 그 칩으로 하이라이트가 이동하고 chip-0 은 해제된다. 순수 화면
 *    (MagazineScreen)만으론 "onSelectChip 발화"까지고, 선택이 **눈에 보이게 이동**하는지는
 *    컨테이너가 상태를 소유해야 성립하므로 여기서 라우트-실체인으로 잠근다(칩 필터=시각 전용, 01b Q4).
 *
 * 왜 라우트를 렌더하나: 화면은 라우터를 모르고(homeStructure D-1) 페이지는 배럴 없이 라우트가
 * 직참조하는 얇은 3층이라, 라우트 하나를 렌더하면 back 배선·컨테이너 상태를 한 번에 관측할 수
 * 있다(MagazinePage 의 정확한 prop shape 을 테스트가 가정하지 않아도 된다).
 */

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // 화살표 안에서 호출 시점에 읽어 hoist 함정 회피(tabsHomeRoute 선례).
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
});

describe('🔴 TRIP-700 AC-8 · /magazine 라우트 + 뒤로가기 → router.back()', () => {
  it('라우트가 매거진 화면을 그린다', () => {
    render(<MagazineRoute />);

    // 화면 실체 앵커 — 매서너리 카드 0 이 라우트를 통해 그려진다(페이지 위임이 실제로 붙었다).
    expect(screen.getByTestId('magazine-card-0')).toBeOnTheScreen();
    expect(screen.getByText('여행지 둘러보기')).toBeOnTheScreen();
  });

  it('앱바 뒤로가기 press → router.back() 만 정확히 1회(push 는 0회)', () => {
    render(<MagazineRoute />);

    fireEvent.press(screen.getByTestId('magazine-appbar-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled(); // 뒤로가기는 push 가 아니다
  });
});

describe('🔴 TRIP-700 AC-2 · 칩 선택 라운드트립(컨테이너 selectedChip 상태)', () => {
  it('기본 "전체"(chip-0) 선택에서 다른 칩을 누르면 선택이 그 칩으로 이동한다', () => {
    render(<MagazineRoute />);

    const isSelected = (i: number) =>
      String(screen.getByTestId(`magazine-chip-${i}`).props.className)
        .split(/\s+/)
        .includes('bg-ink');

    // 기본 — "전체"(chip-0)가 선택.
    expect(isSelected(0)).toBe(true);
    expect(isSelected(2)).toBe(false);

    // 실행 — "1박 2일"(chip-2) 을 누른다 → 컨테이너가 selectedChip 을 갱신해 재렌더.
    fireEvent.press(screen.getByTestId('magazine-chip-2'));

    // 선택이 chip-2 로 이동하고 chip-0 은 해제된다(onSelectChip 을 no-op 으로 배선한 구현은
    // 선택이 안 움직여 red — 순수 화면 테스트가 못 잡는 컨테이너 상태 소유를 여기서 잠근다).
    expect(isSelected(2)).toBe(true);
    expect(isSelected(0)).toBe(false);
  });
});
