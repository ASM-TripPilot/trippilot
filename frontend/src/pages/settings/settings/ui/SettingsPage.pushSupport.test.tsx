import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import {
  useGetMe,
  useGetMeLocationConsent,
  useGetMePersonalization,
  useGetMePreferences,
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeProfileNickname,
  usePatchMeSettings,
} from '@/shared/api/index.hooks';
import { isPushSupported } from '@/shared/push/index.support';
import { newTestQueryClient } from '@/test-support/queryRender';

import {
  buildSettingsSections,
  filterReadySettingsSections,
} from '../model/settingsSections';
import { SettingsPage } from '..';

/**
 * TRIP-1648 · A5 — 웹에서는 설정의 "알림" 그룹(푸시 토글·권한 배너·`[설정 열기]`)이 통째로 숨는다.
 *
 * 무엇을 보장하나:
 *  - 모델: `buildSettingsSections` 입력 `pushAvailable` 이 `false` 면 알림 행이 `ready:false` 가 되고, 기존 필터가 행이
 *    0개가 된 "알림" 그룹까지 뺀다. 생략·`true` 는 지금과 똑같다(기존 테스트 무수정 green 의 근거). 위치 동의 행("GPS 이동경로
 *    기록")은 웹에서도 남는다(Q3 — 위치 정보 법적 동의를 받을 길을 막지 않는다).
 *  - 배선: `SettingsPage` 가 `isPushSupported()` 의 답을 모델에 넘긴다 — 모델만 맞고 페이지가 값을 안 넘기면 웹에서 행이
 *    그대로 보이는데 모델 테스트는 못 잡는다. 켜짐/꺼짐을 **짝**으로 둬서 "원래 안 그리는 화면"과 구분한다(02a ★6).
 *
 * 왜 `@/shared/push/index.support` 인가: 기존 `SettingsPage.hookMock.test` 가 `@/shared/push` 배럴을 4개 이름만 남기고 통째로
 * 목으로 갈아끼운다 — 지원 여부를 배럴에 두면 그 파일이 `is not a function` 으로 깨진다(02a ★1).
 * 이 파일의 훅 목 구성은 그 파일을 따른다(생성 훅을 딥 경로로 목, 값은 "응답 전" 모양).
 * 3동작: 준비(지원 여부 목 + 훅 응답) → 실행(모델 호출 / 페이지 렌더) → 단언(그룹·행 유무).
 */

jest.mock('@/shared/push/index.support', () => ({
  isPushSupported: jest.fn(),
}));
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  unregisterStoredPushToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
}));
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    router: ['push', 'back'],
  })
);

const INPUT = { nickname: '여행자123', email: 'a@b.com' };

const mockSupported = isPushSupported as jest.Mock;

describe('설정 모델 — pushAvailable', () => {
  it('false 면 "알림" 그룹이 통째로 빠지고 나머지 그룹·위치 동의 행은 그대로다', () => {
    const groups = filterReadySettingsSections(
      buildSettingsSections({ ...INPUT, pushAvailable: false })
    );

    expect(groups.map((group) => group.key)).toEqual([
      'account',
      'preferences',
      'location',
      'affiliate',
      'app-info',
      'danger',
    ]);
    const location = groups.find((group) => group.key === 'location');
    expect(location?.rows.map((row) => row.key)).toContain('location-consent');
  });

  it.each([
    ['생략', INPUT],
    ['true', { ...INPUT, pushAvailable: true }],
  ])(
    '%s 이면 "알림" 그룹이 알림 설정 행 하나로 남는다 (지금과 같다)',
    (_, input) => {
      const groups = filterReadySettingsSections(buildSettingsSections(input));

      const notifications = groups.find(
        (group) => group.key === 'notifications'
      );
      expect(notifications?.rows.map((row) => row.key)).toEqual([
        'notifications',
      ]);
    }
  );
});

describe('SettingsPage 배선 — isPushSupported 의 답이 화면에 닿는다', () => {
  beforeEach(() => {
    mockSupported.mockReset();
    (useGetMe as jest.Mock).mockReturnValue({
      data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
    });
    (useGetMeProfile as jest.Mock).mockReturnValue({
      data: {
        nickname: '여행자123',
        nicknameUpdatedAt: '2026-01-01T00:00:00Z',
      },
    });
    (useGetMePreferences as jest.Mock).mockReturnValue({ data: undefined });
    (useGetMeLocationConsent as jest.Mock).mockReturnValue({ data: undefined });
    (useGetMePersonalization as jest.Mock).mockReturnValue({ data: undefined });
    (useGetMeSettings as jest.Mock).mockReturnValue({ data: undefined });
    (usePatchMeSettings as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });
    (usePatchMeProfileNickname as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });
  });

  function renderPage() {
    return render(
      <QueryClientProvider client={newTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );
  }

  it('(대조) 지원하면 알림 설정 행이 보인다', () => {
    mockSupported.mockReturnValue(true);

    renderPage();

    expect(screen.getByTestId('settings-nav-notifications')).toBeOnTheScreen();
  });

  it('지원하지 않으면 알림 설정 행이 없고, 위치 동의 행은 그대로 보인다', () => {
    mockSupported.mockReturnValue(false);

    renderPage();

    expect(screen.queryByTestId('settings-nav-notifications')).toBeNull();
    expect(
      screen.getByTestId('settings-nav-location-consent')
    ).toBeOnTheScreen();
  });
});
