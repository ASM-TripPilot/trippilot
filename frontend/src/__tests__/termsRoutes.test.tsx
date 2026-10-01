import { render, screen } from '@testing-library/react-native';

import TermsViewerRoute from '@/app/terms/[termsType]';
import ReconsentRoute from '@/app/reconsent';

/**
 * TRIP-937 · 약관 열람 라우트 `terms/[termsType]` · 재동의 라우트 `reconsent` — 얇은 위임.
 *
 * 무엇을 보장하나:
 *  - AC-2(라우트): 열람 라우트가 `useLocalSearchParams` 의 termsType 을 **그대로** `TermsViewerPage` 에
 *    prop 으로 넘긴다. 조회·마크업은 페이지 몫이다(`records/index.tsx`·`explore/places/[poiId]` 선례).
 *    이 라우트는 어느 `Stack.Protected` 에도 속하지 않아 온보딩·설정·재동의 세 문 모두에서 push 로 열린다.
 *  - AC-5(라우트): 재동의 라우트가 더는 "약관 재동의 (후속)" 한 줄이 아니라 `ReconsentPage` 를 그린다 —
 *    부트스트랩이 RECONSENT 로 보낸 사용자가 갇히지 않는 출발점이다.
 *
 * (개념) 동적 세그먼트 `[termsType]` — 파일 이름의 대괄호는 URL 한 칸을 변수로 받는다.
 *  `/terms/PRIVACY_POLICY` 로 열면 `useLocalSearchParams()` 가 `{ termsType: 'PRIVACY_POLICY' }` 를 준다.
 *
 * ★ 페이지를 스파이 컴포넌트로 치환한다(02a ★2) — 위임된 페이지가 받은 prop 만 관찰하고, 실 페이지의
 *   서버 조회는 태우지 않는다. 구현 전에는 두 페이지 모듈·라우트 파일이 없어 suite 가 모듈 미해석
 *   red 다(placeDetailStubRoute 선례의 "신규 모듈 red").
 */

// `mock` 접두 변수만 jest.mock 팩토리가 참조할 수 있다(호이스팅 규칙).
const mockViewer: { termsType?: string; rendered: boolean } = {
  rendered: false,
};
const mockReconsent = { rendered: false };

jest.mock('@/pages/terms-viewer', () => ({
  TermsViewerPage: (props: { termsType?: string }) => {
    mockViewer.termsType = props.termsType;
    mockViewer.rendered = true;
    return null;
  },
}));

jest.mock('@/pages/reconsent', () => ({
  ReconsentPage: () => {
    mockReconsent.rendered = true;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ termsType: 'PRIVACY_POLICY' }),
}));

beforeEach(() => {
  mockViewer.termsType = undefined;
  mockViewer.rendered = false;
  mockReconsent.rendered = false;
});

describe('TRIP-937 · 약관 열람 라우트 — TermsViewerPage 위임 (AC-2)', () => {
  it('useLocalSearchParams 의 termsType 을 그대로 TermsViewerPage 에 넘긴다', () => {
    // 준비·실행: 라우트만 렌더한다.
    render(<TermsViewerRoute />);

    // 단언: 위임된 페이지가 렌더됐고, 받은 termsType 이 URL 세그먼트 값 그대로다.
    expect(mockViewer.rendered).toBe(true);
    expect(mockViewer.termsType).toBe('PRIVACY_POLICY');
  });
});

describe('TRIP-937 · 재동의 라우트 — ReconsentPage 위임 (AC-5)', () => {
  it('ReconsentPage 를 그리고, 옛 "약관 재동의 (후속)" 자리표시 문구는 없다', () => {
    // 준비·실행
    render(<ReconsentRoute />);

    // 단언: 실 재동의 페이지로 위임한다.
    expect(mockReconsent.rendered).toBe(true);
    // 단언(짝): 갇힘의 원인이던 자리표시 한 줄이 사라졌다.
    expect(screen.queryByText('약관 재동의 (후속)')).toBeNull();
  });
});
