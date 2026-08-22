import { render } from '@testing-library/react-native';

import PlaceDetailRoute from '@/app/explore/places/[poiId]';

/**
 * TRIP-456 · 장소 상세 라우트 `explore/places/[poiId]` — d06 위임(스텁 재작성).
 *
 * 무엇을 보장하나: 라우트가 `useLocalSearchParams` 로 받은 poiId 를 **그대로 `PlaceDetailPage` 에
 * 넘기는 얇은 위임**이다. 조회·마크업·뒤로가기 판정은 라우트가 직접 지지 않는다(페이지 몫).
 *
 * ★ 이 파일은 TRIP-446 스텁 동결 테스트의 **재작성**이다(삭제 아님, 02a ★7). 스텁이 잠그던
 *   `place-detail-stub-{root,back,poi}` testID 는 d06 실화면으로 교체되며 사라지고, 뒤로가기
 *   canGoBack 폴백은 **PlaceDetailPage 로 계승**돼 `PlaceDetailPage.integration.test.tsx`(D6)가
 *   잠근다. 여기서는 위임만 잰다 — 게이트① 프리즈 해시는 이 파일 변경을 잡으므로 의도적 교체임을
 *   명시한다.
 *
 * ★ `@/pages/place-detail` 을 스파이 컴포넌트로 치환한다 — 실 페이지를 렌더하면 react-query 훅이
 *   `QueryClientProvider` 부재로 던진다. 라우트가 실훅을 물지 않는다는 것(위임)이 이 목으로
 *   증명된다(스텁의 "INV-1 무조회 프록시" 취지 계승).
 */

// `mock` 접두 변수만 jest.mock 팩토리가 참조할 수 있다(hoist 규칙). 위임된 페이지가 받은
// poiId 를 이 캡처 객체에 담고, 컴포넌트는 null 을 그려 트리를 오염시키지 않는다.
const mockCaptured: { poiId?: string; rendered: boolean } = { rendered: false };
// 위임된 페이지를 스파이 컴포넌트로 치환 — 실 페이지가 부를 react-query 훅을 차단한다(위임만 관찰).
// ⚠️ 구현 전에는 `@/pages/place-detail` 모듈이 없어 jest.mock 이 경로를 해석하지 못해 이 suite 는
// **모듈 미해석 red** 다(PlaceDetailPage.integration 과 같은 신규-모듈 red). 구현이 배럴을 만들면
// 이 목이 실모듈을 덮어 아래 단언이 살아난다.
jest.mock('@/pages/place-detail', () => ({
  PlaceDetailPage: (props: { poiId?: string }) => {
    mockCaptured.poiId = props.poiId;
    mockCaptured.rendered = true;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ poiId: 'NAVER:p1' }),
}));

beforeEach(() => {
  mockCaptured.poiId = undefined;
  mockCaptured.rendered = false;
});

describe('장소 상세 라우트 — PlaceDetailPage 위임', () => {
  it('useLocalSearchParams 의 poiId 를 그대로 PlaceDetailPage 에 넘긴다', () => {
    // 준비·실행 — QueryClientProvider 없이 라우트만 렌더한다(위임이므로 실훅을 안 문다).
    render(<PlaceDetailRoute />);

    // 단언 — 위임된 페이지가 받은 poiId 가 그대로 넘어간다.
    expect(mockCaptured.rendered).toBe(true);
    expect(mockCaptured.poiId).toBe('NAVER:p1');
  });

  it('라우트 렌더 자체가 던지지 않는다 — 조회를 직접 하지 않는 얇은 위임이다', () => {
    expect(() => render(<PlaceDetailRoute />)).not.toThrow();
  });
});
