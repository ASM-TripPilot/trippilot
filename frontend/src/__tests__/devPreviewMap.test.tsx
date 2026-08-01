import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * dev 프리뷰 지도 1키(D9) — 층 C(C-1·C-2) 실기 검증 진입점의 층 A 심판.
 *
 * U2(오케 확정, 02a §7) — `_dev/preview.tsx`에 지도 상태 키가 없으면 층 C(C-1 타일 렌더 ·
 * C-2 실패유발)를 판정할 진입점 자체가 무심판으로 남는다. 상태 키는 `map-default` 1개뿐
 * 이다 — 키는 빌드 시 번들에 인라인되므로 preview가 런타임에 값을 비울 수 없다
 * (`map-no-key` 류는 만들 수 없다, 02a §7-U2). C-2는 `.env`를 실제로 비우고 재기동하는
 * 방식(01b C-2)이라 여기서 두 번째 키로 흉내 낼 이유가 없다.
 *
 * 동결된 `devPreview.test.tsx`·`devPreviewDeepLink.test.tsx`·`devPreviewHome.test.tsx`·
 * `devPreviewPref.test.tsx`는 한 글자도 고치지 않는다 — 지도 상태 검증은 `devPreviewHome
 * .test.tsx`(SC-6) 구조를 그대로 따라 새 파일로 추가한다.
 *
 * 지뢰 `@/shared/api`: 프리뷰는 프레젠테이션 전용이라 네트워크 계층을 절대 로드하면 안
 * 된다 — 동결 devPreview 계열과 같은 지뢰를 지도 경유로 계승한다.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// @gorhom/bottom-sheet은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다
// (수동 목: __mocks__/@gorhom/bottom-sheet.tsx — 동결 devPreview.test와 같은 장치).
jest.mock('@gorhom/bottom-sheet');

// react-native-webview도 같은 이유로 통과 컴포넌트로 목킹한다(__mocks__/react-native-webview.tsx,
// M1 실측: 이 호출이 없어도 자동 적용되지만 리포 관례대로 명시한다).
jest.mock('react-native-webview');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '지도 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('dev 프리뷰 지도 1키 — 딥링크 초기 조준 (D9 · U2)', () => {
  it('state=map-default로 열면 지도 루트(map-root)가 초기 렌더된다', () => {
    mockSearchParams.state = 'map-default';

    render(<DevPreview />);

    // map-root는 성공·실패 양쪽에서 항상 렌더된다(§2 계약) — 층 A는 진입점이 지도
    // 컴포넌트를 실제로 그린다는 사실까지만 심판하고, 타일이 뜨는지는 층 C 몫이다.
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
  });
});
