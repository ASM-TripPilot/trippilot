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
 * AC A3 · A4 · A5 · A6 · A7 · A8 · C4 — 약관 동의 배선 통합테스트 (BR-U0-10·11 정합, TRIP-366).
 *
 * 무엇을 보장하나: 실제 사용자 조작(체크박스 탭 → '다음' 탭)이 훅·화면·axios·MSW 까지
 * 실제 경로를 타고 흘러, (1) 서버가 6종을 줘도 화면엔 **필수 3종만** 그려지고, (2) 활성 조건이
 * 그 3종 전부 체크로 계산되며, (3) 전체동의가 양방향 동기화되고, (4) 서버에는 **서버가 준 약관 버전**이
 * 그대로 되돌아가고, (5) 저장 실패가 조용히 넘어가지 않는가.
 *
 * 왜 통합 버킷인가: 필터(6→3)와 A5·A6 상태 동기화는 props 를 손으로 세워서는 검증되지 않는다 —
 * 진짜 GET /terms 응답을 받고 진짜 탭을 눌러야 관찰된다. 이 스위트는 flag 없이 도는
 * `.integration.test` 버킷이다(MSW 는 ESM 이라 --experimental-vm-modules 아래서 못 뜬다).
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
  location: 'onboarding-terms-LOCATION_TERMS',
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

describe('TermsPage — 서버 6종에서 필수 3종만 노출 (BR-U0-11)', () => {
  it('서버가 6종을 줘도 서비스·개인정보·위치 3행만 그려진다', async () => {
    await renderLoaded();

    expect(screen.getByTestId(ROW.service)).toBeOnTheScreen();
    expect(screen.getByTestId(ROW.privacy)).toBeOnTheScreen();
    expect(screen.getByTestId(ROW.location)).toBeOnTheScreen();
  });

  it('마케팅·GPS기록·개인화는 어떤 형태로도 화면에 나타나지 않는다 (BR-U0-11)', async () => {
    await renderLoaded();

    expect(screen.queryByTestId('onboarding-terms-MARKETING')).toBeNull();
    expect(screen.queryByTestId('onboarding-terms-GPS_RECORDING')).toBeNull();
    expect(screen.queryByTestId('onboarding-terms-PERSONALIZATION')).toBeNull();
    // 라벨 폴백(원시 코드 노출)이 구조적으로 불가능함을 확인 — 코드 문자열이 텍스트로 새지 않는다.
    expect(screen.queryByText('GPS_RECORDING')).toBeNull();
    expect(screen.queryByText('PERSONALIZATION')).toBeNull();
    expect(screen.queryByText('LOCATION_TERMS')).toBeNull();
  });

  it('필수 3종은 BR 정본 라벨로 그려지고, 어떤 termsType 원시 코드도 텍스트로 새지 않는다 (BR-U0-10 · 라벨 폴백 방어)', async () => {
    // 무엇을 보장하나: 라벨은 `TERMS_LABELS[type] ?? term.termsType` 폴백을 탄다. 필수 3종 중
    // 하나라도 라벨 상수에서 빠지면 그 자리에 원시 코드(TERMS_OF_SERVICE 등)가 그대로 노출된다.
    // 지금까지 이 폴백은 LOCATION_TERMS 부재만 봤고 TOS·PRIVACY 는 무판정이었다(TRIP-375).
    await renderLoaded();

    // 긍정 짝 — BR-U0-10 정본 문구가 실제로 화면에 있다. 없으면 아래 부정 단언이 공허해진다.
    expect(screen.getByText('서비스 이용약관')).toBeOnTheScreen();
    expect(screen.getByText('개인정보 수집·이용')).toBeOnTheScreen();
    expect(screen.getByText('위치기반서비스')).toBeOnTheScreen();

    // 부정 짝 — 세 종의 원시 코드는 어떤 형태로도 텍스트에 없다. 라벨 상수에서 한 종을
    // 지우면(폴백이 원시 코드로 떨어지면) 이 짝이 red 를 낸다.
    expect(screen.queryByText('TERMS_OF_SERVICE')).toBeNull();
    expect(screen.queryByText('PRIVACY_POLICY')).toBeNull();
    expect(screen.queryByText('LOCATION_TERMS')).toBeNull();
  });
});

