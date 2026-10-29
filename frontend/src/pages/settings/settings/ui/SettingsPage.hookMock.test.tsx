import * as Linking from 'expo-linking';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act,
} from '@testing-library/react-native';
import { AxiosError } from 'axios';
import { useState } from 'react';
import { Keyboard, Share } from 'react-native';
import { DELETION_SCOPE } from '../model/deletionScope';
import {
  useDeleteMeDeletion,
  useGetMe,
  useGetMeExport,
  usePostMeDeletion,
} from '@/shared/api/index.hooks';
import { useGetMeLocationConsent } from '@/shared/api/index.hooks';
import { useGetMePreferences } from '@/shared/api/index.hooks';
import type { AccountExport } from '@/shared/api/index.schemas';
import {
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeProfileNickname,
  usePatchMeSettings,
} from '@/shared/api/index.hooks';
import { useGetMePersonalization } from '@/shared/api/index.hooks';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';
import {
  cacheFileCount,
  cacheFilesIn,
  failFileWrites,
  resetFakeFs,
  seedCacheFile,
} from '@/test-support/fakeExpoFileSystem';
import { SettingsPage } from '..';
import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
  unregisterStoredPushToken,
} from '@/shared/push';
import { newTestQueryClient } from '@/test-support/queryRender';
import { routerSpies } from '@/test-support/expoRouterMock';

/**
 * l05 설정 — SettingsPage 배선을 생성 훅 목으로 보는 node 버킷 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `SettingsPage{,.attribution,.nav,.push,.version}.test.tsx` 5개를 각자의
 * 바깥 describe 하나로 옮겼다. 옛 파일의 상수·헬퍼·beforeEach 는 그 describe 안에 갇혀 서로 안 보인다.
 * 파일 전체에 걸리는 것만 여기 둔다:
 *  - `jest.mock` 은 babel 이 파일 맨 위로 끌어올려 **파일 전체**에 건다 — 옛 5개 목의 합집합이다.
 *    expo-router 는 옛 `.nav` 모양(`router.push`·`back`, **`replace` 없음**) 그대로다. 다른 4개 관점은 목이 없어
 *    `loadRouter()` 가 null(이동 no-op)이었는데 이제 push·back 을 받는다 — 그 관점들은 이동을 단언하지 않으므로
 *    잃는 그물은 없다. `replace` 를 넣지 않은 것은 옛 `.nav` 에서 "잘못 replace 를 부르면 TypeError" 그물을 지키려고다.
 *  - 뮤테이션 훅 목의 구현(`mockImplementation`)은 `jest.clearAllMocks` 로 안 지워진다 — 옛 `.test`·`.push` 가 건
 *    구현이 다른 관점으로 새지 않게 아래 최상위 `beforeEach` 에서 자동 목 상태로 되돌린다.
 *  - 옛 `.version` 의 "설정 소스에 1.0.0 리터럴 0건" 소스 스캔은 지웠다(README 판정 3 — 회귀 감시). 버전 줄의
 *    출처(빌드 설정 그대로·없으면 줄 없음)는 그 관점의 렌더 테스트가 계속 잠근다.
 */

jest.mock('@/shared/api/generated/account/account');
// profile 은 팩토리 목 — 설정 조회·변경 두 이름(useGetMeSettings·usePatchMeSettings)을 목 함수로 채운다(옛 5개 공통).
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
  useGetMeSettings: jest.fn(),
  usePatchMeSettings: jest.fn(),
}));
// 페이지가 읽는 조회 3종(취향·위치 동의·개인화) — 실 훅이 네트워크로 나가지 않게 자동 목.
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');
// 옛 `.push` — 삭제 성공·철회 성공 콜백이 부르는 푸시 함수만 본다(다른 관점은 보관 토큰이 없어 원래 no-op).
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  unregisterStoredPushToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
// 옛 `.version` — 게터로 둬 테스트마다 빌드 설정 버전을 바꾼다. 기본은 null(버전 줄 없음).
let mockExpoConfig: { version?: string } | null = null;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));
// 옛 `.nav` 모양 — SettingsPage 는 누르는 순간 require('expo-router').router 를 읽는다(loadRouter).
// mockPush 는 공용 목 기록장(`routerSpies`)의 별칭이다.
const { push: mockPush } = routerSpies;
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    router: ['push', 'back'],
  })
);
// TRIP-1422 — 내보내기 파일 공유의 네이티브 경계 셋만 바꾼다(페이지·실행 함수·어댑터 파일은 진짜다).
//  ① 'expo' 는 "이 빌드에 모듈이 있나" 조회만 가로챈다 — jest-expo 는 ExpoSharing 을 늘 "있다"고 답해서(실측)
//     모듈 없는 빌드는 이 집합에 이름을 넣어야만 재현된다. 나머지 export 는 진짜를 그대로 비춘다(Proxy).
//  ② expo-file-system 은 메모리 대역 — jest-expo 목에는 File·Paths 가 아예 없다(실측: undefined).
//  ③ expo-sharing 은 공유 시트 대신 인자만 기록한다.
const mockMissingNativeModules = new Set<string>();
jest.mock('expo', () => {
  const actual = jest.requireActual('expo');
  return new Proxy(actual, {
    get(target, key) {
      if (key !== 'requireOptionalNativeModule') return target[key];
      return (name: string) =>
        mockMissingNativeModules.has(name)
          ? null
          : target.requireOptionalNativeModule(name);
    },
  });
});
jest.mock(
  'expo-file-system',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule
);
const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
  __esModule: true,
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

