import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { StayRegisterPage } from './StayRegisterPage';

/**
 * PC-1~PC-2 (TRIP-390 AC-4·5 · 01b Seed §Q1·§Q2) — 숙소 등록 달력의 **배선**을 페이지 층에서 잠근다.
 *
 * 무엇을 보장하나: 화면 렌더만으로는 안 보이는 두 배선이 실제로 산다.
 *  - 체크인만 고르고 시트를 닫아도 그 선택이 **사라지지 않는다**(AC-4 · INV-4 침묵 금지) —
 *    유지는 페이지 close 핸들러의 책임이고, 순수 함수 `commitDateRange`(PBT 동결)는 안 건드린다
 *  - 여행 기간(`useTripWizardStore`)이 달력 상·하한으로 **흘러 들어간다**(AC-5) — 화면 테스트
 *    (SC-4)는 min/max prop을 직접 주입하므로 "페이지가 store를 읽어 내리는" 이 배선은 못 본다.
 *    이 파일이 리포 최초의 stay→trip store 참조를 잠근다(repo-traps 계열 사각 방지)
 *
 * env·목 규율은 `StayRegisterPage.integration.test.tsx` 스캐폴딩을 이식했다. 달력 조작은
 * 무네트워크라 `onUnhandledRequest:'error'`가 예기치 못한 요청을 실패로 잡는다.
 */
// authedClient가 @/shared/storage(expo-secure-store)를 정적으로 물어 실물 로드를 피하려면 목킹.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

// 지도 모듈 로드 부작용(webview 네이티브) 차단 — 모듈 스코프 파일 require(호이스트 규칙).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  // 스토어는 모듈 싱글턴이라 파일 간 상태가 샌다 — 매 테스트 초기화(선례 stayImport.test.tsx:159).
  useTripWizardStore.getState().reset();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** gcTime:0이 없으면 기본 5분 타이머가 테스트 종료 후에도 Node를 붙잡는다(선례). */
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

function summary() {
  return screen.getByTestId('stay-register-date-summary');
}

/** 달력에서 비활성이 아닌 첫 셀 — 실행 날짜를 몰라도(시계 무관) 유효한 체크인을 하나 고른다.
 *  비활성 판정은 `accessibilityState.disabled`(RN Pressable가 disabled prop에서 파생, R-13 검증). */
function firstEnabledCell() {
  const cells = screen.getAllByTestId(/^stay-register-date-cell-/);
  const enabled = cells.find(
    (node) => node.props.accessibilityState?.disabled !== true
  );
  if (enabled === undefined) throw new Error('활성 날짜 셀이 없다');
  return enabled;
}

describe('PC-1 · 반쪽 유지 · 침묵 금지 (AC-4 · INV-4)', () => {
  it('체크인만 고르고 시트를 닫아도 선택이 남아 "체크아웃도 선택하세요"가 뜬다', () => {
    // 준비: 여행 기간 없음(상한 없는 현행), 페이지 렌더.
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    // 실행: 달력을 열고 유효한 날 하나(체크인)만 고른 뒤 완료로 닫는다.
    fireEvent.press(screen.getByTestId('stay-register-date-field'));
    fireEvent.press(firstEnabledCell());
    fireEvent.press(screen.getByTestId('stay-register-datesheet-close'));

    // 단언: 체크인이 남아 다음 걸음을 안내한다 — 리셋되면 '날짜를 선택하세요'가 되어 red.
    expect(summary()).toHaveTextContent('체크아웃도 선택하세요');
  });
});

describe('PC-2 · 여행 기간이 달력 상·하한으로 배선된다 (AC-5)', () => {
  it('store 기간 밖 날짜는 disabled로 차단되고, 기간 안은 열려 있다', () => {
    // 준비: 위저드 스토어에 여행 기간 06-16~06-18을 심고, 기준 오늘을 06-15로 주입.
    useTripWizardStore.setState({
      startDate: '2026-06-16',
      endDate: '2026-06-18',
    });
    render(<StayRegisterPage baseDate="2026-06-15" />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(screen.getByTestId('stay-register-date-field'));

    // 상한 밖(종료일 다음날)은 잠기고, 눌러도 체크인이 안 잡힌다(요약 불변).
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-19')
    ).toBeDisabled();
    fireEvent.press(screen.getByTestId('stay-register-date-cell-2026-06-19'));
    expect(summary()).toHaveTextContent('날짜를 선택하세요');

    // 하한이 시작일까지 올라간다 — 오늘(06-15)이지만 여행 시작(06-16) 전이라 잠긴다.
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-15')
    ).toBeDisabled();

    // 기간 안(양 끝 포함)은 열려 있다.
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-17')
    ).toBeEnabled();
  });
});

describe('PC-3 · 위저드 기간이 당일(시작 = 끝)이면 달력을 막지 않는다 (TRIP-1027 AC-10)', () => {
  it('store 기간 6/16–6/16 이어도 오늘·기간 밖 날짜가 열려 있고, 6/16 체크인 → 6/17 체크아웃을 고를 수 있다', () => {
    // 준비: 1/4 에서 여행지 없이 시작만 고른 채 떠난 상태(끝 = 시작). 기준 오늘 06-15.
    useTripWizardStore.setState({
      startDate: '2026-06-16',
      endDate: '2026-06-16',
    });
    render(<StayRegisterPage baseDate="2026-06-15" />, {
      wrapper: createWrapper(),
    });

    // 실행
    fireEvent.press(screen.getByTestId('stay-register-date-field'));

    // 단언 ① — 기간 없음과 같게 취급: 오늘(06-15)도, 당일 다음 날(06-17·06-19)도 열려 있다.
    // (짝: PC-2 는 기간이 있으면 06-15·06-19 가 잠긴다.)
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-15')
    ).toBeEnabled();
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-17')
    ).toBeEnabled();
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-19')
    ).toBeEnabled();

    // 단언 ② — 실제로 1박을 고를 수 있다(체크아웃 > 체크인). 요약 표기(요일·구분자)는 이 테스트의
    // 관심사가 아니라 두 날짜가 다 찍혔는지만 정규식(부분 포함)으로 본다(02a ★10).
    fireEvent.press(screen.getByTestId('stay-register-date-cell-2026-06-16'));
    fireEvent.press(screen.getByTestId('stay-register-date-cell-2026-06-17'));
    expect(summary()).toHaveTextContent(/6\.16.*6\.17/);
    expect(summary()).not.toHaveTextContent(/선택하세요/);
  });
});
