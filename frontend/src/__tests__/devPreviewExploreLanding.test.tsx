import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * dev 프리뷰 d01 탐색 랜딩 3키(TRIP-418) — `explore-landing-{default,empty-bridge,stay-error}`
 * 가 **장소 레인이 붙은 뒤에도** placeLane prop 을 받아 크래시 없이 렌더되는지의 진입점 심판.
 *
 * 왜 필요한가: placeLane 을 화면 필수 prop 으로 두면(Seed Q4) 프리뷰 3키가 그 prop 을 함께
 * 채워야 tsc·렌더가 안 깨진다. 루트만 단언하면 빈 placeLane 도 통과하므로, default 키에서는
 * 장소 카드가 실제로 그려지는지까지 잠근다(빈 목록 통과 방지, `devPreviewExplore.test.tsx` 규율 계승).
 *
 * `devPreviewExplore.test.tsx`(d04·d02) 구조를 그대로 따라 새 파일로 추가한다 — 동결된
 * `devPreview.test.tsx`·`devPreviewExplore.test.tsx` 등 기존 프리뷰 테스트는 한 글자도 안 고친다.
 * 프리뷰는 딥링크 state 하나로 얼굴을 고르므로 `useLocalSearchParams` 를 목으로 갈아끼운다.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

jest.mock('@gorhom/bottom-sheet');
jest.mock('react-native-webview');

// 지뢰 — 프리뷰가 네트워크 계층을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '탐색 랜딩 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

const LANDING_KEYS = [
  'explore-landing-default',
  'explore-landing-empty-bridge',
  'explore-landing-stay-error',
] as const;

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('dev 프리뷰 d01 탐색 랜딩 3키 — 장소 레인 무회귀', () => {
  it.each(LANDING_KEYS)(
    'state=%s 로 열면 랜딩 루트와 장소 레인이 그려진다',
    (key) => {
      mockSearchParams.state = key;

      render(<DevPreview />);

      expect(screen.getByTestId('explore-landing')).toBeOnTheScreen();
      // 3얼굴 모두 장소 레인을 그린다 — stay-error 키에서도 장소 레인은 살아 있다(숙소만 error).
      expect(screen.getByTestId('explore-lane-place')).toBeOnTheScreen();
    }
  );

  it('default 키는 placeLane 을 빈 배열이 아니라 실제 카드로 채운다', () => {
    mockSearchParams.state = 'explore-landing-default';

    render(<DevPreview />);

    // 카드가 0장이면 이 진입점은 장소 레인을 눈으로 확인할 수 없다 — 빈 목록 통과를 막는다.
    expect(
      screen.getAllByTestId(/^explore-place-card-/).length
    ).toBeGreaterThan(0);
  });
});
