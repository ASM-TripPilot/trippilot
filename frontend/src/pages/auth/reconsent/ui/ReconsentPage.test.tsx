// 손수 API 계층을 통째로 목한다(PersonalizationPage 선례) — 재동의가 부르는 것은 부트스트랩(대상 목록)·
// 약관 목록(현행 버전)·단건 동의 PATCH 셋이다. PATCH body 2필드 계약은 patchConsent.test.ts 가 실 함수로
// 따로 잠근다 — 여기서는 **호출 인자**(termsType · 서버가 준 version · 'GRANT')만 본다.
jest.mock('@/shared/api', () => ({
  fetchBootstrap: jest.fn(),
  fetchTerms: jest.fn(),
  patchConsent: jest.fn(),
}));

// 부트스트랩 재평가 신호(pub/sub)를 목으로 바꿔 발화 여부·순서를 관찰한다(PrefStep2Page 선례).
// 실물 몸통은 bootstrapReeval.test.ts 가 따로 잠근다.
jest.mock('@/shared/bootstrap/bootstrapReeval', () => ({
  notifyBootstrapReeval: jest.fn(),
  subscribeBootstrapReeval: jest.fn(() => () => {}),
}));

// 라우터 — useRouter()·router 싱글턴 두 형태가 같은 fn 을 공유한다(02a ★1).
jest.mock('expo-router', () => {
  const push = jest.fn();
  const replace = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, replace, back }),
    router: { push, replace, back },
  };
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { fetchBootstrap, fetchTerms, patchConsent } from '@/shared/api';
import type { BootstrapResponse, TermsVersion } from '@/shared/api';
import { notifyBootstrapReeval } from '@/shared/bootstrap/bootstrapReeval';

import { ReconsentPage } from '..';

/**
 * TRIP-937 · 약관 재동의 화면 배선 (AC-5 · AC-6 · AC-7 · AC-8 · 01b 확정 결정 Q3 · BR-U0-14 · BR-U0-12 · INV-4).
 *
 * 무엇을 보장하나:
 *  - AC-5: 부트스트랩이 "재동의 필요"로 보낸 약관(`reconsent.termsTypes`)과 `GET /terms` 목록의 **교집합**을
 *    체크 목록으로 그리고, 전부 체크한 뒤 동의하면 타입마다 `PATCH /me/consents/{termsType}` 를
 *    **서버가 준 버전 그대로** GRANT 로 보낸다. 전부 성공한 **뒤에만** 재평가 신호를 보내고 `/` 로 replace 해
 *    다음 분기로 빠져나간다(PrefStep2 선례: 신호 → replace).
 *  - AC-6: 하나라도 체크하지 않았으면 동의 버튼이 비활성이고, 눌러도 PATCH·신호·이동이 0이다.
 *    화면이 뜬 직후에도(동의 전) 이동은 0이다 — 미리 체크된 상태로 시작하지도 않는다.
 *  - AC-7(INV-4): 저장이 실패하면(전부든 일부든) 오류와 재시도가 보이고 신호·이동은 0이다.
 *  - AC-8: 행의 "보기"는 열람 라우트 `/terms/{termsType}` 로 push 한다(읽고 동의하기).
 *  - Q3(01b): 교집합이 비거나 대상 조회가 실패하면 **통과시키지 않고** 오류와 재시도를 보인다.
 *
 * 3동작 뼈대: 준비(부트스트랩·약관 목 응답) → 실행(체크·동의·보기·재시도 press) → 단언(호출 인자·순서·화면).
 *
 * ★ 버전은 타입마다 다르게 둔다(02a ★4) — '1.0' 일색이면 하드코딩 구현도 통과한다.
 * ★ 순서는 `mock.invocationCallOrder` 로 잰다(02a ★5) — "저장 성공 → 신호 → 이동" 을 관측 가능하게.
 * ★ 부정 단언 앞에는 `flush()`(02a ★7) — 동의 핸들러는 비동기라 press 직후 동기 시점엔 무엇도 안 불린다.
 *
 * (개념) `mock.invocationCallOrder[0]` — jest 가 모든 목 호출에 매기는 전역 순번. 두 목의 순번을 비교하면
 *  어느 쪽이 먼저 불렸는지 알 수 있다.
 * (개념) `act(async () => {})` — 대기 중인 Promise 후속 처리(마이크로태스크)를 비우고 화면 갱신까지 반영한다.
 *
 * ⚠️ jest 사각(6-b 실기 전용): replace('/') 뒤 `Stack.Protected` 문이 실제로 바뀌어 홈에 도착하는지는
 *  못 본다 — 여기선 "신호 1회 + replace 1회 + 순서" 까지다(01 맹점 ①). "보기" 중첩 Pressable 에서
 *  부모 토글이 함께 도는지도 jest 로는 안 보인다(02a ★12).
 */

