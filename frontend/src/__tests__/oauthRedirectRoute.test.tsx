import { render, screen, waitFor } from '@testing-library/react-native';

import OAuthRedirectRoute from '@routes/oauth/[provider]';
import { routerSpies } from '@/test-support/expoRouterMock';

/**
 * TRIP-1649 · AC-W3-8~10 의 배선 — 라우트 파일 `app/oauth/[provider].tsx` 가 중계 화면(`OAuthRedirectPage`)을 그린다.
 *
 * 무엇을 보장하나: 소셜 로그인 팝업이 돌아오는 주소 `/oauth/{provider}` 가 빈 화면·not-found 가 아니라 중계 화면을 띄운다.
 *   (이 라우트는 `provider` 값을 읽지 않는다 — 네이버 W4 도 같은 라우트가 받는다.)
 * 화면의 동작(`maybeCompleteAuthSession` 호출·`/` 이동)은 `OAuthRedirectPage.test.tsx` 가 잰다. 여기서는 네이티브(기본 Platform)본이
 * 이동만 하므로 expo-web-browser 목이 필요 없다. 라우트가 `Stack.Protected` 밖인지는 AC 가 아니라 안 본다.
 * (개념) pages 층 테스트는 `@routes/…` 를 import 할 수 없다(eslint 층 규칙) — 라우트 테스트가 `src/__tests__` 에 모이는 이유.
 * 3동작: 준비(expo-router 목) → 실행(라우트 렌더) → 단언(중계 화면 testID).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['replace'],
    router: ['replace'],
    params: () => ({ provider: 'google' }),
  })
);

afterEach(() => {
  routerSpies.replace.mockClear();
});

describe('app/oauth/[provider] 라우트', () => {
  it('중계 화면을 그린다', async () => {
    render(<OAuthRedirectRoute />);

    expect(screen.getByTestId('oauth-redirect-page')).toBeTruthy();
    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalled());
  });
});
