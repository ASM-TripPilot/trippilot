import { fireEvent, render, screen } from '@testing-library/react-native';

import StaysDetailStubRoute from '@/app/stays/[stayId]';

/**
 * TRIP-420 AC-8 — `/stays/[stayId]` **임시 스텁 상세 라우트**.
 *
 * 무엇을 보장하나: 카드 탭이 실제로 착지할 상세 라우트 파일이 존재하고, `useLocalSearchParams`
 * 로 받은 param(어느 숙소인지)을 표시하며, 뒤로가기 어포던스가 동작한다. 상세 데이터는 계약
 * 3종(상세 GET·라이브가격·OTA outbound)이 전부 openapi 에 없어 **아무것도 조회하지 않는다**
 * (INV-1 — 데이터 발명 금지). 실 상세(US-STAY-03)는 TRIP-323 몫이고 이 스텁은 자리표시다.
 *
 * 왜 `src/__tests__/` 인가: 이 테스트를 `src/app/` 아래 두면 expo-router 의 `require.context`
 * 가 `.test.tsx` 까지 라우트로 등록해 실기 부팅 레드박스를 낸다(선례 `tabsItineraryRoute`).
 * 라우트 파일을 직접 import 해 렌더하는 형태는 `tabsHomeRoute.test.tsx` 와 동형이다.
 *
 * *(개념)* 정적 `router.back()` 과 `useRouter().back()` 두 형태 중 어느 쪽으로 구현하든 관찰
 *   되도록 목에서 둘 다 같은 스파이로 잇는다 — 테스트가 구현 형태를 과하게 묶지 않기 위해서다.
 *
 * *(개념)* `useLocalSearchParams` 는 **디코드된** 값을 준다 — push 할 때 `encodeURIComponent`
 *   로 `NAVER%3As1` 이 됐어도 수신 측은 `NAVER:s1` 을 본다. 그래서 목이 콜론 형태를 돌려준다.
 */

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ stayId: 'NAVER:s1' }),
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useRouter: () => ({ back: (...args: unknown[]) => mockBack(...args) }),
}));

beforeEach(() => {
  mockBack.mockClear();
});

describe('AC-8 · 스텁 상세 라우트 — param 표시 · 뒤로가기 · 데이터 0', () => {
  it('루트가 뜨고, 받은 stayId 를 표시하며, QueryClientProvider 없이도 안 죽는다', () => {
    // 실행 — QueryClientProvider **없이** 렌더한다. 생성 쿼리 훅을 하나라도 부르면
    // "No QueryClient set" 로 throw 하므로, 안 죽는 것 자체가 "데이터 조회 0"(INV-1)의
    // 행위적 프록시다.
    render(<StaysDetailStubRoute />);

    // 단언 — 스텁 루트가 있고, 어느 숙소인지(param)를 표시한다(정규식=부분매치, 문구는 자유).
    const root = screen.getByTestId('stay-detail-stub-root');
    expect(root).toBeOnTheScreen();
    expect(root).toHaveTextContent(/NAVER:s1/);
  });

  it('뒤로가기 어포던스를 누르면 router.back 이 1회 불린다', () => {
    render(<StaysDetailStubRoute />);

    // 실행 — 뒤로가기.
    fireEvent.press(screen.getByTestId('stay-detail-stub-back'));

    // 단언 — 정확히 한 번 뒤로 간다.
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
