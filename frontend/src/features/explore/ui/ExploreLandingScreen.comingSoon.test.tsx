import { render, screen, within } from '@testing-library/react-native';

import { ExploreLandingScreen } from './ExploreLandingScreen';

/**
 * TRIP-419 — 탐색 랜딩 axisSeg 비-전체 3탭(숙소·장소·여행자 일정)의 "준비 중" 정직한 표기.
 *
 * 무엇을 보장하나(AC-419-1·2): 아직 동작하지 않는 세 축 탭이 눌리기 전에 "준비 중"임을 알아볼
 * 수 있게, ① 라벨과 별도의 "준비 중" Text 노드를 자기 자리에 갖고(색이 아닌 텍스트 신호),
 * ② 비활성으로 낭독된다(`toBeDisabled`, 색이 아닌 접근성 신호). 활성 '전체' 탭은 현행 유지다.
 *
 * 왜 화면을 직접 렌더하나(02a §0): 준비중 표기는 axisSeg(화면 내부 렌더)의 성질이고, 세그먼트는
 * 데이터에 무의존이라 라우트 렌더(세 훅 목·QueryClient)의 기계가 필요 없다. 세그먼트 동결 심판
 * AC-E7(4탭 present·전체만 selected·비활성 press→무동작)은 `tabsExploreRoute.test.tsx`가 그대로
 * 잠그며(AC-419-3 무회귀), 이 파일은 그 파일을 한 글자도 건드리지 않는다.
 *
 * 새 문법 메모(학습자):
 *  - `render(<Screen .../>)`: 화면을 가상 트리에 그린다. `screen`으로 그 결과를 조회한다.
 *  - `within(node)`: 조회 범위를 그 노드의 자손으로 좁힌다. 세 탭이 모두 "준비 중"이라 전역
 *    `getByText`는 다중 매칭으로 throw → 반드시 탭 안으로 좁혀야 한다.
 *  - `getByText('준비 중')`: 노드의 전체 텍스트가 정확히 '준비 중'인 Text를 찾는다(부분 아님).
 *    라벨('숙소' 등)과 별도 Text 노드여야 통과한다.
 *  - `queryByText(...)`: 없으면 throw가 아니라 null을 준다 — "없어야 한다" 부정 짝 전용.
 *  - `toBeDisabled()`: 요소의 `disabled` prop 또는 `accessibilityState.disabled`가 true면 통과
 *    (node_modules 실측, 02a §5-1).
 */

// 최소 props — axisSeg는 데이터 무의존이라 레인은 빈 배열/스텁으로 둔다.
function renderScreen() {
  return render(
    <ExploreLandingScreen
      heading={{ title: '탐색', subtitle: '어디로 갈까요' }}
      onPressSearch={() => {}}
      stayLane={{
        error: false,
        cards: [],
        onRetry: () => {},
        onSeeAll: () => {},
      }}
      placeLane={{
        error: false,
        cards: [],
        onRetry: () => {},
        onSeeAll: () => {},
      }}
      bridge={{ savedCount: 0, onPressCreateTrip: () => {} }}
    />
  );
}

const COMING_SOON_AXES = ['stay', 'place', 'itin'] as const;

describe('🔴 AC-419-1 — 비-전체 3탭이 자기 자리에 "준비 중" 표기를 갖는다', () => {
  it.each(COMING_SOON_AXES)(
    'explore-axis-%s 안에 "준비 중" Text가 있다 (라벨과 별도 노드)',
    (axis) => {
      renderScreen();

      const tab = screen.getByTestId(`explore-axis-${axis}`);
      // within(tab) 스코프 필수 — 세 탭이 모두 "준비 중"이라 전역 getByText는 다중 매칭 throw.
      expect(within(tab).getByText('준비 중')).toBeOnTheScreen();
    }
  );

  it('활성 "전체" 탭에는 "준비 중" 표기가 없다 (표기가 3탭에만, 부정 짝)', () => {
    renderScreen();

    const allTab = screen.getByTestId('explore-axis-all');
    // 전탭에 캡션을 다는 게으른 구현을 차단한다. itin 레인의 "…준비 중이에요"는
    // explore-lane-itin 소속이라 이 스코프(explore-axis-all) 밖이고, 완전일치도 아니다.
    expect(within(allTab).queryByText('준비 중')).toBeNull();
  });
});

describe('🔴 AC-419-2 — 비-전체 3탭이 비활성으로 낭독된다 (색 아닌 신호)', () => {
  it.each(COMING_SOON_AXES)('explore-axis-%s이 toBeDisabled이다', (axis) => {
    renderScreen();

    expect(screen.getByTestId(`explore-axis-${axis}`)).toBeDisabled();
  });

  it('활성 "전체" 탭은 비활성이 아니다 (부정 짝 — 전탭 disabled 오구현 차단)', () => {
    renderScreen();

    expect(screen.getByTestId('explore-axis-all')).not.toBeDisabled();
  });
});
