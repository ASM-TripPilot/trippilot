jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
  useGetMeSettings: jest.fn(),
  usePatchMeSettings: jest.fn(),
}));
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  unregisterStoredPushToken: jest.fn(() => Promise.resolve()),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosError } from 'axios';

import {
  useDeleteMeDeletion,
  useGetMe,
  usePostMeDeletion,
} from '@/shared/api/generated/account/account';
import { useGetMeLocationConsent } from '@/shared/api/generated/location/location';
import { useGetMePreferences } from '@/shared/api/generated/preferences/preferences';
import {
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/generated/profile/profile';
import { useGetMePersonalization } from '@/shared/api/generated/reflection/reflection';
import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
  unregisterStoredPushToken,
} from '@/shared/push';

import { SettingsPage } from '..';

/**
 * TRIP-835 · AC-6 · Q4 — 계정 삭제 요청·철회에 푸시 토큰을 잇는다.
 *
 * 무엇을 보장하나:
 *  - AC-6: 삭제 요청(`POST /me/deletion`)이 **성공**하면 이 기기 토큰을 해제한다 — 삭제를 요청한 계정으로
 *    알림이 가지 않는다(사용자 확정). 실패하면 해제하지 않고 기존 인라인 오류는 그대로다.
 *  - Q4: 삭제를 **철회**하면(성공 시만) 조용히 다시 등록한다 — 묻지 않는다.
 *
 * 왜 목인가: 여기서 볼 것은 "성공 콜백에서 불렀나"뿐이다. 해제가 인증을 지우기 전에 출발하는지(로그아웃)는
 *  실모듈+MSW 로 `SettingsPage.pushLogout.integration.test.tsx` 가 따로 잰다(02a ★14).
 *
 * ★ 뮤테이션 목은 옵션 캡처형이다 — mutate 가 페이지가 넘긴 `onSuccess/onError` 를 동기로 부른다
 *   (SettingsPage.test 선례). 단순 `{mutate: jest.fn()}` 이면 성공 콜백이 원리적으로 안 돈다.
 *
 * 3동작 뼈대: 준비=삭제·철회 결과 → 실행=삭제 2단 확정 / 철회 press → 단언=해제·등록 호출 횟수.
 */

const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;
const mockUsePostMeDeletion = usePostMeDeletion as jest.Mock;
const mockUseDeleteMeDeletion = useDeleteMeDeletion as jest.Mock;
const mockUnregister = unregisterStoredPushToken as jest.Mock;
const mockRegisterIfGranted = registerPushIfGranted as jest.Mock;

function httpError(status: number): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

/** 옵션 캡처형 뮤테이션 목 — error 면 onError, 아니면 onSuccess 를 페이지 콜백으로 동기 발화. */
function primeMutation(
  hook: jest.Mock,
  opts: { onSuccessData?: unknown; error?: unknown }
) {
  hook.mockImplementation(
    (options?: {
      mutation?: {
        onSuccess?: (data: unknown, vars: unknown, ctx: unknown) => void;
        onError?: (error: unknown, vars: unknown, ctx: unknown) => void;
      };
    }) => ({
      isPending: false,
      mutate: (vars?: unknown) => {
        if (opts.error) {
          options?.mutation?.onError?.(opts.error, vars, undefined);
        } else {
          options?.mutation?.onSuccess?.(opts.onSuccessData, vars, undefined);
        }
      },
    })
  );
}

function primeAccount(status: 'ACTIVE' | 'DELETION_PENDING') {
  mockUseGetMe.mockReturnValue({
    data: {
      accountId: 'acc-1',
      status,
      email: 'a@b.com',
      socialProviders: ['KAKAO'],
      onboardingCompleted: true,
    },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

/** 삭제 진입 → 1단 [계속] → 2단 [계정 삭제]. */
function confirmDeletion() {
  fireEvent.press(screen.getByTestId('settings-delete-account'));
  fireEvent.press(screen.getByTestId('settings-delete-confirm'));
  fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));
}

beforeEach(() => {
  jest.clearAllMocks();
  primeAccount('ACTIVE');
  mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
  (useGetMePreferences as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeLocationConsent as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMePersonalization as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeSettings as jest.Mock).mockReturnValue({ data: undefined });
  (usePatchMeSettings as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
  primeMutation(mockUsePostMeDeletion, {
    onSuccessData: { purgeAt: '2026-10-25T00:00:00Z', cascadeSummary: {} },
  });
  primeMutation(mockUseDeleteMeDeletion, { onSuccessData: undefined });
});

describe('TRIP-835 AC-6 · 계정 삭제 요청 → 이 기기 토큰 해제', () => {
  it('D1 삭제 요청이 성공하면 보관 토큰 해제를 1회 부른다(재등록은 0회)', () => {
    // 준비: beforeEach — 삭제 POST 가 성공한다.
    renderPage();

    // 실행
    confirmDeletion();

    // 단언
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
  });

  it('D2 삭제 요청이 실패하면 해제 0회, 기존 인라인 오류는 그대로 뜬다', () => {
    primeMutation(mockUsePostMeDeletion, { error: httpError(500) });
    renderPage();

    confirmDeletion();

    expect(mockUnregister).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('settings-delete-account-error')
    ).toBeOnTheScreen();
  });

  it('D3 1단 [계속]만 누르고 최종 확정 전이면 해제 0회', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('settings-delete-account'));
    fireEvent.press(screen.getByTestId('settings-delete-confirm'));

    expect(mockUnregister).not.toHaveBeenCalled();
  });
});

describe('TRIP-835 Q4 · 삭제 철회 → 조용한 재등록', () => {
  it('W1 철회가 성공하면 조회 전용 등록 1회 — 묻는 루틴은 0회, 해제도 0회', () => {
    // 준비: 이미 삭제 유예 중인 세션.
    primeAccount('DELETION_PENDING');
    renderPage();

    // 실행
    fireEvent.press(screen.getByTestId('settings-deletion-cancel'));

    // 단언
    expect(mockRegisterIfGranted).toHaveBeenCalledTimes(1);
    expect(promptAndRegisterPush).not.toHaveBeenCalled();
    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('W2 철회가 실패(404)하면 재등록 0회', () => {
    primeAccount('DELETION_PENDING');
    primeMutation(mockUseDeleteMeDeletion, { error: httpError(404) });
    renderPage();

    fireEvent.press(screen.getByTestId('settings-deletion-cancel'));

    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
  });
});
