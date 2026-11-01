import { newTestQueryClient } from '@/test-support/queryRender';
// GET 훅과 손수 API 계층을 딥 경로 목으로 치환한다 — 목이 얕으면(배럴·usePersonalization) 실 배선이
// 안 돌아 게이트가 공허해진다. getGetMePersonalizationQueryKey 는 무효화 키 원천이라 목에서도 실제 키를
// 그대로 돌려준다(reflection.ts L70-72 실측 = ['/me/personalization']).
jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetMePersonalization: jest.fn(),
  getGetMePersonalizationQueryKey: () => ['/me/personalization'],
}));

// 손수 계층 — patchConsent(변경)·fetchTerms(termsVersion 원천)만 목. @/shared/api 를 통째로 목하므로
// 실 axios/storage 로드가 아예 안 일어난다(별도 storage 목 불요).
jest.mock('@/shared/api', () => ({
  patchConsent: jest.fn(),
  fetchTerms: jest.fn(),
}));

// 라우터 — 헤더 뒤로가기 배선이 있어도 죽지 않게 고정 스텁(내비게이션 무단언).
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'back'],
  })
);

import { QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { patchConsent, fetchTerms } from '@/shared/api';
import type { TermsVersion } from '@/shared/api';
import { useGetMePersonalization } from '@/shared/api/index.hooks';
import type { PersonalizationInfo } from '@/shared/api/index.schemas';

import { PersonalizationPage } from '..';

/**
 * TRIP-612 · l05 개인화 배선 통합테스트(딥 경로 목 seam).
 *
 * 무엇을 보장하나(AC):
 *  - AC-5(철회): reason='APPLIED'(토글 ON) → 토글 press → patchConsent('PERSONALIZATION', <version>,
 *    'REVOKE') 정확히 1회 + 성공 후 GET 쿼리키 무효화(재조회 트리거).
 *  - AC-6(승낙): reason='CONSENT_MISSING'(토글 OFF) → patchConsent(..., 'GRANT') + 무효화.
 *  - AC-7(페이지측): termsType 은 patchConsent 의 **1번째 인자**(경로), body 로 안 실린다. termsVersion 은
 *    fetchTerms 의 PERSONALIZATION 항목에서 온다(다른 약관 섞여 있어도 정확히 골라야 함).
 *    (body 가 {action, termsVersion} 2필드인지는 patchConsent.test.ts 가 실 함수로 별도 잠금.)
 *
 * 왜 페이지 층인가: 이 AC 들은 훅 응답 → reason 도출 → 서버 변경 → 무효화라는 **배선**의 성질이다.
 *  화면(순수)만으로도 순수 함수만으로도 표현 못 한다.
 *
 * (개념) `jest.spyOn(client,'invalidateQueries')`: 캐시 무효화 호출을 관측. GET 훅이 목이라 실제
 *  재조회는 안 뜨므로, "무효화를 불렀나"(=재조회 트리거)로 관측한다(MyStaysPage 경고-3a 선례).
 */

const mockUseGet = useGetMePersonalization as jest.Mock;
const mockPatch = patchConsent as jest.Mock;
const mockFetchTerms = fetchTerms as jest.Mock;

/** GET /me/personalization 응답 주입(react-query 결과 shape 최소). */
function primeInfo(info: PersonalizationInfo) {
  mockUseGet.mockReturnValue({ data: info, isPending: false, isError: false });
}

/** PERSONALIZATION 아닌 약관을 섞어 필터 정확성을 잠근다 — 정답 버전은 'v7'. */
const TERMS: TermsVersion[] = [
  {
    termsType: 'TERMS_OF_SERVICE',
    version: 'v1',
    body: '',
    effectiveAt: '2026-01-01',
    reconsentRequired: false,
  },
  {
    termsType: 'PERSONALIZATION',
    version: 'v7',
    body: '',
    effectiveAt: '2026-01-01',
    reconsentRequired: false,
  },
];

function renderPage() {
  const client = newTestQueryClient();
  const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <PersonalizationPage />
    </QueryClientProvider>
  );
  return { invalidateSpy };
}

/** 무효화 호출들 중 개인화 GET 키를 무효화한 게 있는지(필터 옵션 shape 에 안 흔들리게 느슨하게). */
function invalidatedPersonalization(invalidateSpy: jest.SpyInstance): boolean {
  return invalidateSpy.mock.calls.some((call) =>
    JSON.stringify(call[0] ?? {}).includes('/me/personalization')
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchTerms.mockResolvedValue(TERMS);
  mockPatch.mockResolvedValue(undefined);
});

describe('TRIP-612 · 철회(AC-5)', () => {
  it('APPLIED(토글 ON) → 토글 press → REVOKE 1회(version=v7) + 무효화', async () => {
    primeInfo({ applied: true, reason: 'APPLIED', sharedItems: [] });
    const { invalidateSpy } = renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    // 급소: termsType 은 1번째 인자(경로), version 은 fetchTerms 의 PERSONALIZATION 항목(v7), action=REVOKE.
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('PERSONALIZATION', 'v7', 'REVOKE')
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
  });
});

describe('TRIP-612 · 승낙(AC-6)', () => {
  it('CONSENT_MISSING(토글 OFF) → 토글 press → GRANT 1회(version=v7) + 무효화', async () => {
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    const { invalidateSpy } = renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('PERSONALIZATION', 'v7', 'GRANT')
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
  });
});