const mockFetchBootstrap = fetchBootstrap as jest.Mock;
const mockFetchTerms = fetchTerms as jest.Mock;
const mockPatch = patchConsent as jest.Mock;
const mockNotify = notifyBootstrapReeval as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  replace: jest.Mock;
  back: jest.Mock;
};

/** openapi TermsVersion 6종 — 버전을 일부러 다르게 둔다(02a ★4, handlers.ts 와 같은 값). */
const TERMS: TermsVersion[] = [
  term('TERMS_OF_SERVICE', '1.4'),
  term('PRIVACY_POLICY', '2.1'),
  term('LOCATION_TERMS', '1.1'),
  term('MARKETING', '1.2'),
  term('GPS_RECORDING', '1.0'),
  term('PERSONALIZATION', '1.0'),
];

function term(termsType: string, version: string): TermsVersion {
  return {
    termsType,
    version,
    body: `${termsType} 본문`,
    effectiveAt: '2026-09-01T00:00:00Z',
    reconsentRequired: true,
  };
}

/** openapi BootstrapResponse — 재동의 분기 응답. */
function bootstrapWith(termsTypes: string[]): BootstrapResponse {
  return {
    appUpdate: { status: 'NONE', minSupportedVersion: '1.0.0' },
    reconsent: { required: true, termsTypes },
    session: { state: 'AUTHENTICATED', onboardingCompleted: true },
  };
}

/** axios 400(구버전 등) 모양의 실패. */
function http400() {
  return Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    response: { status: 400 },
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReconsentPage />
    </QueryClientProvider>
  );
}

/** 대상 행이 그려질 때까지 기다린다. */
async function waitForItem(termsType: string) {
  await waitFor(() =>
    expect(screen.getByTestId(`reconsent-item-${termsType}`)).toBeOnTheScreen()
  );
}

/** 대기 중인 비동기 후속(마이크로태스크)을 비운다 — 부정 단언이 공허해지지 않게(02a ★7). */
async function flush() {
  await act(async () => {});
}

/** 이동·신호가 하나도 없었다. */
function expectNoExit() {
  expect(mockNotify).not.toHaveBeenCalled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(routerMock.push).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  // API 목은 구현·Once 대기열까지 비운다 — 한 테스트의 미소비 Once 가 다음 테스트로 새지 않게.
  mockFetchBootstrap.mockReset();
  mockFetchTerms.mockReset();
  mockPatch.mockReset();
  mockFetchTerms.mockResolvedValue(TERMS);
  mockPatch.mockResolvedValue(undefined);
});

describe('TRIP-937 AC-5 · 재동의 → 탈출 (BR-U0-14 · BR-U0-12)', () => {
  it('대상 1건을 체크하고 동의하면 서버 버전 그대로 PATCH → 재평가 신호 → replace("/") 순서로 나간다', async () => {
    // 준비: 개인정보 처리방침만 재동의 대상.
    mockFetchBootstrap.mockResolvedValue(bootstrapWith(['PRIVACY_POLICY']));
    renderPage();
    await waitForItem('PRIVACY_POLICY');

    // 단언: 동의 전에는 어디로도 나가지 않는다. 미리 체크돼 있지도 않다.
    await flush();
    expectNoExit();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('reconsent-item-PRIVACY_POLICY')
    ).not.toBeChecked();
    expect(screen.getByTestId('reconsent-agree')).toBeDisabled();

    // 실행 1: 체크.
    fireEvent.press(screen.getByTestId('reconsent-item-PRIVACY_POLICY'));

    // 단언: 체크가 켜지고 동의가 열린다.
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-item-PRIVACY_POLICY')).toBeChecked()
    );
    expect(screen.getByTestId('reconsent-agree')).not.toBeDisabled();

    // 실행 2: 동의.
    fireEvent.press(screen.getByTestId('reconsent-agree'));

    // 단언: 다음 분기로 replace 한 번.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    expect(routerMock.replace).toHaveBeenCalledWith('/');
    expect(routerMock.push).not.toHaveBeenCalled();
    // 단언: 서버가 준 현행 버전('2.1') 그대로, 단건 PATCH 로(채널 RECONSENT 는 서버가 추론).
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith('PRIVACY_POLICY', '2.1', 'GRANT');
    // 단언: 재평가 신호 한 번.
    expect(mockNotify).toHaveBeenCalledTimes(1);
    // 단언(순서): 저장 성공 → 신호 → 이동. 신호가 저장보다 먼저면 실패해도 게이트가 풀린다.
    const patchAt = mockPatch.mock.invocationCallOrder[0];
    const notifyAt = mockNotify.mock.invocationCallOrder[0];
    const replaceAt = routerMock.replace.mock.invocationCallOrder[0];
    expect(patchAt).toBeLessThan(notifyAt);
    expect(notifyAt).toBeLessThan(replaceAt);
  });

  it('대상이 여럿이면 교집합만 그리고, 전부 체크·동의하면 타입마다 제 버전으로 PATCH 한다', async () => {
    // 준비: 서비스 이용약관·개인정보 처리방침 두 건이 대상.
    mockFetchBootstrap.mockResolvedValue(
      bootstrapWith(['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])
    );
    renderPage();
    await waitForItem('TERMS_OF_SERVICE');

    // 단언: 대상 두 건만 그린다(긍정 짝 먼저 — 대상 밖 약관은 목록에 없다).
    expect(
      screen.getByTestId('reconsent-item-PRIVACY_POLICY')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('reconsent-item-LOCATION_TERMS')).toBeNull();
    expect(screen.queryByTestId('reconsent-item-MARKETING')).toBeNull();

    // 실행: 둘 다 체크하고 동의.
    fireEvent.press(screen.getByTestId('reconsent-item-TERMS_OF_SERVICE'));
    fireEvent.press(screen.getByTestId('reconsent-item-PRIVACY_POLICY'));
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-agree')).not.toBeDisabled()
    );
    fireEvent.press(screen.getByTestId('reconsent-agree'));

    // 단언: 두 건 각자의 서버 버전으로(순서 무관), 그 뒤 신호·이동 각 한 번.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledTimes(2);
    expect(mockPatch).toHaveBeenCalledWith('TERMS_OF_SERVICE', '1.4', 'GRANT');
    expect(mockPatch).toHaveBeenCalledWith('PRIVACY_POLICY', '2.1', 'GRANT');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });
});

