import { fireEvent, render, screen } from '@testing-library/react-native';

import { MagazinePage } from './MagazinePage';
import { routerSpies } from '@/test-support/expoRouterMock';

/**
 * TRIP-700 a02 매거진 목록 페이지 컨테이너 배선(옛 `__tests__/magazineRoute.test` — 라우트 `app/magazine.tsx` 는 `<MagazinePage />`
 * 위임뿐이라 실체는 컨테이너 테스트였다. TRIP-1350 에서 이쪽으로 옮김).
 *
 * 무엇을 보장하나: 페이지를 통째로 렌더해(페이지→화면 실체인)
 *  - AC-8: 페이지가 화면을 그리고, 앱바 뒤로가기 press → `router.back()`(페이지가 항법을 지고 화면은 넘겨받은 onBack 만 발화한다).
 *  - AC-2 라운드트립: 컨테이너 selectedChip useState 가 실제로 선택을 옮긴다 — 기본 '전체'(chip-0) 선택에서 다른 칩을 누르면 그 칩으로
 *    하이라이트가 이동하고 chip-0 은 해제된다. 순수 화면(MagazineScreen)만으론 "onSelectChip 발화"까지고, 선택이 **눈에 보이게
 *    이동**하는지는 컨테이너가 상태를 소유해야 성립하므로 여기서 잠근다(칩 필터=시각 전용, 01b Q4).
 */

const { back: mockBack, push: mockPush } = routerSpies;
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'back'],
  })
);

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
});

describe('🔴 TRIP-700 AC-8 · 매거진 페이지 + 뒤로가기 → router.back()', () => {
  it('페이지가 매거진 화면을 그린다', () => {
    render(<MagazinePage />);

    // 화면 실체 앵커 — 매서너리 카드 0 이 페이지를 통해 그려진다.
    expect(screen.getByTestId('magazine-card-0')).toBeOnTheScreen();
    expect(screen.getByText('여행지 둘러보기')).toBeOnTheScreen();
  });

  it('앱바 뒤로가기 press → router.back() 만 정확히 1회(push 는 0회)', () => {
    render(<MagazinePage />);

    fireEvent.press(screen.getByTestId('magazine-appbar-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled(); // 뒤로가기는 push 가 아니다
  });
});

describe('🔴 TRIP-700 AC-2 · 칩 선택 라운드트립(컨테이너 selectedChip 상태)', () => {
  it('기본 "전체"(chip-0) 선택에서 다른 칩을 누르면 선택이 그 칩으로 이동한다', () => {
    render(<MagazinePage />);

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