// 급소(BR-U5-44): NOT_ENOUGH_RECORDS 는 **이미 동의한** 사용자(applied=false 이지만 reason≠CONSENT_MISSING)라
// 토글이 ON 이어야 하고, 누르면 REVOKE 가 나가야 한다. 이 값이 도출 두 갈래(reason≠CONSENT_MISSING vs applied)를
// 가르는 유일한 입력 — APPLIED·CONSENT_MISSING 만으로는 두 구현이 같은 결과라 급소가 무심판이 된다(code-critic 차단-1).
describe('TRIP-612 · 급소: 기록 부족(NOT_ENOUGH_RECORDS)', () => {
  it('applied=false 여도 토글 ON 유지 → press → REVOKE 1회(GRANT 아님)', async () => {
    primeInfo({
      applied: false,
      reason: 'NOT_ENOUGH_RECORDS',
      sharedItems: [],
    });
    renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    // consentOn=applied(축 혼동)면 여기서 GRANT 가 나가 red — 올바른 reason≠CONSENT_MISSING 도출만 REVOKE.
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('PERSONALIZATION', 'v7', 'REVOKE')
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1689 FV-CONSENT-01 — 개인화 동의는 법적 증적(append-only)이라 같은 GRANT 2회는 지울 수 없는 중복 행이다.
 * 서버(changeConsent)는 매번 쌓으므로 클라가 진행 중 누름을 막는다(위치 useLocationConsent inFlightRef 와 같은 잠금).
 * 형식 검증 반례: 응답 전 연타 → PATCH 2회 → 증적 GRANT 2줄(verify-fv-consent R1).
 */
describe('TRIP-1689 FV-CONSENT-01 · 진행 중 연타 잠금', () => {
  it('응답 전 토글을 두 번 눌러도 PATCH 는 1회', async () => {
    // 준비 — 토글 OFF, PATCH 는 끝나지 않는다(응답 기다리는 중).
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    mockPatch.mockReturnValue(new Promise(() => {}));
    renderPage();

    // 실행 — 같은 화면에서 연달아 두 번.
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    // 단언 — 첫 요청이 실제로 나간 뒤에도 두 번째는 없다.
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  // 03b W1 — 잠금은 재조회가 끝난 뒤에 푼다. 재조회 중 화면은 아직 옛 값(OFF)이라 다시 누르면 같은 GRANT 가
  // 또 나간다(서버는 매번 쌓는다). 해제를 재조회 앞으로 옮기는 "정리"를 막는다.
  it('PATCH 가 끝나도 다시 받기가 끝나기 전에는 다시 눌러도 PATCH 는 1회', async () => {
    // 준비 — 다시 받기(무효화)가 끝나지 않는다.
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    const { invalidateSpy } = renderPage();
    invalidateSpy.mockReturnValue(new Promise<void>(() => {}));

    // 실행 — 첫 누름이 무효화까지 간 뒤 한 번 더.
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
    await act(async () => {});
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    // 단언
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  it('짝: 앞 요청이 끝나면 잠금이 풀려 다시 누를 수 있다', async () => {
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    const { invalidateSpy } = renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
    await act(async () => {});
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2));
  });
});

/**
 * TRIP-1689 FV-CONSENT-02 — 저장 실패(응답 유실 포함)를 조용히 삼키지 않는다(INV-4). 서버가 이미 저장했을 수 있으니
 * 성공·실패 모두 끝에 조회를 무효화해 서버 값을 다시 받고, 실패면 안내를 띄운다.
 * 형식 검증 반례: 응답 유실 → 화면 꺼짐·서버 동의·안내 없음(verify-fv-consent R2).
 */
describe('TRIP-1689 FV-CONSENT-02 · 저장 실패 안내 + 실패해도 다시 받기', () => {
  it('PATCH 가 실패하면 실패 안내가 보이고 개인화 조회를 무효화한다', async () => {
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    mockPatch.mockRejectedValue(new Error('Network Error'));
    const { invalidateSpy } = renderPage();
    expect(
      screen.queryByTestId('settings-personalization-save-error')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    await waitFor(() =>
      expect(
        screen.getByTestId('settings-personalization-save-error')
      ).toBeOnTheScreen()
    );
    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
  });

  it('약관 버전을 못 찾아도 조용히 끝내지 않고 실패 안내를 띄운다', async () => {
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    mockFetchTerms.mockResolvedValue([TERMS[0]]);
    renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    await waitFor(() =>
      expect(
        screen.getByTestId('settings-personalization-save-error')
      ).toBeOnTheScreen()
    );
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('짝: 성공하면 실패 안내가 없다', async () => {
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    const { invalidateSpy } = renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
    expect(
      screen.queryByTestId('settings-personalization-save-error')
    ).toBeNull();
  });

  // 03b W2 — 안내는 다음 누름 때 걷힌다. 걷히지 않으면 재시도가 성공해도 「저장하지 못했어요」가 남는다.
  it('실패 뒤 다시 눌러 성공하면 실패 안내가 걷힌다', async () => {
    primeInfo({ applied: false, reason: 'CONSENT_MISSING', sharedItems: [] });
    mockPatch.mockRejectedValueOnce(new Error('Network Error'));
    const { invalidateSpy } = renderPage();

    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await waitFor(() =>
      expect(
        screen.getByTestId('settings-personalization-save-error')
      ).toBeOnTheScreen()
    );
    await waitFor(() =>
      expect(invalidatedPersonalization(invalidateSpy)).toBe(true)
    );
    await act(async () => {});
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByTestId('settings-personalization-save-error')
      ).toBeNull()
    );
  });
});
