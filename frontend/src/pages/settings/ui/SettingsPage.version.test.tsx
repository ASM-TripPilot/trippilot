import fs from 'fs';
import path from 'path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeLocationConsent } from '@/shared/api/generated/location/location';
import { useGetMePreferences } from '@/shared/api/generated/preferences/preferences';
import {
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/generated/profile/profile';
import { useGetMePersonalization } from '@/shared/api/generated/reflection/reflection';

import { SettingsPage } from '..';

/**
 * TRIP-935 AC-3(R4) — 설정 하단 버전 줄의 값 출처.
 *
 * 무엇을 보장하나:
 *  - 페이지가 빌드에 박힌 설정값(`Constants.expoConfig.version`)을 그대로 화면에 내린다 — 스토어
 *    버전과 앱 안 표기가 한 출처(app.config)에서 온다(2.3).
 *  - 값이 없으면(expoConfig 없음·version 없음) 버전 줄이 없다 — 가짜 숫자로 채우지 않는다(INV-4).
 *  - 설정 표면 운영 소스에 옛 하드코딩 `1.0.0` 이 남지 않는다.
 *
 * 목: `expo-constants` 는 게터로 둬 테스트마다 값을 바꾼다(02a ★6). 페이지가 정적 import 하는
 * `expo-linking` 도 끊는다(02a ★7). account·profile 은 자동 목에 조회 훅 2개만 값을 채운다.
 */

let mockExpoConfig: { version?: string } | null = null;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/shared/api/generated/account/account');
// TRIP-778: profile 은 팩토리 목 — codegen(D1) 전엔 `useGetMeSettings`·`usePatchMeSettings` 가 생성물에
// 없어 자동 목이 이름을 모른다. 기존 export 는 자동 목 그대로 두고 두 이름만 목 함수로 채운다(02a ★2).
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
  useGetMeSettings: jest.fn(),
  usePatchMeSettings: jest.fn(),
}));
// TRIP-778: 페이지가 새로 읽는 조회 3종(취향·위치 동의·개인화) — 실 훅이 네트워크로 나가지 않게 자동 목.
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');

const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

/**
 * TRIP-778 — 페이지가 새로 부르는 조회 4종·변경 1종을 "응답 전" 모양으로 채운다. 자동 목은 `undefined` 를
 * 돌려줘 페이지가 `.data` 에서 죽으므로 이 파일의 관심사와 무관해도 채워야 한다(02a ★2).
 */
function primeL05Hooks(): void {
  (useGetMePreferences as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeLocationConsent as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMePersonalization as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeSettings as jest.Mock).mockReturnValue({ data: undefined });
  (usePatchMeSettings as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExpoConfig = null;
  mockUseGetMe.mockReturnValue({
    data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
  });
  mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
  primeL05Hooks();
});

describe('🔴 TRIP-935 AC-3 · 페이지가 빌드 설정의 버전을 내린다', () => {
  it('expoConfig.version="9.8.7" 이면 "TripPilot v9.8.7" 을 그린다', () => {
    mockExpoConfig = { version: '9.8.7' };

    renderPage();

    expect(screen.getByText('TripPilot v9.8.7')).toBeOnTheScreen();
  });

  it.each([
    ['expoConfig 없음', null],
    ['version 없음', {}],
  ] as const)('%s 이면 버전 줄이 없다', (_label, expoConfig) => {
    mockExpoConfig = expoConfig;

    renderPage();

    // 앵커 — 설정 화면 하단(출처 블록)은 그려졌다.
    expect(screen.getByTestId('settings-data-attribution')).toBeOnTheScreen();
    expect(screen.queryAllByText(/TripPilot v/)).toHaveLength(0);
  });
});

describe('🔴 TRIP-935 AC-3 · 설정 표면 소스에 하드코딩 버전 1.0.0 이 없다', () => {
  it('features/settings·pages/settings 운영 소스에 "1.0.0" 리터럴이 0건이다', () => {
    const SRC = path.resolve(__dirname, '../../..');
    const roots = ['features/settings', 'pages/settings'];
    const isProdSource = (file: string) =>
      /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return isProdSource(entry.name) ? [full] : [];
      });

    const files = roots.flatMap((root) => walk(path.join(SRC, root)));
    const relative = files.map((file) => path.relative(SRC, file));

    // 앵커 — 스캔 대상이 실제로 잡혔다(경로 오타로 공허 통과하는 것 차단).
    expect(files.length).toBeGreaterThan(0);
    expect(relative).toContain('features/settings/ui/SettingsScreen.tsx');

    // 주석도 거른다 — 설정 표면에 가짜 버전 숫자를 남기지 않는다(02a ★20). 경계를 `\b` 로 두면
    // "v1.0.0" 의 v·1 사이가 경계가 아니어서 못 잡는다 — 앞뒤가 숫자·점이 아닌 것으로 가른다.
    const HARDCODED_VERSION = /(?<![\d.])1\.0\.0(?![\d.])/;
    const offenders = files
      .filter((file) => HARDCODED_VERSION.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