beforeEach(() => {
  mockExpoConfig = null;
  // 옛 `.test`·`.push`·`.attribution` 이 건 구현을 비워 자동 목(undefined 반환)으로 돌린다 — 각 관점은 자기
  // beforeEach 에서 필요한 것만 다시 건다.
  for (const hook of [
    usePostMeDeletion,
    useDeleteMeDeletion,
    usePatchMeProfileNickname,
    useGetMeExport,
    Linking.openURL,
  ]) {
    (hook as jest.Mock).mockReset();
  }
  // 예외 하나: 페이지는 렌더 중에 닉네임 저장이 진행 중인지 읽는다(TRIP-1305) — 닉네임을 안 보는 관점도
  // undefined 면 렌더가 죽으므로 "요청 없음" 모양을 기본으로 준다. 닉네임 관점은 자기 목으로 덮는다.
  (usePatchMeProfileNickname as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
});

// 토스트 스토어는 모듈 싱글턴이라 관점 사이로 샌다 — 모든 테스트 뒤에 비운다(짝 앵커: S3 "제출 전엔 토스트가 없다").
afterEach(() => {
  resetToast();
  // 메모리 파일 시스템·"모듈 없음" 집합도 모듈 싱글턴이다 — 앞 테스트가 쓴 파일이 뒤 테스트의 "파일 1개" 단언으로 새지 않게.
  resetFakeFs();
  mockMissingNativeModules.clear();
});

/** 뮤테이션 목이 부르는 콜백 모양(react-query 의 훅 옵션 `mutation` 과 `mutate` 호출별 옵션이 같다). */
type MutationCallbacks = {
  onSuccess?: (data: unknown, vars: unknown, ctx: unknown) => void;
  onError?: (error: unknown, vars: unknown, ctx: unknown) => void;
  onSettled?: (
    data: unknown,
    error: unknown,
    vars: unknown,
    ctx: unknown
  ) => void;
};
type MutationOutcome = { data: unknown } | { error: unknown };

/** 응답 하나를 콜백들에 흘린다 — 성공이면 onSuccess, 실패면 onError, 어느 쪽이든 끝에 onSettled. */
function settleCallbacks(
  callbacks: (MutationCallbacks | undefined)[],
  outcome: MutationOutcome,
  vars: unknown
): void {
  for (const cb of callbacks) {
    if ('error' in outcome) {
      cb?.onError?.(outcome.error, vars, undefined);
      cb?.onSettled?.(undefined, outcome.error, vars, undefined);
    } else {
      cb?.onSuccess?.(outcome.data, vars, undefined);
      cb?.onSettled?.(outcome.data, null, vars, undefined);
    }
  }
}

/**
 * TRIP-778 — 페이지가 새로 부르는 조회 4종·변경 1종을 "응답 전" 모양으로 채운다. 자동 목은 `undefined` 를
 * 돌려줘 페이지가 `.data` 에서 죽으므로 이 파일의 관심사와 무관해도 채워야 한다(02a ★2).
 * (관점 describe 마다 복사돼 있던 5벌을 모듈 최상위 하나로 모았다 — TRIP-1355.)
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

// TRIP-608 · TRIP-935 · TRIP-990 · TRIP-1422
describe('삭제 게이트·상태기·닉네임·내보내기 (옛 .test)', () => {
  /**
   * TRIP-608 — l05 설정 배선 승인 테스트(딥 경로 목 seam).
   *
   * 무엇을 보장하나(AC): 2단 삭제 게이트(AC-12, **법적 최우선**) · 삭제 상태기(AC-3/4/10) ·
   * 닉네임 저장·오류(AC-2/7/8/9) · 내보내기 잘림 표면화+핸드오프(AC-5).
   *
   * 왜 페이지 층인가: 이 AC 들은 훅 응답 → 상태 전이 → 화면이라는 **배선**의 성질이다. 화면(순수)만
   * 으로도, 순수 함수만으로도 표현할 수 없다 — 목 훅으로 서버 응답을 주입하고 실제 페이지를 렌더해
   * 잠근다.
   *
   * ★ 목 seam은 **딥 경로**(`@/shared/api/generated/{account,profile}/*`)다 — 배럴 목이면 실 훅이
   *   돌아 QueryClient 부재로 죽는다(explore 선례). 뮤테이션 목은 **옵션 캡처형**이라 mutate 가
   *   `opts.mutation.onSuccess/onError` 를 동기 발화한다 — 페이지가 그 콜백을 물었는지(상태 전이)까지
   *   관측된다. 단순 `{mutate:jest.fn()}` 목이면 AC-3/4/8/9/10 전이가 원리적으로 안 뜬다.
   *
   * ⚠️ jest 사각(6-b 실기 전용): 딤이 실제로 화면을 덮나·2단 모달이 실제로 뜨나. 여기선 다이얼로그를
   *   조건부 렌더로 보고 testID 존재/부재 + mutate 시퀀스로만 잠근다(리포 Modal 선례 0).
   *
   * (개념) 매처 — 완전값 leaf(요약 `여행자123`/`새이름`, 그룹 라벨, `DELETION_SCOPE[0]`)는 문자열
   *  인자(완전일치), 상위 텍스트에 더 붙는 것(오류 카피·purgeAt 연도·export 문구)은 정규식(부분포함).
   *  node_modules 실측(02a §5-A).
   */

  /**
   * TRIP-938 준비 단계 — 페이지가 로그아웃 때 캐시를 비우려고 `useQueryClient()` 를 부르므로
   * QueryClientProvider 안에서 그린다(없으면 "No QueryClient set" 으로 렌더가 죽는다, 02a ★5).
   * 조회 훅은 위에서 목하므로 이 클라이언트는 실제로 아무것도 가져오지 않는다.
   */
  function renderPage() {
    return render(
      <QueryClientProvider client={newTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );
  }

  const mockUseGetMe = useGetMe as jest.Mock;
  const mockUseGetMeProfile = useGetMeProfile as jest.Mock;
  const mockUsePostMeDeletion = usePostMeDeletion as jest.Mock;
  const mockUseDeleteMeDeletion = useDeleteMeDeletion as jest.Mock;
  const mockUsePatchNickname = usePatchMeProfileNickname as jest.Mock;
  const mockUseGetMeExport = useGetMeExport as jest.Mock;

  /** `isAxiosError` 가 true 여야 페이지의 상태 판정(`isNotFound` 등)이 도는 경로를 탄다. */
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

  function makeExport(overrides: {
    truncatedSections: string[];
    sections: string[];
  }): AccountExport {
    return {
      accountId: 'acc-1',
      exportedAt: '2026-08-30T00:00:00Z',
      sectionLimit: 500,
      truncatedSections: overrides.truncatedSections,
      sections: overrides.sections.map((section) => ({
        section,
        items: [],
        truncated: false,
      })),
    };
  }

  /**
   * 옵션 캡처형 뮤테이션 목 — mutate 호출 시 spy 를 찍고, error 면 onError, 아니면 onSuccess 를
   * 페이지가 넘긴 콜백으로 동기 발화한다. 이어서 onSettled 도 부른다(react-query 순서) — 훅 옵션과
   * `mutate(vars, 옵션)` 호출별 옵션 둘 다.
   */
  function primeMutation(
    hook: jest.Mock,
    opts: { spy?: jest.Mock; onSuccessData?: unknown; error?: unknown }
  ) {
    hook.mockImplementation((options?: { mutation?: MutationCallbacks }) => ({
      isPending: false,
      mutate: (vars?: unknown, callOptions?: MutationCallbacks) => {
        opts.spy?.(vars);
        settleCallbacks(
          [options?.mutation, callOptions],
          opts.error ? { error: opts.error } : { data: opts.onSuccessData },
          vars
        );
      },
    }));
  }

  function primeAccount(
    status: 'ACTIVE' | 'DELETION_PENDING',
    email: string | null
  ) {
    mockUseGetMe.mockReturnValue({
      data: {
        accountId: 'acc-1',
        status,
        email,
        socialProviders: ['KAKAO'],
        onboardingCompleted: true,
      },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    primeAccount('ACTIVE', 'a@b.com');
    mockUseGetMeProfile.mockReturnValue({
      data: {
        nickname: '여행자123',
        nicknameUpdatedAt: '2026-01-01T00:00:00Z',
      },
    });
    primeL05Hooks();
    primeMutation(mockUsePostMeDeletion, {
      onSuccessData: { purgeAt: '2026-09-13T00:00:00Z', cascadeSummary: {} },
    });
    primeMutation(mockUseDeleteMeDeletion, { onSuccessData: undefined });
    primeMutation(mockUsePatchNickname, {
      onSuccessData: { nickname: '여행자123', nicknameUpdatedAt: 'x' },
    });
    mockUseGetMeExport.mockReturnValue({
      refetch: jest.fn().mockResolvedValue({
        data: makeExport({ truncatedSections: [], sections: [] }),
      }),
    });
  });

  describe('TRIP-608 · 2단 삭제 게이트 (AC-12 · 법적)', () => {
    it('1단 [계속] 뒤 POST 미발화, 2단 [계정 삭제] 뒤 정확히 1회', () => {
      const postSpy = jest.fn();
      primeMutation(mockUsePostMeDeletion, {
        spy: postSpy,
        onSuccessData: { purgeAt: '2026-09-13T00:00:00Z', cascadeSummary: {} },
      });
      renderPage();

      // 실행: 삭제 진입 → 1단 [계속].
      fireEvent.press(screen.getByTestId('settings-delete-account'));
      fireEvent.press(screen.getByTestId('settings-delete-confirm'));

      // 단언(급소): 1단만으로는 POST 가 나가지 않는다.
      expect(postSpy).not.toHaveBeenCalled();

      // 실행: 2단 최종 확인.
      fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));

      // 단언: 2단 확정 뒤에만, 정확히 한 번.
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('1단 다이얼로그가 deletionScope 전체 목록을 고지한다(Q1)', () => {
      renderPage();
      fireEvent.press(screen.getByTestId('settings-delete-account'));

      // 단언(전량·완전일치): Figma 3항목 축약이 아니라 deletionScope.ts 실제 목록 전량을 그린다.
      // 첫 항목만 확인하면(구 DELETION_SCOPE[0]) 목록을 slice 로 줄여도 통과해 법적 '덜 고지'가
      // 초록으로 샌다 — 되돌릴 수 없는 삭제라 각 항목을 개별로 잠근다.
      DELETION_SCOPE.forEach((item) => {
        expect(screen.getByText(item)).toBeOnTheScreen();
      });
      expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
      expect(screen.getByTestId('settings-delete-cancel')).toBeOnTheScreen();
    });

    it('1단에서 취소하면 POST 를 안 낸다(AC-12 짝 · 1단)', () => {
      const postSpy = jest.fn();
      primeMutation(mockUsePostMeDeletion, { spy: postSpy });
      renderPage();

      fireEvent.press(screen.getByTestId('settings-delete-account'));
      fireEvent.press(screen.getByTestId('settings-delete-cancel'));

      // 단언: POST 미발화 + 다이얼로그 접힘.
      expect(postSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('settings-delete-confirm')).toBeNull();
    });

    it('2단(최종 확인)에서 취소하면 POST 를 안 낸다(AC-12 짝 · 2단)', () => {
      const postSpy = jest.fn();
      primeMutation(mockUsePostMeDeletion, { spy: postSpy });
      renderPage();

      // 실행: 삭제 진입 → 1단 [계속]으로 2단 전이 → 2단 [취소].
      // 1단·2단 취소 버튼은 testID 가 같지만 조건부 렌더라 공존하지 않는다 — step2 전이 뒤엔
      // getByTestId 가 2단 취소를 집는다(사용자가 오삭제에 가장 가까운 지점).
      fireEvent.press(screen.getByTestId('settings-delete-account'));
      fireEvent.press(screen.getByTestId('settings-delete-confirm'));
      fireEvent.press(screen.getByTestId('settings-delete-cancel'));

      // 단언(급소): 2단에서 취소한 사용자는 삭제되지 않는다 — POST 미발화 + 2단 다이얼로그 접힘.
      expect(postSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('settings-delete-confirm-final')).toBeNull();
    });
  });

  describe('TRIP-608 · 삭제 상태기 (AC-3 · AC-4 · AC-10)', () => {
    it('AC-3: 2단 확정 200 → DELETION_PENDING · purgeAt · [삭제 철회]', () => {
      primeMutation(mockUsePostMeDeletion, {
        spy: jest.fn(),
        onSuccessData: { purgeAt: '2026-09-13T00:00:00Z', cascadeSummary: {} },
      });
      renderPage();

      fireEvent.press(screen.getByTestId('settings-delete-account'));
      fireEvent.press(screen.getByTestId('settings-delete-confirm'));
      fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));

      // 단언: 유예 상태로 전환 + 철회 어포던스 + purgeAt(연도만 부분포함 — 서식은 구현 재량).
      expect(screen.getByTestId('settings-deletion-pending')).toBeOnTheScreen();
      expect(screen.getByTestId('settings-deletion-cancel')).toBeOnTheScreen();
      expect(screen.getByText(/2026/)).toBeOnTheScreen();
    });

    it('AC-4: 철회 200 → ACTIVE 복귀', () => {
      // 준비: 이미 유예 상태로 진입한 세션.
      primeAccount('DELETION_PENDING', 'a@b.com');
      const delSpy = jest.fn();
      primeMutation(mockUseDeleteMeDeletion, {
        spy: delSpy,
        onSuccessData: undefined,
      });
      renderPage();

      // 실행: 삭제 철회.
      fireEvent.press(screen.getByTestId('settings-deletion-cancel'));

      // 단언: DELETE 1회 + 유예 배너 사라짐 + 삭제 진입행 복귀.
      expect(delSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('settings-deletion-pending')).toBeNull();
      expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
    });

    it('AC-10: 철회 404 → 안내(침묵 금지), 유예 유지', () => {
      primeAccount('DELETION_PENDING', 'a@b.com');
      primeMutation(mockUseDeleteMeDeletion, {
        spy: jest.fn(),
        error: httpError(404),
      });
      renderPage();

      fireEvent.press(screen.getByTestId('settings-deletion-cancel'));

      // 단언: 404 는 "유예 없음"이지 성공이 아니다 — 안내를 띄우고 유예 상태를 유지한다.
      expect(
        screen.getByTestId('settings-deletion-cancel-error')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('settings-deletion-pending')).toBeOnTheScreen();
    });
  });

  /**
   * TRIP-935 AC-4(R5) — 삭제 요청(POST) 실패를 조용히 삼키지 않는다(5.1.1(v) · INV-4). 철회(DELETE)
   * 실패 안내(AC-10)와 대칭으로, 요청 실패도 인라인 오류를 띄우고 상태는 active(삭제 행 유지)로 둔다.
   * 응답 없는 네트워크 오류도 같은 표면이어야 한다 — 상태 코드만 보고 분기하면 그 케이스가 red.
   */
  describe('🔴 TRIP-935 AC-4 · 삭제 요청 실패 → 인라인 오류, active 유지', () => {
    it.each([
      ['500', httpError(500)],
      ['응답 없는 네트워크 오류', new AxiosError('Network Error')],
    ])(
      'POST %s → 오류 안내가 보이고 삭제 행이 남으며 유예 배너는 없다',
      (_label, error) => {
        const postSpy = jest.fn();
        primeMutation(mockUsePostMeDeletion, { spy: postSpy, error });
        renderPage();

        // 실행: 삭제 진입 → 1단 [계속] → 2단 [계정 삭제].
        fireEvent.press(screen.getByTestId('settings-delete-account'));
        fireEvent.press(screen.getByTestId('settings-delete-confirm'));
        fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));

        // 앵커: 요청은 실제로 나갔다(게이트 이후의 실패다).
        expect(postSpy).toHaveBeenCalledTimes(1);
        // 단언(급소): 실패를 인라인으로 알린다 — 다시 시도할 수 있다는 안내(부분포함).
        const inlineError = screen.getByTestId('settings-delete-account-error');
        expect(inlineError).toHaveTextContent(/다시 시도/);
        // 단언: 상태는 active — 삭제 행이 남고 유예 배너는 없다.
        expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
        expect(screen.queryByTestId('settings-deletion-pending')).toBeNull();
        // 단언: 다이얼로그는 닫혔다(오류는 다이얼로그 밖 설정 화면에 남는다).
        expect(
          screen.queryByTestId('settings-delete-confirm-final')
        ).toBeNull();
      }
    );

    it('짝: 요청 전에는 삭제 요청 오류 안내가 없다', () => {
      renderPage();

      expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
      expect(screen.queryByTestId('settings-delete-account-error')).toBeNull();
    });
  });

  describe('TRIP-608 · 닉네임 (AC-2 · AC-9 — AC-7·AC-8 은 아래 S3 짝 it 이 진다, TRIP-1355)', () => {
    it('AC-2: 2~20자면 PATCH 발화 + 200 시 요약 갱신', () => {
      const patchSpy = jest.fn();
      primeMutation(mockUsePatchNickname, {
        spy: patchSpy,
        onSuccessData: { nickname: '새이름', nicknameUpdatedAt: 'x' },
      });
      renderPage();

      fireEvent.press(screen.getByTestId('settings-nickname-edit'));
      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        '새이름'
      );
      fireEvent.press(screen.getByTestId('settings-nickname-save'));

      // 단언: 서버 계약대로 { data: { nickname } } 로 정확히 1회.
      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: '새이름' } });
      // 단언(완전일치): 200 뒤 요약값이 새 닉네임으로 갱신된다.
      expect(screen.getByText('새이름')).toBeOnTheScreen();
    });

    it('AC-9: 503 ModerationUnavailable → 모더레이션 불가 인라인', () => {
      primeMutation(mockUsePatchNickname, {
        spy: jest.fn(),
        error: httpError(503),
      });
      renderPage();

      fireEvent.press(screen.getByTestId('settings-nickname-edit'));
      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        '검토중이름'
      );
      fireEvent.press(screen.getByTestId('settings-nickname-save'));

      // 단언: 인라인 오류 컨테이너 + 모더레이션 계열 문구(정확 카피 미고정, 부분포함).
      expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen();
      expect(
        screen.getByText(/모더레이션|검토|확인할 수 없/)
      ).toBeOnTheScreen();
    });
  });

  /**
   * TRIP-608(잘림 고지·조회 실패) · TRIP-1422(텍스트 공유 → .json 파일 공유) — 설정 > 데이터 내보내기.
   *
   * 무엇을 보장하나: 누르면 `GET /me/export` 응답을 **그대로** `.json` 파일 하나로 캐시 전용 폴더에 써서
   * OS 공유 시트에 **파일로** 넘긴다(처리방침 §5 "파일로"). 옛 `Share.share({ message })` 텍스트 공유는 0회다.
   * 실패(조회 실패·공유 모듈 없는 빌드·쓰기/공유 실패)는 `settings-export-error` 한 자리에 문구로 알린다(INV-4).
   * 잘림 고지는 조회가 성공했으면 공유가 실패해도 남는다(01 Q5). 진행 중 다시 누르면 무시한다(01 Q6).
   *
   * 목: 페이지가 부르는 훅(조회)과 네이티브 경계 셋(파일 시스템·공유·모듈 조회 — 파일 위 jest.mock)만 바꾼다.
   * 파일을 쓰고 공유하는 실행 함수와 어댑터 파일은 진짜가 돈다.
   *
   * jest 사각(6-b 실기 iOS): 실제 파일이 생기는가 · 공유 시트가 실제로 뜨는가 · 파일 앱 저장/메일 첨부로 열리는가 ·
   *   캐시 폴더에 실제로 1개만 남는가 · 재빌드 전 빌드에서 크래시 없이 안내가 뜨는가. Android 는 미확인(01 Q8).
   *
   * 3동작 뼈대: 준비=조회 응답·파일 시스템 상태 → 실행=내보내기 행 누르기 → 단언=쓴 파일·공유 인자·화면 문구.
   */
  describe('내보내기 — 응답 JSON 을 파일로 공유한다 (INV-4)', () => {
    const EXPORT_DIR = 'trippilot-export';
    const EXPORT_FILE_NAME = 'trippilot-export-2026-08-30.json'; // makeExport 의 exportedAt 2026-08-30T00:00:00Z
    const FETCH_FAILED =
      '내보내기 정보를 불러오지 못했어요. 다시 시도해 주세요.';
    const FILE_FAILED = '내보내기 파일을 만들지 못했어요. 다시 시도해 주세요.';
    const NO_SHARE_MODULE =
      '이 앱 버전에서는 파일로 내보낼 수 없어요. 앱을 업데이트해 주세요.';

    let textShareSpy: jest.SpyInstance;

    beforeEach(() => {
      mockShareAsync.mockReset();
      mockShareAsync.mockResolvedValue(undefined);
      // 옛 텍스트 공유 — 이제는 한 번도 불리면 안 된다.
      textShareSpy = jest
        .spyOn(Share, 'share')
        .mockResolvedValue({ action: 'sharedAction' } as never);
    });

    afterEach(() => {
      textShareSpy.mockRestore();
    });

    /** 조회가 이 응답을 돌려주게 한다. 돌려준 refetch 목으로 조회 횟수를 잰다. */
    function primeExport(data: AccountExport | undefined): jest.Mock {
      const refetch = jest.fn().mockResolvedValue({ data });
      mockUseGetMeExport.mockReturnValue({ refetch });
      return refetch;
    }

    /** 바깥에서 끝낼 때까지 붙잡아 두는 Promise — "아직 진행 중"을 만든다. */
    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    function pressExport(): void {
      fireEvent.press(screen.getByTestId('settings-export-row'));
    }

    it('누르면 응답을 .json 파일 하나로 써서 그 파일을 공유 시트에 넘긴다 — 텍스트 공유는 없다', async () => {
      // 준비: 잘린 섹션이 있는 응답(파일 안에도 truncatedSections 가 남아야 한다).
      const data = makeExport({
        truncatedSections: ['photos'],
        sections: ['trips', 'photos'],
      });
      primeExport(data);
      renderPage();
      // 앵커: 누르기 전엔 쓴 파일이 하나도 없다.
      expect(cacheFileCount()).toBe(0);

      // 실행
      pressExport();

      // 단언: 공유 1회 — 인자는 방금 쓴 그 파일의 경로와 JSON 꼬리표.
      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
      const files = cacheFilesIn(EXPORT_DIR);
      expect(files.map((file) => file.name)).toEqual([EXPORT_FILE_NAME]);
      expect(JSON.parse(files[0].text)).toEqual(data);
      expect(mockShareAsync).toHaveBeenCalledWith(
        files[0].uri,
        expect.objectContaining({
          mimeType: 'application/json',
          UTI: 'public.json',
        })
      );
      expect(textShareSpy).not.toHaveBeenCalled();
    });

    it('잘린 섹션이 있으면 파일을 공유하면서 설정 행의 잘림 고지도 지금 문구 그대로 띄운다', async () => {
      primeExport(
        makeExport({
          truncatedSections: ['photos'],
          sections: ['trips', 'photos'],
        })
      );
      renderPage();

      pressExport();

      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('settings-export-truncated')).toHaveTextContent(
        '일부 항목이 잘렸어요: photos'
      );
    });

    it('잘린 섹션이 없으면 잘림 고지는 없다', async () => {
      primeExport(makeExport({ truncatedSections: [], sections: ['trips'] }));
      renderPage();

      pressExport();

      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('settings-export-truncated')).toBeNull();
    });

    it('조회가 실패하면(data 없음) 조회 실패 문구만 띄우고 파일도 공유도 만들지 않는다', async () => {
      // 준비: react-query refetch 는 실패해도 throw 하지 않고 { data: undefined } 를 resolve 한다.
      primeExport(undefined);
      renderPage();

      pressExport();

      await waitFor(() =>
        expect(screen.getByTestId('settings-export-error')).toHaveTextContent(
          FETCH_FAILED
        )
      );
      expect(screen.queryByTestId('settings-export-truncated')).toBeNull();
      expect(cacheFileCount()).toBe(0);
      expect(mockShareAsync).not.toHaveBeenCalled();
      expect(textShareSpy).not.toHaveBeenCalled();
    });

    it('이 빌드에 공유 모듈이 없으면 앱 업데이트 안내를 띄우고, 파일도 쓰지 않고 공유도 부르지 않는다', async () => {
      // 준비: 재빌드 전 dev build — ExpoSharing 조회가 null.
      mockMissingNativeModules.add('ExpoSharing');
      primeExport(makeExport({ truncatedSections: [], sections: ['trips'] }));
      renderPage();

      pressExport();

      await waitFor(() =>
        expect(screen.getByTestId('settings-export-error')).toHaveTextContent(
          NO_SHARE_MODULE
        )
      );
      // 모듈을 먼저 확인한다 — 못 보낼 파일(개인 데이터)을 기기에 남기지 않는다.
      expect(cacheFileCount()).toBe(0);
      expect(mockShareAsync).not.toHaveBeenCalled();
      // 텍스트 공유로 몰래 되돌아가지도 않는다.
      expect(textShareSpy).not.toHaveBeenCalled();
    });

    it('파일 쓰기가 실패하면 파일 실패 문구를 띄우고 공유는 부르지 않는다 — 잘림 고지는 남는다', async () => {
      failFileWrites();
      primeExport(
        makeExport({
          truncatedSections: ['photos'],
          sections: ['trips', 'photos'],
        })
      );
      renderPage();

      pressExport();

      await waitFor(() =>
        expect(screen.getByTestId('settings-export-error')).toHaveTextContent(
          FILE_FAILED
        )
      );
      expect(mockShareAsync).not.toHaveBeenCalled();
      // 조회는 성공했으니 "일부 잘림"은 여전히 사실이다(01 Q5).
      expect(screen.getByTestId('settings-export-truncated')).toHaveTextContent(
        '일부 항목이 잘렸어요: photos'
      );
    });

    it('공유 시트가 실패해도 파일 실패 문구를 띄운다 — 잘림 고지는 남는다', async () => {
      mockShareAsync.mockRejectedValueOnce(
        new Error('Another share request is being processed now.')
      );
      primeExport(
        makeExport({
          truncatedSections: ['photos'],
          sections: ['trips', 'photos'],
        })
      );
      renderPage();

      pressExport();

      await waitFor(() =>
        expect(screen.getByTestId('settings-export-error')).toHaveTextContent(
          FILE_FAILED
        )
      );
      expect(screen.getByTestId('settings-export-truncated')).toHaveTextContent(
        '일부 항목이 잘렸어요: photos'
      );
    });

    it('공유가 실패한 뒤 다시 눌러 성공하면 실패 문구가 사라진다', async () => {
      mockShareAsync.mockRejectedValueOnce(new Error('share failed'));
      primeExport(makeExport({ truncatedSections: [], sections: ['trips'] }));
      renderPage();
      pressExport();
      await waitFor(() =>
        expect(screen.getByTestId('settings-export-error')).toHaveTextContent(
          FILE_FAILED
        )
      );

      // 실행: 다시 누른다(이번엔 공유 성공).
      pressExport();

      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByTestId('settings-export-error')).toBeNull()
      );
    });

    it('이전 내보내기 파일이 남아 있어도 전용 폴더를 비우고 이번 파일 하나만 남긴다 — 다른 폴더는 건드리지 않는다', async () => {
      // 준비: 지난 내보내기 2개(다른 날 · 같은 날 이름의 낡은 내용) + 다른 기능의 캐시 파일.
      seedCacheFile(
        EXPORT_DIR,
        'trippilot-export-2026-08-01.json',
        '{"old":1}'
      );
      seedCacheFile(EXPORT_DIR, EXPORT_FILE_NAME, '{"stale":true}');
      seedCacheFile('trippilot-u10', 'state.json', 'keep');
      const data = makeExport({ truncatedSections: [], sections: ['trips'] });
      primeExport(data);
      renderPage();

      pressExport();

      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
      const files = cacheFilesIn(EXPORT_DIR);
      expect(files.map((file) => file.name)).toEqual([EXPORT_FILE_NAME]);
      expect(JSON.parse(files[0].text)).toEqual(data);
      expect(cacheFilesIn('trippilot-u10').map((file) => file.text)).toEqual([
        'keep',
      ]);
    });

    it('같은 순간 두 번 눌러도 조회와 공유는 한 번씩만 일어난다', async () => {
      // 준비: 조회를 붙잡아 첫 내보내기가 끝나지 않은 상태를 만든다.
      const fetch = deferred<{ data: AccountExport }>();
      const refetch = jest.fn(() => fetch.promise);
      mockUseGetMeExport.mockReturnValue({ refetch });
      renderPage();

      // 실행: act 하나 안에서 두 번 — 두 번째 누름은 다시 그리기 전의 같은 화면을 누른다(실기 더블탭).
      act(() => {
        pressExport();
        pressExport();
      });

      expect(refetch).toHaveBeenCalledTimes(1);
      await act(async () => {
        fetch.resolve({
          data: makeExport({ truncatedSections: [], sections: ['trips'] }),
        });
      });
      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('공유 시트가 떠 있는 동안 다시 눌러도 무시되고, 시트가 닫힌 뒤에는 다시 내보낸다', async () => {
      // 준비: 공유를 붙잡아 "시트가 떠 있는" 상태를 만든다(iOS 는 이때 또 부르면 reject 한다).
      const sheet = deferred<void>();
      mockShareAsync.mockReturnValueOnce(sheet.promise);
      const refetch = primeExport(
        makeExport({ truncatedSections: [], sections: ['trips'] })
      );
      renderPage();
      pressExport();
      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));

      // 실행 1: 시트가 떠 있는 동안 다시 누른다.
      await act(async () => {
        pressExport();
      });

      expect(refetch).toHaveBeenCalledTimes(1);
      expect(mockShareAsync).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('settings-export-error')).toBeNull();

      // 실행 2: 시트가 닫힌 뒤(공유 resolve) 다시 누른다 — 잠금이 풀려 다시 동작한다(반대 짝).
      await act(async () => {
        sheet.resolve();
      });
      pressExport();

      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(2));
      expect(refetch).toHaveBeenCalledTimes(2);
    });

    it('조회가 실패한 뒤에도 잠금이 풀려, 다시 누르면 다시 조회해 파일을 공유한다', async () => {
      const refetch = jest
        .fn()
        .mockResolvedValueOnce({ data: undefined })
        .mockResolvedValueOnce({
          data: makeExport({ truncatedSections: [], sections: ['trips'] }),
        });
      mockUseGetMeExport.mockReturnValue({ refetch });
      renderPage();
      pressExport();
      await waitFor(() =>
        expect(screen.getByTestId('settings-export-error')).toHaveTextContent(
          FETCH_FAILED
        )
      );

      pressExport();

      await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
      expect(refetch).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * TRIP-990 · S3 (#027 · D23) — 닉네임을 바꾸는 데 성공하면 "닉네임을 바꿨어요" 토스트가 뜬다.
   *
   * 규칙을 어기거나(빈 값·길이) 서버가 거절하면(409) 기존처럼 인라인 오류만 뜨고 토스트는 없다
   * (US-ONB-03 예외 — 인라인 오류). 저장 뒤 행 접기는 이번 범위 밖(01b Q7).
   *
   * 성공하면 키보드를 내린다(`Keyboard.dismiss`) — 닉네임 입력칸은 저장 뒤에도 포커스를 쥐고 있어서,
   * 키보드가 남으면 화면 아래쪽 토스트를 덮는다(03b 경고-1, 오케 판정). 실패면 고쳐 쓰도록 입력을 유지한다.
   *
   * 뮤테이션 목이 onSuccess/onError 를 동기로 부르므로(위 `primeMutation`) 비동기 대기 없이 바로 잰다.
   * "키보드가 떠 있을 때 첫 탭이 버튼에 닿는가"·"토스트가 키보드에 안 가리는가"는 jest 사각 — 6-b 실기.
   *
   * 3동작 뼈대: 준비=PATCH 성공/실패 목 → 실행=편집·입력·저장 → 단언=토스트·인라인 오류.
   */
  describe('🔴 S3 · 닉네임 저장 성공 토스트 (#027)', () => {
    function renderPageWithToast() {
      return render(
        <QueryClientProvider client={newTestQueryClient()}>
          <WithToastHost>
            <SettingsPage />
          </WithToastHost>
        </QueryClientProvider>
      );
    }

    function submitNickname(value: string): void {
      fireEvent.press(screen.getByTestId('settings-nickname-edit'));
      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        value
      );
      fireEvent.press(screen.getByTestId('settings-nickname-save'));
    }

    // 렌더 전에 건다 — `onPress={Keyboard.dismiss}` 처럼 참조를 렌더 때 잡는 구현도 스파이가 본다.
    let dismiss: jest.SpyInstance;
    beforeEach(() => {
      dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    });
    afterEach(() => {
      dismiss.mockRestore();
    });

    it('PATCH 200 이면 "닉네임을 바꿨어요" 토스트가 뜬다', () => {
      const patchSpy = jest.fn();
      primeMutation(mockUsePatchNickname, {
        spy: patchSpy,
        onSuccessData: { nickname: '새이름', nicknameUpdatedAt: 'x' },
      });
      renderPageWithToast();
      // 앵커: 제출 전엔 토스트가 없다 — 뒤에서 보이는 토스트가 이번 제출이 띄운 것임을 가른다.
      expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();

      submitNickname('새이름');

      // 앵커: 이번 제출의 PATCH 가 실제로 1회 나갔다(제출을 지우면 여기서 red).
      expect(patchSpy).toHaveBeenCalledTimes(1);
      const toast = screen.getByTestId('settings-nickname-saved');
      expect(within(toast).getByText('닉네임을 바꿨어요')).toBeOnTheScreen();
    });

    it('PATCH 200 이면 키보드를 내린다 — 성공 토스트가 키보드에 가리지 않게', () => {
      const patchSpy = jest.fn();
      primeMutation(mockUsePatchNickname, {
        spy: patchSpy,
        onSuccessData: { nickname: '새이름', nicknameUpdatedAt: 'x' },
      });
      renderPageWithToast();

      submitNickname('새이름');

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(dismiss).toHaveBeenCalled();
    });

    // TRIP-608 AC-7(길이 밖 2자 미만 → PATCH 미발화 + 인라인 오류)을 흡수했다 — 빈 값과 1자 둘 다 돈다.
    it.each([[''], ['가']])(
      '짝: 길이 밖 입력(%j)이면 인라인 오류만 뜨고 토스트는 없다',
      (value) => {
        const patchSpy = jest.fn();
        primeMutation(mockUsePatchNickname, { spy: patchSpy });
        renderPageWithToast();

        submitNickname(value);

        expect(patchSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen();
        expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();
        // 실패는 고쳐 써야 하므로 키보드를 내리지 않는다.
        expect(dismiss).not.toHaveBeenCalled();
      }
    );

    it('짝: 409 로 거절되면 인라인 오류만 뜨고 토스트는 없다', () => {
      primeMutation(mockUsePatchNickname, {
        spy: jest.fn(),
        error: httpError(409),
      });
      renderPageWithToast();

      submitNickname('중복이름');

      expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen();
      // TRIP-608 AC-8 흡수 — 중복 안내 문구, 그리고 서버가 거부했으므로 요약값은 바뀌지 않는다.
      expect(screen.getByText(/이미 사용 중/)).toBeOnTheScreen();
      expect(screen.getByText('여행자123')).toBeOnTheScreen();
      expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();
      expect(dismiss).not.toHaveBeenCalled();
    });
  });

  // TRIP-1276
  /**
   * 무엇을 보장하나: 앞뒤 공백은 걷어낸 값으로 검증·전송하고, 현재 닉네임과 같은 값이면 요청 없이 행을 닫고,
   * 떠 있는 오류는 입력을 바꾸면 사라진다. 클라 검증 실패에 "잠시 후 다시 시도"(일시 실패 안내)를 쓰지 않는다.
   *
   * 보낸 값의 공백은 화면 텍스트로 재지 않는다 — RNTL 기본 normalizer 가 비교 전에 trim 해서 공백째 보내도
   * green 이 된다. 본문은 patchSpy 의 toHaveBeenCalledWith(정규화 없는 깊은 같음)로만 본다.
   * 행을 닫는 판단이 페이지에 있든 행에 있든 결과(요청 횟수·오류·입력칸 유무)만 본다.
   */
  describe('설정 닉네임 편집 — 앞뒤 공백·같은 값·입력 변경', () => {
    const TOO_SHORT = '닉네임은 2자 이상이어야 해요';
    const TOO_LONG = '닉네임은 20자 이하여야 해요';

    function renderPageWithToast() {
      return render(
        <QueryClientProvider client={newTestQueryClient()}>
          <WithToastHost>
            <SettingsPage />
          </WithToastHost>
        </QueryClientProvider>
      );
    }

    // 트리거는 토글이다 — 한 번만 누른다.
    function openEditor(): void {
      fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    }

    function typeAndSave(value: string): void {
      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        value
      );
      fireEvent.press(screen.getByTestId('settings-nickname-save'));
    }

    it.each([
      ['공백만', '     ', TOO_SHORT],
      ['공백을 걷으면 1자', ' 가 ', TOO_SHORT],
      ['1자', '가', TOO_SHORT],
      ['21자', '가'.repeat(21), TOO_LONG],
    ])(
      '클라 검증 실패(%s)면 서버로 안 보내고 길이 안내만 띄운다 — "잠시 후 다시 시도"가 아니다',
      (_title, input, message) => {
        // 준비: 요청이 새면 서버가 400(@NotBlank·길이)을 돌려준다 — 새면 일시 실패 문구가 떠서 들킨다.
        const patchSpy = jest.fn();
        primeMutation(mockUsePatchNickname, {
          spy: patchSpy,
          error: httpError(400),
        });
        renderPageWithToast();

        openEditor();
        typeAndSave(input);

        expect(patchSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
          message
        );
        expect(screen.queryByText(/잠시 후 다시 시도/)).toBeNull();
      }
    );

    it.each([
      ['앞뒤 공백', '  새이름  ', '새이름'],
      ['탭·줄바꿈(가운데 공백은 남긴다)', '\t새 이름\n', '새 이름'],
    ])('%s을 걷어낸 값으로 PATCH 를 보낸다', (_title, input, sent) => {
      const patchSpy = jest.fn();
      primeMutation(mockUsePatchNickname, {
        spy: patchSpy,
        onSuccessData: { nickname: sent, nicknameUpdatedAt: 'x' },
      });
      renderPageWithToast();

      openEditor();
      typeAndSave(input);

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: sent } });
      expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
    });

    it('길이는 공백을 걷은 뒤에 센다 — 앞 공백 1 + 20자는 20자로 통과한다', () => {
      const twenty = '가'.repeat(20);
      const patchSpy = jest.fn();
      primeMutation(mockUsePatchNickname, {
        spy: patchSpy,
        onSuccessData: { nickname: twenty, nicknameUpdatedAt: 'x' },
      });
      renderPageWithToast();

      openEditor();
      typeAndSave(` ${twenty}`);

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: twenty } });
      expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
    });

    it('클라 검증 오류가 떠 있어도 입력을 바꾸면 오류가 사라진다(입력칸은 그대로)', () => {
      primeMutation(mockUsePatchNickname, { spy: jest.fn() });
      renderPageWithToast();
      openEditor();
      typeAndSave('가');
      // 앵커: 오류가 실제로 떠 있다 — 없으면 아래 "사라졌다"가 아무것도 안 잰다.
      expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen();

      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        '가나'
      );

      expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
      // 행을 접어서 오류를 감춘 게 아니다 — 고쳐 쓰는 중인 입력칸이 남아 있다.
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '가나'
      );
    });

    it('서버 409 오류가 떠 있어도 입력을 바꾸면 오류가 사라진다(입력칸은 그대로)', () => {
      primeMutation(mockUsePatchNickname, {
        spy: jest.fn(),
        error: httpError(409),
      });
      renderPageWithToast();
      openEditor();
      typeAndSave('중복이름');
      expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
        /이미 사용 중/
      );

      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        '중복이름2'
      );

      expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '중복이름2'
      );
    });

    it.each([
      ['손대지 않고', null],
      ['앞뒤 공백만 붙여서', ' 여행자123 '],
    ])(
      '현재 닉네임과 같은 값을 %s 저장하면 요청 없이 편집 행이 조용히 닫힌다',
      (_title, input) => {
        // 준비: 요청이 새면 성공 토스트가 떠서 들킨다.
        const patchSpy = jest.fn();
        primeMutation(mockUsePatchNickname, {
          spy: patchSpy,
          onSuccessData: { nickname: '여행자123', nicknameUpdatedAt: 'x' },
        });
        renderPageWithToast();
        openEditor();
        // 앵커: 행이 펼쳐져 있다 — 뒤의 "입력칸 없음"이 저장의 결과임을 가른다.
        expect(screen.getByTestId('settings-nickname-input')).toBeOnTheScreen();

        if (input === null) {
          fireEvent.press(screen.getByTestId('settings-nickname-save'));
        } else {
          typeAndSave(input);
        }

        expect(patchSpy).not.toHaveBeenCalled();
        expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
        expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();
        expect(screen.queryByTestId('settings-nickname-input')).toBeNull();
        expect(screen.getByText('여행자123')).toBeOnTheScreen();
      }
    );

    it.each([
      ['손대지 않은 빈 입력', null],
      ['공백만', '     '],
    ])(
      '프로필이 아직 안 왔을 때(현재 닉네임 빈 값) %s 저장은 "같다"로 닫히지 않고 길이 안내를 띄운다',
      (_title, input) => {
        // 준비: 비교를 길이 검증보다 먼저 하면 '' === '' 로 조용히 닫혀 오류가 사라진다.
        mockUseGetMeProfile.mockReturnValue({ data: undefined });
        const patchSpy = jest.fn();
        primeMutation(mockUsePatchNickname, {
          spy: patchSpy,
          error: httpError(400),
        });
        renderPageWithToast();
        openEditor();

        if (input === null) {
          fireEvent.press(screen.getByTestId('settings-nickname-save'));
        } else {
          typeAndSave(input);
        }

        expect(patchSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
          TOO_SHORT
        );
        expect(screen.getByTestId('settings-nickname-input')).toBeOnTheScreen();
      }
    );

    it('대소문자만 다른 값은 "같다"가 아니다 — 닫지 않고 PATCH 를 보낸다', () => {
      mockUseGetMeProfile.mockReturnValue({
        data: { nickname: 'Trip', nicknameUpdatedAt: '2026-01-01T00:00:00Z' },
      });
      const patchSpy = jest.fn();
      primeMutation(mockUsePatchNickname, {
        spy: patchSpy,
        onSuccessData: { nickname: 'trip', nicknameUpdatedAt: 'x' },
      });
      renderPageWithToast();

      openEditor();
      typeAndSave('trip');

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: 'trip' } });
    });
  });

  // TRIP-1305
  /**
   * 무엇을 보장하나: 닉네임 저장 요청이 진행 중인 동안 [저장]을 다시 눌러도 요청이 한 번만 나가고,
   * [저장]은 비활성·입력칸은 잠겨 있어 늦게 온 오류가 다른 값 아래 붙지 않는다. 응답이 오면(성공·실패
   * 모두) 잠금이 풀려 다시 저장할 수 있다.
   *
   * 위 `primeMutation` 은 mutate 안에서 응답을 바로 돌려 "기다리는 동안"이 없다. 여기서는 응답을
   * 붙잡아 두는 목을 쓴다 — mutate 는 요청을 쌓기만 하고, 테스트가 `respond` 를 부를 때 응답이 온다.
   * 진행 중 여부(isPending)는 목 안의 useState 로 쥔다 — 실제 react-query 처럼 요청 시작·응답 때 화면이
   * 다시 그려진다(목 구현은 페이지 렌더 중에 훅으로 불리므로 useState 를 쓸 수 있다).
   *
   * "같은 순간 두 번 누름"은 `act` 하나 안에서 press 를 두 번 부른다 — 바깥 act 가 끝나야 다시 그리므로
   * 두 번째 press 는 [저장]이 아직 활성인 같은 화면을 누른다(02a §5 실측). 그때 isPending 은 아직 false 라,
   * 화면 비활성만으로는 못 막고 페이지가 즉시 바뀌는 잠금을 쥐어야 막힌다.
   */
  describe('설정 닉네임 저장 진행 중 — 연타·입력 잠금·응답 뒤 다시 저장', () => {
    type HeldRequest = { respond: (outcome: MutationOutcome) => void };

    function primeHeldNickname(spy: jest.Mock): HeldRequest[] {
      const held: HeldRequest[] = [];
      function useHeldNicknameMutation(options?: {
        mutation?: MutationCallbacks;
      }) {
        const [inFlight, setInFlight] = useState(0);
        return {
          isPending: inFlight > 0,
          mutate: (vars: unknown, callOptions?: MutationCallbacks) => {
            spy(vars);
            setInFlight((n) => n + 1);
            held.push({
              respond: (outcome) => {
                setInFlight((n) => n - 1);
                settleCallbacks(
                  [options?.mutation, callOptions],
                  outcome,
                  vars
                );
              },
            });
          },
        };
      }
      mockUsePatchNickname.mockImplementation(useHeldNicknameMutation);
      return held;
    }

    const saved = (nickname: string): MutationOutcome => ({
      data: { nickname, nicknameUpdatedAt: 'x' },
    });

    function renderPageWithToast() {
      return render(
        <QueryClientProvider client={newTestQueryClient()}>
          <WithToastHost>
            <SettingsPage />
          </WithToastHost>
        </QueryClientProvider>
      );
    }

    function openEditor(): void {
      fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    }

    function typeInput(value: string): void {
      fireEvent.changeText(
        screen.getByTestId('settings-nickname-input'),
        value
      );
    }

    function save(): void {
      fireEvent.press(screen.getByTestId('settings-nickname-save'));
    }

    function tokens(el: { props: { className?: unknown } }): string[] {
      return String(el.props.className ?? '')
        .split(/\s+/)
        .filter(Boolean);
    }

    it('같은 순간 [저장]을 두 번 눌러도 PATCH 는 한 번만 나간다', () => {
      const patchSpy = jest.fn();
      primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      typeInput('새이름');

      act(() => {
        save();
        save();
      });

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: '새이름' } });
    });

    it('응답을 기다리는 동안 [저장]은 비활성이고, 다시 눌러도 PATCH 가 더 나가지 않는다', () => {
      const patchSpy = jest.fn();
      primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      typeInput('새이름');
      // 앵커: 요청 전엔 [저장]이 활성이다 — 아래 "비활성"이 요청 때문에 생긴 것임을 가른다.
      expect(screen.getByTestId('settings-nickname-save')).not.toBeDisabled();

      save();

      expect(screen.getByTestId('settings-nickname-save')).toBeDisabled();
      save();
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });

    it('연타 뒤 첫 요청이 성공하면 성공 토스트만 뜨고 "이미 사용 중" 오류는 없다', () => {
      const patchSpy = jest.fn();
      const held = primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      typeInput('새이름');
      expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();

      act(() => {
        save();
        save();
      });
      // 첫 요청 성공. 두 번째 요청이 새어 나갔다면 서버는 이미 내 것이 된 이름이라 409 로 거절한다.
      act(() => held[0].respond(saved('새이름')));
      act(() =>
        held.slice(1).forEach((r) => r.respond({ error: httpError(409) }))
      );

      expect(screen.getByTestId('settings-nickname-saved')).toBeOnTheScreen();
      expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
      expect(screen.queryByText(/이미 사용 중/)).toBeNull();
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });

    it('응답을 기다리는 동안 입력칸은 잠겨, 늦게 온 409 는 보낸 값 아래에만 붙는다', () => {
      const held = primeHeldNickname(jest.fn());
      renderPageWithToast();
      openEditor();
      typeInput('중복이름');
      save();

      // 응답 전에 고쳐 쓰려 한다 — 입력칸이 잠겨 값이 그대로다.
      typeInput('중복이름2');
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '중복이름'
      );

      act(() => held[0].respond({ error: httpError(409) }));

      expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
        /이미 사용 중/
      );
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '중복이름'
      );
    });

    it('성공 응답이 오면 잠금이 풀려 다른 값을 다시 저장할 수 있다', () => {
      const patchSpy = jest.fn();
      const held = primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      typeInput('새이름');
      save();

      act(() => held[0].respond(saved('새이름')));

      const saveButton = screen.getByTestId('settings-nickname-save');
      expect(saveButton).not.toBeDisabled();
      expect(tokens(saveButton)).not.toContain('opacity-40');
      typeInput('새이름2');
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '새이름2'
      );
      save();
      expect(patchSpy).toHaveBeenCalledTimes(2);
      expect(patchSpy).toHaveBeenLastCalledWith({
        data: { nickname: '새이름2' },
      });
    });

    it('409 로 실패해도 잠금이 풀려 고친 값을 다시 저장할 수 있다', () => {
      const patchSpy = jest.fn();
      const held = primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      typeInput('중복이름');
      save();

      act(() => held[0].respond({ error: httpError(409) }));
      expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
        /이미 사용 중/
      );

      typeInput('새이름');
      // TRIP-1276 동작 유지 — 입력을 바꾸면 낡은 오류가 지워진다.
      expect(screen.queryByTestId('settings-nickname-error')).toBeNull();
      expect(screen.getByTestId('settings-nickname-save')).not.toBeDisabled();
      save();
      expect(patchSpy).toHaveBeenCalledTimes(2);
      expect(patchSpy).toHaveBeenLastCalledWith({
        data: { nickname: '새이름' },
      });
    });

    it('길이 안내로 막힌 저장은 잠그지 않는다 — 고친 값은 바로 저장된다', () => {
      const patchSpy = jest.fn();
      primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      typeInput('가');
      save();
      expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
        '닉네임은 2자 이상이어야 해요'
      );

      typeInput('새이름');
      save();

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: '새이름' } });
    });

    it('같은 값이라 요청 없이 닫힌 저장은 잠그지 않는다 — 다시 열어 새 값을 저장할 수 있다', () => {
      const patchSpy = jest.fn();
      primeHeldNickname(patchSpy);
      renderPageWithToast();
      openEditor();
      save();
      // 앵커: 같은 값이라 요청 없이 행이 닫혔다(TRIP-1276).
      expect(screen.queryByTestId('settings-nickname-input')).toBeNull();

      openEditor();
      typeInput('새이름');
      save();

      expect(patchSpy).toHaveBeenCalledTimes(1);
      expect(patchSpy).toHaveBeenCalledWith({ data: { nickname: '새이름' } });
    });

    // 03b W1 — 행 머리를 접었다 펴면 입력이 현재 닉네임으로 리셋돼 입력칸 잠금을 우회했다.
    it('응답을 기다리는 동안 행 머리를 눌러도 행이 안 접히고 입력도 그대로라, 늦은 409 는 보낸 값 아래에만 붙는다', () => {
      const held = primeHeldNickname(jest.fn());
      renderPageWithToast();
      openEditor();
      typeInput('중복이름');
      save();

      // 접으려 한다 — 행이 그대로다.
      openEditor();
      expect(screen.getByTestId('settings-nickname-input')).toBeOnTheScreen();
      // 한 번 더(접혔다면 다시 펴는 누름) — 입력이 현재 닉네임으로 리셋되지 않는다.
      openEditor();
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '중복이름'
      );

      act(() => held[0].respond({ error: httpError(409) }));

      expect(screen.getByTestId('settings-nickname-error')).toHaveTextContent(
        /이미 사용 중/
      );
      expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
        '중복이름'
      );
    });

    it('응답이 끝나면 행 머리를 다시 눌러 접을 수 있다', () => {
      const held = primeHeldNickname(jest.fn());
      renderPageWithToast();
      openEditor();
      typeInput('중복이름');
      save();

      act(() => held[0].respond({ error: httpError(409) }));
      openEditor();

      expect(screen.queryByTestId('settings-nickname-input')).toBeNull();
    });
  });
});