describe('TRIP-937 AC-6 · 미동의 차단 (BR-U0-10)', () => {
  it('대상 두 건 중 하나만 체크하면 동의가 비활성이고, 눌러도 PATCH·신호·이동이 0이다', async () => {
    // 준비
    mockFetchBootstrap.mockResolvedValue(
      bootstrapWith(['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])
    );
    renderPage();
    await waitForItem('TERMS_OF_SERVICE');

    // 실행: 하나만 체크.
    fireEvent.press(screen.getByTestId('reconsent-item-TERMS_OF_SERVICE'));
    await waitFor(() =>
      expect(
        screen.getByTestId('reconsent-item-TERMS_OF_SERVICE')
      ).toBeChecked()
    );

    // 단언: 동의는 여전히 잠겨 있다.
    expect(screen.getByTestId('reconsent-agree')).toBeDisabled();

    // 실행: 그래도 눌러 본다.
    fireEvent.press(screen.getByTestId('reconsent-agree'));
    await flush();

    // 단언: 아무것도 나가지 않았다.
    expect(mockPatch).not.toHaveBeenCalled();
    expectNoExit();
  });
});

describe('TRIP-937 AC-7 · 저장 실패 — 성공 전에는 나가지 않는다 (INV-4)', () => {
  it('PATCH 가 400 이면 오류와 재시도가 보이고 신호·이동은 0 — 재시도가 성공하면 그때 나간다', async () => {
    // 준비: 첫 PATCH 는 400(구버전 등), 두 번째는 성공.
    mockFetchBootstrap.mockResolvedValue(bootstrapWith(['PRIVACY_POLICY']));
    mockPatch.mockRejectedValueOnce(http400());
    renderPage();
    await waitForItem('PRIVACY_POLICY');
    fireEvent.press(screen.getByTestId('reconsent-item-PRIVACY_POLICY'));
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-agree')).not.toBeDisabled()
    );

    // 실행 1: 동의 → 실패.
    fireEvent.press(screen.getByTestId('reconsent-agree'));

    // 단언: 오류와 재시도가 보이고, 게이트를 빠져나가지 않았다.
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-error')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('reconsent-retry')).toBeOnTheScreen();
    await flush();
    expectNoExit();

    // 실행 2: 재시도.
    fireEvent.press(screen.getByTestId('reconsent-retry'));

    // 단언: PATCH 가 다시 나갔고, 이번엔 성공해서 신호·이동이 각 한 번.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledTimes(2);
    expect(mockPatch).toHaveBeenLastCalledWith(
      'PRIVACY_POLICY',
      '2.1',
      'GRANT'
    );
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });

  it('여러 건 중 일부만 실패해도 오류가 보이고 신호·이동은 0이다', async () => {
    // 준비: 개인정보 처리방침만 실패(호출 순서와 무관하게 타입으로 판정).
    mockFetchBootstrap.mockResolvedValue(
      bootstrapWith(['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])
    );
    mockPatch.mockImplementation((termsType: string) =>
      termsType === 'PRIVACY_POLICY'
        ? Promise.reject(http400())
        : Promise.resolve(undefined)
    );
    renderPage();
    await waitForItem('TERMS_OF_SERVICE');
    fireEvent.press(screen.getByTestId('reconsent-item-TERMS_OF_SERVICE'));
    fireEvent.press(screen.getByTestId('reconsent-item-PRIVACY_POLICY'));
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-agree')).not.toBeDisabled()
    );

    // 실행
    fireEvent.press(screen.getByTestId('reconsent-agree'));

    // 단언: 오류 표면 + 게이트 유지.
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-error')).toBeOnTheScreen()
    );
    await flush();
    expectNoExit();
  });
});

describe('TRIP-937 Q3(01b) · 대상 목록을 못 만들면 통과시키지 않는다 (INV-4)', () => {
  it.each([
    [
      '부트스트랩 대상이 /terms 목록에 없다',
      ['PRIVACY_POLICY'],
      [term('TERMS_OF_SERVICE', '1.4')],
    ],
    ['부트스트랩 대상이 비어 있다', [], TERMS],
  ])(
    '교집합이 비면(%s) 오류와 재시도가 보이고, 동의 경로로 PATCH·신호·이동이 새지 않는다',
    async (_case, targets, terms) => {
      // 준비
      mockFetchBootstrap.mockResolvedValue(bootstrapWith(targets));
      mockFetchTerms.mockResolvedValue(terms);

      // 실행: 화면을 연다.
      renderPage();

      // 단언: 오류와 재시도가 보이고, 동의할 행은 없다.
      await waitFor(() =>
        expect(screen.getByTestId('reconsent-error')).toBeOnTheScreen()
      );
      expect(screen.getByTestId('reconsent-retry')).toBeOnTheScreen();
      expect(screen.queryByTestId('reconsent-item-PRIVACY_POLICY')).toBeNull();

      // 실행: 동의 버튼이 있다면 눌러 본다(02a ★6 — 빈 목록의 "전부 체크됨"은 공짜로 참이다).
      const agree = screen.queryByTestId('reconsent-agree');
      if (agree) fireEvent.press(agree);
      await flush();

      // 단언: 빈 목록이 "동의 완료"로 새지 않는다.
      expect(mockPatch).not.toHaveBeenCalled();
      expectNoExit();
    }
  );

  it('교집합이 비었다가 재시도에서 약관 목록이 오면 대상 행이 나타난다 (재조회가 실제로 나간다)', async () => {
    // 준비: 첫 목록에는 대상이 없고, 재시도 때는 정상 목록.
    mockFetchBootstrap.mockResolvedValue(bootstrapWith(['PRIVACY_POLICY']));
    mockFetchTerms.mockResolvedValueOnce([term('TERMS_OF_SERVICE', '1.4')]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-error')).toBeOnTheScreen()
    );

    // 실행: 재시도.
    fireEvent.press(screen.getByTestId('reconsent-retry'));

    // 단언: 약관 목록을 다시 받았고 대상 행이 나타났다.
    await waitForItem('PRIVACY_POLICY');
    expect(mockFetchTerms).toHaveBeenCalledTimes(2);
  });

  it('부트스트랩 조회가 실패하면 오류와 재시도가 보이고, 재시도가 다시 조회해 행을 되살린다', async () => {
    // 준비: 첫 부트스트랩 조회 실패, 두 번째 성공.
    mockFetchBootstrap
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue(bootstrapWith(['PRIVACY_POLICY']));
    renderPage();

    // 단언: 오류와 재시도, 게이트 유지.
    await waitFor(() =>
      expect(screen.getByTestId('reconsent-error')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('reconsent-retry')).toBeOnTheScreen();
    await flush();
    expectNoExit();

    // 실행: 재시도.
    fireEvent.press(screen.getByTestId('reconsent-retry'));

    // 단언: 부트스트랩을 다시 읽었고 대상 행이 나타났다.
    await waitForItem('PRIVACY_POLICY');
    expect(mockFetchBootstrap).toHaveBeenCalledTimes(2);
  });
});

describe('TRIP-937 AC-8 · 재동의 화면에서 약관 보기', () => {
  it('행의 보기를 누르면 열람 라우트로 push 하고, 체크·저장·탈출은 일어나지 않는다', async () => {
    // 준비
    mockFetchBootstrap.mockResolvedValue(bootstrapWith(['PRIVACY_POLICY']));
    renderPage();
    await waitForItem('PRIVACY_POLICY');

    // 실행: 보기.
    fireEvent.press(screen.getByTestId('reconsent-view-PRIVACY_POLICY'));

    // 단언: 열람 라우트로 정확히 한 번(돌아와 동의를 이어 가야 하므로 push).
    expect(routerMock.push).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith('/terms/PRIVACY_POLICY');
    // 단언(짝): 보기는 동의가 아니다.
    expect(
      screen.getByTestId('reconsent-item-PRIVACY_POLICY')
    ).not.toBeChecked();
    await flush();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
