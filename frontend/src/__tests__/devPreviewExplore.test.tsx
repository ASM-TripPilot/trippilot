import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * dev 프리뷰 탐색 2키(d04 · d02) — 이 브랜치(TRIP-219~223)가 만든 두 화면의 **results 얼굴**
 * 진입점 심판.
 *
 * 왜 필요한가: 딥링크로 실화면에 들어가면 d04 는 백엔드 401 이라 항상 `error`, d02 는 세션이
 * 없어 항상 게스트 안내로 떨어진다 — **2열 카드·태그 칩·순번 목록·하트를 볼 방법이 없다.**
 * 프리뷰는 props 만 받는 프레젠테이션에 픽스처를 직접 넣어 그 얼굴을 그린다.
 *
 * 루트 렌더만 단언하면 **빈 목록도 통과한다** — 픽스처가 실제로 카드를 만들어야 이 진입점이
 * 값을 내므로 항목 렌더까지 잠근다.
 *
 * 동결된 `devPreview.test.tsx`·`devPreviewDeepLink.test.tsx`·`devPreviewHome.test.tsx`·
 * `devPreviewPref.test.tsx`·`devPreviewMap.test.tsx` 는 한 글자도 고치지 않는다 —
 * `devPreviewMap.test.tsx` 구조를 그대로 따라 새 파일로 추가한다.
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
    '탐색 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('dev 프리뷰 탐색 2키 — results 얼굴 진입점', () => {
  it('state=places-results 로 열면 d04 루트와 카드가 그려진다', () => {
    mockSearchParams.state = 'places-results';

    render(<DevPreview />);

    expect(screen.getByTestId('explore-places-root')).toBeOnTheScreen();
    // 카드가 0장이면 이 진입점은 아무것도 못 보여준다 — 빈 목록 통과를 막는다.
    expect(
      screen.getAllByTestId(/^explore-places-card-/).length
    ).toBeGreaterThan(0);
  });

  it('state=saved-places-results 로 열면 d02 루트와 순번 항목이 그려진다', () => {
    mockSearchParams.state = 'saved-places-results';

    render(<DevPreview />);

    expect(screen.getByTestId('explore-saved-root')).toBeOnTheScreen();
    expect(
      screen.getAllByTestId(/^explore-saved-item-/).length
    ).toBeGreaterThan(0);
  });

  it('state=saved-places-empty 로 열면 d02 빈 얼굴(삽화·CTA)이 그려지고 순번 항목은 없다', () => {
    // TRIP-649 — 빈 상태 진입점. state={kind:'empty'} 를 주입해 얼굴이 results 로 새지 않는지도 함께 잠근다.
    mockSearchParams.state = 'saved-places-empty';

    render(<DevPreview />);

    // 긍정 — 빈 얼굴 블록이 떠야 한다(results/게스트로 새면 이 testID 가 없어 throw → red).
    expect(screen.getByTestId('explore-saved-empty')).toBeOnTheScreen();
    // 부정 짝 — 항목이 0장이어야 empty 얼굴이 맞다(빈 배열인데 results 로 접히지 않았음).
    expect(screen.queryAllByTestId(/^explore-saved-item-/)).toHaveLength(0);
  });
});
