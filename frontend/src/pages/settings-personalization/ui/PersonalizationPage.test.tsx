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
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { patchConsent, fetchTerms } from '@/shared/api';
import type { TermsVersion } from '@/shared/api';
import { useGetMePersonalization } from '@/shared/api/generated/reflection/reflection';
import type { PersonalizationInfo } from '@/shared/api/generated/schemas';

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
  const client = new QueryClient();
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