// TRIP-886
describe('OSM 출처 링크 (옛 .attribution)', () => {
  /**
   * TRIP-886 AC-3 · Q3 — 설정 페이지의 OSM 출처 링크 배선.
   *
   * 무엇을 보장하나:
   *  - AC-3: OSM 줄을 누르면 페이지가 `expo-linking` 의 `openURL` 을 저작권 페이지 URL(완전일치)로
   *    정확히 1회 부른다. URL 은 화면이 아니라 페이지가 쥐므로 이 층에서만 잠긴다.
   *  - Q3(01b "링크 실패는 무시"): 브라우저를 못 열어 openURL 이 reject 해도 앱이 죽지 않는다.
   *
   * ★ 판정 장치(02a ★6): 처리 안 된 reject 는 jest 가 가로채 **그 테스트를 실패로** 만든다 —
   *  `process.on('unhandledRejection')` 리스너는 이 환경에서 불리지 않는다(02a §5-C 실측). 그래서 실패 삼키기
   *  테스트는 별도 리스너 없이 `await act(...)` 로 비동기를 흘려보내기만 하면 된다.
   *
   * ★ 목(02a ★5·★11): `expo-linking` 은 팩토리 목(파일 맨 위로 hoist — 팩토리 안에서 바깥 변수를 쓰지
   *  않는다). account·profile 은 자동 목이라 조회 훅 2개만 값을 채우면 렌더가 산다. 페이지가 로그아웃용
   *  `useQueryClient()` 를 부르므로 QueryClientProvider 로 감싼다(TRIP-938).
   *
   * ⚠️ jest 사각(6-b 실기 전용): 실제로 브라우저가 열리는지는 못 본다 — openURL 인자·횟수만 관측한다.
   *
   * (개념) `mockResolvedValue(x)` = 그 async 가짜가 x 로 성공, `mockRejectedValue(e)` = e 로 실패(reject).
   * (개념) `await act(async () => …)` = 안의 동작이 일으킨 상태 변경·Promise 후속 처리를 끝까지 흘려보낸 뒤
   *  다음 줄로 간다.
   */

  const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

  const mockOpenURL = Linking.openURL as jest.Mock;
  const mockUseGetMe = useGetMe as jest.Mock;
  const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

  function renderPage() {
    return render(
      <QueryClientProvider client={newTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGetMe.mockReturnValue({
      data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
    });
    mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
    primeL05Hooks();
  });

  describe('TRIP-886 · SettingsPage OSM 출처 링크 배선 (AC-3 · Q3)', () => {
    it('AC-3: OSM 줄 press → Linking.openURL("https://www.openstreetmap.org/copyright") 정확히 1회', async () => {
      // 준비: 링크 열기가 성공하는 상황.
      mockOpenURL.mockResolvedValue(true);
      renderPage();
      // 그리기만으로는 열지 않는다.
      expect(mockOpenURL).not.toHaveBeenCalled();

      // 실행: OSM 줄을 누른다.
      await act(async () => {
        fireEvent.press(screen.getByTestId('settings-osm-copyright'));
      });

      // 단언: 저작권 페이지 URL 로, 정확히 한 번.
      expect(mockOpenURL).toHaveBeenCalledTimes(1);
      expect(mockOpenURL).toHaveBeenCalledWith(OSM_COPYRIGHT_URL);
    });

    it('Q3: openURL 이 실패(reject)해도 앱이 죽지 않고 출처 문구가 그대로 남는다', async () => {
      // 준비: 브라우저를 열 수 없는 상황(열기 실패).
      mockOpenURL.mockRejectedValue(new Error('no browser'));
      renderPage();

      // 실행: OSM 줄을 누르고 비동기 실패까지 흘려보낸다(처리 안 되면 jest 가 이 테스트를 실패시킨다).
      await act(async () => {
        fireEvent.press(screen.getByTestId('settings-osm-copyright'));
      });

      // 단언: 열기를 시도했고, 화면은 살아 있다.
      expect(mockOpenURL).toHaveBeenCalledTimes(1);
      expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
    });
  });
});

// TRIP-618 · TRIP-778 · TRIP-937 · TRIP-939 · TRIP-1051
describe('진입 라우트 (옛 .nav)', () => {
  /**
   * TRIP-618 — l05 설정 진입 배선 승인 테스트(AC-2 · AC-3 · AC-4).
   *
   * 무엇을 보장하나: 위치정보·알림 네비 행을 누르면 `SettingsPage`가 주입한 `router.push`가 **정확한
   * 라우트로 1회** 나간다. 라우트 문자열(/settings/location vs /settings/notifications)은 화면이 아니라
   * 페이지가 쥐므로, 이 문자열을 잠그는 유일한 층이 여기다(SettingsScreen.test.tsx 는 네비 행 렌더만
   * 봤다). "네비 행은 떴지만 onPress 미배선/오배선" 뮤턴트는 여기 `toHaveBeenCalledWith`가 잡는다.
   *
   * ★ expo-router 목 형태(02a ★3): `SettingsPage`는 `useRouter()` 정적 import 를 안 쓴다(node 버킷
   *   ESM 크래시 회피 — 지연-require `require('expo-router').router` 싱글턴, `goBack` 선례). 그래서
   *   목도 `{ router: { push, back } }` 싱글턴 형태다 — `useRouter`는 일부러 안 넣는다(넣으면 잘못된
   *   패턴을 통과시킨다).
   *
   * ★ 목 seam(02a ★4): account·profile 을 **자동 목**해 실 훅이 안 돌아 QueryClient 불필요. GET 2훅만
   *   프라임하면 렌더가 산다 — 뮤테이션 훅은 렌더 시 클로저에만 담겨 역참조 0(02a §5-D).
   *
   * ⚠️ jest 사각(6-b 실기 전용): 실제 화면 전환(마이→설정→위치동의 3-hop)은 못 본다 — 여기선
   *   push 인자·횟수만 관측한다(02a ★8).
   *
   * (개념) 문자열 인자 매처는 완전일치 — `toHaveBeenCalledWith('/settings/location')`는 라우트를
   *  글자 그대로 잠근다(02a §5-A).
   *
   * TRIP-939 AC-1 · TRIP-778 AC-3(재작성): 페이지는 여전히 `filterReadySettingsSections` 로 준비중 행을
   *  거르지만, 취향 7·제휴·개인화가 ready:true 로 열려 운영 화면에 7그룹이 모두 보이고 "준비 중"은 없다
   *  (구 "여행 취향·제휴 그룹째 부재"는 01b 사용자 결정으로 뒤집혔다).
   *
   * TRIP-778 AC-8 · TRIP-1051 AC-4: 취향 한 행은 `/settings/preferences`(전체 편집 화면 하나 — 축 인자 없음)로,
   *  개인화 행은 `/settings/personalization` 으로 push 한다. 라우트 문자열은 페이지가 쥐므로 여기서 잠근다.
   *
   * TRIP-1051 AC-3(페이지): 취향 조회가 아직 없으면(`data: undefined`) 페이지가 그걸 그대로 넘겨 값이 비어야
   *  한다. 화면 테스트는 VM 을 직접 넣으므로 "페이지가 `data ?? {}` 로 넘겨 0/7 을 만든다"는 여기서만 잡힌다
   *  (02a ★7).
   *
   * TRIP-937 AC-3: 앱 정보 그룹의 약관 3행을 누르면 열람 라우트 `/terms/{termsType}` 로 push 한다(심사
   *  가이드라인 5.1.1(i) — 개인정보처리방침 앱 내 접근). 라우트 문자열은 페이지가 쥐므로 여기서 잠근다.
   */

  /**
   * TRIP-938 준비 단계 — 페이지가 로그아웃 때 캐시를 비우려고 `useQueryClient()` 를 부르므로
   * QueryClientProvider 안에서 그린다(없으면 "No QueryClient set" 으로 렌더가 죽는다, 02a ★5).
   * 조회 훅은 위에서 목하므로 이 클라이언트는 실제로 아무것도 가져오지 않는다.
   */
  function renderPage() {
    return render(
      <QueryClientProvider client={newTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );
  }

  const mockUseGetMe = useGetMe as jest.Mock;
  const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // 렌더가 역참조하는 것은 account.data?.status/email·profile.data?.nickname 뿐(02a §5-D).
    mockUseGetMe.mockReturnValue({
      data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
    });
    mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
    // TRIP-778 새 조회·변경 훅 — 응답 전 모양. 이 파일은 라우트만 본다(값·토글은 l05parity.integration).
    primeL05Hooks();
  });

  describe('TRIP-618 · SettingsPage 진입 배선', () => {
    it('AC-2: 위치 네비 행 press → router.push("/settings/location") 정확히 1회', () => {
      renderPage();

      // 실행: 위치정보 네비 행을 누른다.
      fireEvent.press(screen.getByTestId('settings-nav-location-consent'));

      // 단언: l06 위치동의 라우트로, 정확히 한 번(중복 push·오배선 차단).
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings/location');
    });

    it('AC-3: 알림 네비 행 press → router.push("/settings/notifications") 정확히 1회', () => {
      renderPage();

      fireEvent.press(screen.getByTestId('settings-nav-notifications'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings/notifications');
    });

    it('TRIP-939 AC-1 · TRIP-778 AC-3(재작성): 운영 화면에 7그룹이 모두 보이고 "준비 중"은 없다', () => {
      // 준비·실행: 실 페이지를 그린다(페이지가 ready 필터를 거쳐 화면에 넘긴다).
      renderPage();

      const labels = [
        '계정',
        null, // TRIP-1051 — 여행 취향 그룹은 머리글 없음(행으로 확인)
        '위치정보',
        '알림',
        '제휴 안내',
        '앱 정보',
        '위험 영역',
      ];
      // 단언: 7그룹이 정본 순서로 있다(i번째 그룹 안에 i번째 라벨, 완전일치).
      const groups = screen.getAllByTestId('settings-group');
      expect(groups).toHaveLength(7);
      labels.forEach((label, i) => {
        if (label === null) {
          // 머리글 없는 칸: 그 자리에 취향 행이 있고, '여행 취향' 글자는 행 라벨 1개뿐이다.
          expect(
            within(groups[i]).getByTestId('settings-nav-preferences')
          ).toBeOnTheScreen();
          expect(within(groups[i]).getAllByText('여행 취향')).toHaveLength(1);
        } else {
          expect(within(groups[i]).getByText(label)).toBeOnTheScreen();
        }
      });
      // 단언(부분포함): 준비 중 표기는 어디에도 없다(TRIP-939 — 심사 2.1).
      expect(screen.queryByText(/준비 중/)).toBeNull();
    });

    it('TRIP-1051 AC-4: 취향 한 행 press → router.push("/settings/preferences") 정확히 1회', () => {
      renderPage();

      // 실행
      fireEvent.press(screen.getByTestId('settings-nav-preferences'));

      // 단언: 전체 편집 화면 하나로(축을 URL 에 싣지 않는다), 정확히 한 번.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings/preferences');
    });

    it('TRIP-1051 AC-3(페이지): 취향 응답이 없으면 행은 있지만 "N/7"을 지어내지 않는다', () => {
      // 준비: beforeEach 가 useGetMePreferences → { data: undefined }(응답 전·실패 모양)로 둔다.
      renderPage();

      // 긍정 앵커: 행은 있다.
      const row = screen.getByTestId('settings-nav-preferences');
      // 단언(부분포함): 어떤 숫자든 "/7" 이 없다 — 페이지가 {} 로 채워 넘기면 "0/7 설정됨"이 떠서 red.
      expect(within(row).queryByText(/\/7/)).toBeNull();
    });

    it('TRIP-778 AC-8: 개인화 행 press → router.push("/settings/personalization") 정확히 1회', () => {
      renderPage();

      fireEvent.press(screen.getByTestId('settings-nav-personalization'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings/personalization');
    });

    it.each([['TERMS_OF_SERVICE'], ['PRIVACY_POLICY'], ['LOCATION_TERMS']])(
      'TRIP-937 AC-3: 약관 행(%s) press → router.push("/terms/<termsType>") 정확히 1회',
      (termsType) => {
        // 준비: 실 페이지(필터 통과한 운영 목록).
        renderPage();

        // 실행: 앱 정보 그룹의 약관 행을 누른다.
        fireEvent.press(screen.getByTestId(`settings-nav-terms-${termsType}`));

        // 단언: 열람 라우트(동적 세그먼트)로, 문자열 그대로 정확히 한 번.
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith(`/terms/${termsType}`);
      }
    );
  });
});

// TRIP-835
describe('삭제·철회 ↔ 푸시 토큰 (옛 .push)', () => {
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
      <QueryClientProvider client={newTestQueryClient()}>
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
    primeL05Hooks();
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
});

// TRIP-935
describe('버전 줄 출처 (옛 .version)', () => {
  /**
   * TRIP-935 AC-3(R4) — 설정 하단 버전 줄의 값 출처.
   *
   * 무엇을 보장하나:
   *  - 페이지가 빌드에 박힌 설정값(`Constants.expoConfig.version`)을 그대로 화면에 내린다 — 스토어
   *    버전과 앱 안 표기가 한 출처(app.config)에서 온다(2.3).
   *  - 값이 없으면(expoConfig 없음·version 없음) 버전 줄이 없다 — 가짜 숫자로 채우지 않는다(INV-4).
   *
   * 목: `expo-constants` 는 게터로 둬 테스트마다 값을 바꾼다(02a ★6). 페이지가 정적 import 하는
   * `expo-linking` 도 끊는다(02a ★7). account·profile 은 자동 목에 조회 훅 2개만 값을 채운다.
   */

  const mockUseGetMe = useGetMe as jest.Mock;
  const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

  function renderPage() {
    return render(
      <QueryClientProvider client={newTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );
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
});
