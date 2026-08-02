import { http, HttpResponse } from 'msw';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import {
  resetOnboardingScenario,
  setOnboardingScenario,
} from '@/test-support/onboardingScenarios';
import { TermsPage } from './TermsPage';

/**
 * AC A3 · A4 · A5 · A6 · A7 · A8 · C4 — 약관 동의 배선 통합테스트.
 *
 * 무엇을 보장하나: 실제 사용자 조작(체크박스 탭 → '다음' 탭)이 훅·화면·axios·MSW 까지
 * 실제 경로를 타고 흘러, (1) 활성 조건이 **필수 항목만**으로 계산되고, (2) 전체동의가 양방향으로
 * 동기화되며, (3) 서버에는 **서버가 준 약관 버전**이 그대로 되돌아가고, (4) 저장 실패가
 * 조용히 넘어가지 않는가.
 *
 * 왜 통합 버킷인가: A5·A6 는 "여러 체크박스 사이의 상태 동기화"라 props 를 손으로 세워서는
 * 검증되지 않는다 — 진짜 탭을 눌러야 관찰된다. 이 스위트는 flag 없이 도는 `.integration.test`
 * 버킷이다(MSW 는 ESM 이라 --experimental-vm-modules 아래서 못 뜬다).
 *
 * 3동작: 준비(시나리오 set + 렌더) → 실행(체크박스/다음 탭) → 단언(화면 상태 / 요청 바디 / 라우팅).
 */

// 토큰 저장은 네이티브 secure-store 라 목킹 — 이 스위트의 관심사는 axios→MSW 경로다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref' }),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// expo-router 는 라우터 컨텍스트 없이 이동만 관찰하면 되므로 목킹한다.
jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back: jest.fn() }),
    router: { replace, push, back: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  replace: jest.Mock;
  push: jest.Mock;
};

/** 어떤 이동 API 를 썼든(replace/push) 목적지 문자열을 한데 모은다. */
function navigationTargets(): string[] {
  return [...routerMock.replace.mock.calls, ...routerMock.push.mock.calls].map(
    (call) => String(call[0])
  );
}

const BASE = 'http://localhost:8080/api/v1';

const ROW = {
  service: 'onboarding-terms-TERMS_OF_SERVICE',
  privacy: 'onboarding-terms-PRIVACY_POLICY',
  marketing: 'onboarding-terms-MARKETING',
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  setOnboardingScenario('onboarding-happy');
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
});

afterEach(() => {
  server.resetHandlers();
  resetOnboardingScenario();
});

afterAll(() => server.close());

/** 약관 목록이 서버에서 도착해 행이 그려질 때까지 기다린다. */
async function renderLoaded() {
  render(<TermsPage />);
  await waitFor(() =>
    expect(screen.getByTestId(ROW.service)).toBeOnTheScreen()
  );
}

describe('TermsPage — 활성 조건은 필수 항목만 (AC A3 · A4)', () => {
  it('필수 2종을 모두 체크하면 마케팅 미체크라도 다음이 열린다 (A3)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId(ROW.service));
    fireEvent.press(screen.getByTestId(ROW.privacy));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled()
    );
    // 선택 항목은 활성 조건에 기여하지 않는다 — 체크되지 않은 채로도 진행 가능하다.
    expect(screen.getByTestId(ROW.marketing)).not.toBeChecked();
  });

  it('마케팅(선택)만 체크하면 다음은 여전히 잠겨 있다 (A4)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId(ROW.marketing));

    await waitFor(() =>
      expect(screen.getByTestId(ROW.marketing)).toBeChecked()
    );
    expect(screen.getByTestId('onboarding-terms-next')).toBeDisabled();
  });
});