describe('TermsPage — 활성 조건은 필수 3종 전부 (AC A3 · A4 · BR-U0-10)', () => {
  it('서비스·개인정보만 체크하면 위치 미체크라 다음은 여전히 잠긴다 (A4)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId(ROW.service));
    fireEvent.press(screen.getByTestId(ROW.privacy));

    await waitFor(() => expect(screen.getByTestId(ROW.privacy)).toBeChecked());
    // 위치기반서비스도 필수다(BR-U0-10) — 빠지면 다음이 열려선 안 된다.
    expect(screen.getByTestId(ROW.location)).not.toBeChecked();
    expect(screen.getByTestId('onboarding-terms-next')).toBeDisabled();
  });

  it('필수 3종을 모두 체크하면 다음이 열린다 (A3)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId(ROW.service));
    fireEvent.press(screen.getByTestId(ROW.privacy));
    fireEvent.press(screen.getByTestId(ROW.location));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled()
    );
  });
});

describe('TermsPage — 전체 동의 양방향 동기화 (AC A5 · A6)', () => {
  it('전체 동의를 누르면 3종 모두 체크되고 다음이 열린다 (A5)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));

    await waitFor(() => expect(screen.getByTestId(ROW.service)).toBeChecked());
    expect(screen.getByTestId(ROW.privacy)).toBeChecked();
    expect(screen.getByTestId(ROW.location)).toBeChecked();
    expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled();
  });

  it('전체 동의가 켜진 상태에서 개별 1개를 해제하면 전체 동의도 풀리고 나머지는 유지된다 (A6)', async () => {
    await renderLoaded();

    fireEvent.press(screen.getByTestId('onboarding-terms-agreeall'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-terms-agreeall')).toBeChecked()
    );

    fireEvent.press(screen.getByTestId(ROW.location));

    await waitFor(() =>
      expect(screen.getByTestId(ROW.location)).not.toBeChecked()
    );
    // 전체 동의는 "모두 체크됨"의 표시이므로 하나라도 풀리면 함께 풀려야 한다.
    expect(screen.getByTestId('onboarding-terms-agreeall')).not.toBeChecked();
    // 그러나 개별 상태는 말없이 초기화되면 안 된다.
    expect(screen.getByTestId(ROW.service)).toBeChecked();
    expect(screen.getByTestId(ROW.privacy)).toBeChecked();
  });
});

describe('TermsPage — 동의 제출 (AC A7 · C4)', () => {
  it('다음을 누르면 필수 3종이 서버가 준 약관 버전 그대로 GRANT 로 제출된다 (BR-U0-12)', async () => {
    let submitted: unknown = null;
    server.use(
      http.post(`${BASE}/me/consents`, async ({ request }) => {
        submitted = await request.json();
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
    // 버전은 GET /terms 가 준 값(1.4 · 2.1 · 1.1)이어야 한다. 클라가 '1.0' 을 하드코딩하면 증적이 무효다.
    // 노출하지 않는 3종(MARKETING·GPS·PERSONALIZATION)은 담기지 않는다 — 사용자가 선언하지 않은 증적 금지(BR-U0-12).
    expect(submitted).toEqual({
      consents: [
        { termsType: 'TERMS_OF_SERVICE', termsVersion: '1.4', action: 'GRANT' },
        { termsType: 'PRIVACY_POLICY', termsVersion: '2.1', action: 'GRANT' },
        { termsType: 'LOCATION_TERMS', termsVersion: '1.1', action: 'GRANT' },
      ],
    });
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
