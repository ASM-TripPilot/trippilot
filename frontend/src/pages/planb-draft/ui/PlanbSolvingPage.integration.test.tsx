import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlanbSolvingPage } from './PlanbSolvingPage';

/**
 * TRIP-440 · AC-1·2·3(배선) — i12 재계획 로딩 배선을 폴링→판정→렌더→취소/백그라운드로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 useReplanSession 이 SOLVING 을 주면 resolveReplanState→'solving'→i12 세 컨트롤이 렌더된다(AC-1).
 *  - 🔴 [취소] → cancel 뮤테이션이 {tripId, sessionId} 로 1회 나가고 itinerary PUT 은 0(AC-2·INV-U4-05).
 *  - 🔴 [백그라운드로] → router.back() 1회 + cancel 미호출(세션 살림, 취소와 구별, AC-3).
 *
 * 왜 통합 버킷·목 seam 인가: 페이지가 소비하는 useReplanSession(폴링)·cancel 훅·router 를 목해 서버·타이머
 * 없이 "무엇을 부르나"만 잰다(PlanbRequestPage.integration 선례 동형, msw·QueryClientProvider 불요).
 * resolveReplanState·ReplanSolvingScreen 은 **실물**(목 안 함) — SOLVING→'solving'→i12 렌더까지 실제로 태운다.
 * useReplanSession(폴링)을 목하므로 refetchInterval 실동작은 이 테스트가 못 본다(얇은 래퍼 미검증).
 *
 * jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 mock 으로 시작하는 변수만 예외.
 */

const TRIP_ID = 't1';
const SESSION_ID = 's9';

const mockCancel = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();

// 세션 조회 seam — SOLVING 을 준다(폴링 결과 shape 은 codegen useQuery 반환의 부분집합).
jest.mock('@/features/planb/model/useReplanSession', () => ({
  useReplanSession: () => ({
    data: { status: 'SOLVING', sessionId: 's9', tripId: 't1' },
    isPending: false,
    isError: false,
  }),
}));

// 취소 뮤테이션 seam(그 아래 codegen POST 는 계약 테스트 몫).
jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdReplanSessionsSessionIdCancel: () => ({
    mutate: mockCancel,
    isPending: false,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
  }),
  router: { back: mockBack, push: mockPush, replace: mockReplace },
}));

beforeEach(() => {
  mockCancel.mockClear();
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
});

describe('🔴 I1 · AC-1 — SOLVING 폴링이면 i12 세 컨트롤이 렌더된다', () => {
  it('진행 표시·[백그라운드로]·[취소]가 함께 뜬다', () => {
    render(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    expect(screen.getByTestId('planb-solving-progress')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-solving-background')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-solving-cancel')).toBeOnTheScreen();
  });
});

describe('🔴 I2 · AC-2 — [취소]는 cancel 만 부르고 itinerary PUT 은 0 (INV-U4-05)', () => {
  it('cancel 뮤테이션이 {tripId, sessionId} 로 1회 나간다', () => {
    render(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    fireEvent.press(screen.getByTestId('planb-solving-cancel'));

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      sessionId: SESSION_ID,
    });
  });

  it('★구조 — 페이지 소스에 itinerary 쓰기 훅이 0건이다(원 일정 미변경)', () => {
    const source = fs.readFileSync(
      path.resolve('src/pages/planb-draft/ui/PlanbSolvingPage.tsx'),
      'utf8'
    );
    // 부정 — 취소는 세션만 닫고 itinerary PUT 을 안 쏜다(INV-U4-05).
    expect(source).not.toContain('usePutTripsTripIdItinerary');
    expect(source).not.toContain('putTripsTripIdItinerary');
    // 긍정 짝 — 파일을 실제로 읽었고 cancel 을 배선한다(공허 통과 방지).
    expect(source).toContain('usePostTripsTripIdReplanSessionsSessionIdCancel');
  });
});

describe('🔴 I3 · AC-3 — [백그라운드로]는 router.back + cancel 0 (세션 살림)', () => {
  it('router.back() 이 1회 불리고 cancel 은 안 불린다', () => {
    render(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    fireEvent.press(screen.getByTestId('planb-solving-background'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
