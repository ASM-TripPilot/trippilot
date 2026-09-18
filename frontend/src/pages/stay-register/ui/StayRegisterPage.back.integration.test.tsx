import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StayRegisterPage } from './StayRegisterPage';

/**
 * SB-1 (TRIP-369 · AC-2 · 02a §3) — e05 뒤로가기의 페이지 배선.
 *
 * 무엇을 보장하나: 화면(`StayRegisterScreen`)이 그린 뒤로가기 컨트롤의 `onBack`이 페이지의
 * `router.back()`으로 이어져 있다. 화면은 라우팅을 모르므로(구조 가드) 이 배선은 반드시
 * 페이지에서만 성립한다 — SR-1(화면)이 "콜백이 불렸나"까지 재고, 이 파일이 그 콜백이 실제
 * 라우터로 가는지를 잰다.
 *
 * 왜 통합 버킷인가: `useRouter`를 목으로 갈아끼워 `router.back()` 호출을 관찰해야 하기 때문이다
 * (프리즈 `StayRegisterPage.integration.test.tsx:48~53`과 동형 목).
 *
 * 서버(msw)는 띄우지 않는다(02a ★K): 마운트 시 `useGetStaysGeocode`는 `enabled:false`로 꺼져
 * 있고 `usePostSavedStays`는 미발화라 HTTP가 0건이다. `@/shared/storage`만 목킹한다 —
 * authedClient(생성 클라이언트의 인증 계층)가 정적으로 물어 expo-secure-store 실물을 로드하려
 * 하므로(프리즈 통합테스트 :33~44 동형).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 호이스트돼 바깥 변수를 못 본다 — 이름이 `mock`으로 시작하는
// 변수만 예외다(02a ★E). 엘리먼트를 만들지 않으므로 인라인 팩토리로 충분하다.
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
});

/** 프리즈 통합테스트(:145~155)와 동형 — gcTime:0이 없으면 기본값(5분) 타이머가 테스트 종료
 * 후에도 살아남아 Node 프로세스를 붙잡는다. */
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

describe('SB-1 · 뒤로가기 버튼이 router.back()으로 배선된다 (AC-2)', () => {
  it('페이지를 열고 헤더 뒤로가기를 누르면 이전 화면으로 돌아간다', () => {
    // 준비 — 기본 탭(지도 검색) 상태로 연다. 뒤로가기는 탭과 무관하게 헤더에 있다(02a ★L).
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    // 실행 — 화면이 그린 뒤로가기 컨트롤을 누른다(없으면 getByTestId가 throw).
    fireEvent.press(screen.getByTestId('stay-register-back'));

    // 단언 — 화면의 onBack이 페이지의 router.back()으로 이어져 있다(목 mockBack).
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