describe('TermsPage — 전체 동의 양방향 동기화 (AC A5 · A6)', () => {
  it('전체 동의를 누르면 필수·선택 모든 행이 체크되고 다음이 열린다 (A5)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));

    await waitFor(() => expect(screen.getByTestId(ROW.service)).toBeChecked());
    expect(screen.getByTestId(ROW.privacy)).toBeChecked();
    expect(screen.getByTestId(ROW.marketing)).toBeChecked();
    expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled();
  });

  it('전체 동의가 켜진 상태에서 개별 1개를 해제하면 전체 동의도 풀리고 나머지는 유지된다 (A6)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-agreeall')).toBeChecked()
    );

    fireEvent.press(screen.getByTestId(ROW.marketing));

    await waitFor(() =>
      expect(screen.getByTestId(ROW.marketing)).not.toBeChecked()
    );
    // 전체 동의는 "모두 체크됨"의 표시이므로 하나라도 풀리면 함께 풀려야 한다.
    expect(screen.getByTestId('onboarding-terms-agreeall')).not.toBeChecked();
    // 그러나 개별 상태는 말없이 초기화되면 안 된다.
    expect(screen.getByTestId(ROW.service)).toBeChecked();
    expect(screen.getByTestId(ROW.privacy)).toBeChecked();
  });
});

describe('TermsPage — 동의 제출 (AC A7 · C4)', () => {
  it('다음을 누르면 체크된 항목이 서버가 준 약관 버전 그대로 GRANT 로 제출된다 (BR-U0-12)', async () => {
    let submitted: unknown = null;
    server.use(
      http.post(`${BASE}/me/consents`, async ({ request }) => {
        submitted = await request.json();
        return new HttpResponse(null, { status: 200 });
      })
    );

    await renderLoaded();
    fireEvent.press(screen.getByTestId(ROW.service));
    fireEvent.press(screen.getByTestId(ROW.privacy));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled()
    );

    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    await waitFor(() => expect(submitted).not.toBeNull());
    // 버전은 GET /terms 가 준 값(1.4 · 2.1)이어야 한다. 클라가 '1.0' 을 하드코딩하면 증적이 무효다.
    expect(submitted).toEqual({
      consents: [
        { termsType: 'TERMS_OF_SERVICE', termsVersion: '1.4', action: 'GRANT' },
        { termsType: 'PRIVACY_POLICY', termsVersion: '2.1', action: 'GRANT' },
      ],
    });
  });

  it('마케팅까지 동의하면 같은 제출에 MARKETING 이 함께 담긴다 (D8 — 1회 호출)', async () => {
    let submitted: { consents?: { termsType: string }[] } | null = null;
    server.use(
      http.post(`${BASE}/me/consents`, async ({ request }) => {
        submitted = (await request.json()) as {
          consents: { termsType: string }[];
        };
        return new HttpResponse(null, { status: 200 });
      })
    );

    await renderLoaded();
    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled()
    );

    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.consents!.map((c) => c.termsType)).toEqual([
      'TERMS_OF_SERVICE',
      'PRIVACY_POLICY',
      'MARKETING',
    ]);
  });

  it('저장에 성공하면 닉네임 단계로 이동한다 (C4)', async () => {
    await renderLoaded();
    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled()
    );

    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    await waitFor(() =>
      expect(navigationTargets().some((t) => /nickname/.test(t))).toBe(true)
    );
  });
});

describe('TermsPage — 저장 실패 (AC A8 · INV-4)', () => {
  it('서버 오류면 다음 단계로 넘어가지 않고 오류를 표시하며 재시도할 수 있다', async () => {
    setOnboardingScenario('onboarding-consent-error');

    await renderLoaded();
    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled()
    );

    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-error')).toBeOnTheScreen()
    );
    // 조용한 실패 금지 — 오류를 보여줄 뿐 아니라 다음 단계로 새어 나가지 않아야 한다.
    expect(navigationTargets().some((t) => /nickname/.test(t))).toBe(false);
    expect(screen.getByTestId('onboarding-terms-retry')).toBeOnTheScreen();
  });
});
