import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-668 g01 동행 편집 시트 — **배선 승인 테스트**(요약 "동행" 행 → 시트 오픈 → 드래프트 전이 → 적용 → 스토어).
 *
 * 무엇을 보장하나: S1 이 남긴 동행 행 오픈 콜백(현 `openEditSheet` 스텁)에 이 시트가 배선돼
 *  ① 동행 행 탭 → 시트 마운트(트리 존재) ② 스테퍼·칩 탭 → 배선이 드래프트를 전이시켜 재렌더(값·표식 변화,
 *  무상태 시트라 이 전이는 여기서만 관측된다) ③ **적용 누르기 전엔 스토어 불변**, 누르면 `setParty`+
 *  `selectCompanion` 각 1회 커밋 + 닫힘(★ 드래프트 계약). ④ 혼자 선택 시 배선이 draftParty 를 1 로 고정.
 *  ⑤ 시트를 열면 드래프트가 스토어 현재값에서 초기화된다(D3 프리필).
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "탭→값/표식 변화"는 배선이 드래프트를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영과 전이를 함께 관측해야 한다. 컴포넌트 단위(표식·콜백)는 별 파일이 잠근다.
 *
 * ⚠️ 회원(토큰 목 주입)으로 돈다 — 제출을 안 하고 요약 행만 여는지라 S3 harness 를 계승한다. 무조건 발화하는
 * `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다. `/regions`·`/saved-*` 핸들러는 **일부러 안
 * 준다**(남기면 신 배선이 그 훅을 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). 제출 안 함 → POST /trips 불필요.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은 **조건부
 * 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·터치 차단은 jest 사각(6-b 실기).
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

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const BASE_DATE = '2026-06-01';

const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식'] },
  activities: { value: ['야경'] },
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  useTripWizardStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

function renderPage() {
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: createWrapper(),
  });
}

/** 동행 요약 행을 눌러 시트를 연다(공통). */
async function openSheet(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-summary-companion'));
  await screen.findByTestId('trip-wizard-companion-sheet');
}

describe('C-1 · 동행 행 탭이 시트를 연다', () => {
  it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
    renderPage();
    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-companion'));

    expect(
      await screen.findByTestId('trip-wizard-companion-sheet')
    ).toBeOnTheScreen();
  });
});

describe('C-2 · ★ 드래프트 계약 — 적용 전 store 불변, 적용에서만 커밋', () => {
  it('스테퍼·칩 전이는 store 를 안 건드리고, 적용에서만 setParty·selectCompanion 이 반영된다', async () => {
    renderPage();
    await openSheet();

    // 인원 + → 드래프트 값 전이("2명"). store 는 아직 party 1.
    fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
    expect(await screen.findByText('2명')).toBeOnTheScreen();

    // 친구 칩 → 활성 표식 전이. store companionType 은 아직 undefined.
    fireEvent.press(screen.getByTestId('trip-wizard-companion-chip-friend'));
    expect(
      await screen.findByTestId('trip-wizard-companion-chip-active-friend')
    ).toBeOnTheScreen();

    // 적용 전 — 즉시반영이 아니라 드래프트다(즉시커밋 뮤턴트가 이 둘로 red).
    expect(useTripWizardStore.getState().party).toBe(1);
    expect(useTripWizardStore.getState().companionType).toBeUndefined();

    // 적용 → 커밋(각 1회 반영) + 닫힘.
    fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));

    await waitFor(() => expect(useTripWizardStore.getState().party).toBe(2));
    expect(useTripWizardStore.getState().companionType).toBe('친구');
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull()
    );
  });
});

describe('C-3 · ★ 혼자 → 배선이 draftParty 1 고정 + 커밋', () => {
  it('인원을 올린 뒤 혼자를 고르면 값이 1명으로 고정·스테퍼 비활성, 적용하면 party 1 커밋', async () => {
    renderPage();
    await openSheet();

    // 초기 store party 1 → + 두 번 → 드래프트 "3명".
    fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
    fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
    expect(await screen.findByText('3명')).toBeOnTheScreen();

    // 혼자 선택 → 배선이 draftParty 를 1 로 고정("1명") + 스테퍼 진짜 disabled.
    fireEvent.press(screen.getByTestId('trip-wizard-companion-chip-alone'));
    expect(await screen.findByText('1명')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-companion-party-dec')
    ).toBeDisabled();
    expect(
      screen.getByTestId('trip-wizard-companion-party-inc')
    ).toBeDisabled();

    // 적용 → party 1 커밋(배선이 고정을 안 하면 3 이 남아 red).
    fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));
    await waitFor(() => expect(useTripWizardStore.getState().party).toBe(1));
    expect(useTripWizardStore.getState().companionType).toBe('혼자');
  });
});

describe('C-4 · D3 프리필 — 시트를 열면 드래프트가 store 현재값에서 초기화된다', () => {
  it('store party 3·가족 상태에서 열면 값 "3명" + 가족 활성 표식으로 시작한다', async () => {
    renderPage();

    // 시트 열기 전 store 를 선상태로 만든다.
    useTripWizardStore.getState().setParty(3);
    useTripWizardStore.getState().selectCompanion('가족');

    await openSheet();

    // 프리필이 store 를 안 읽으면 "1명"·활성표식 없음으로 red.
    expect(screen.getByText('3명')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-companion-chip-active-family')
    ).toBeOnTheScreen();
  });
});
