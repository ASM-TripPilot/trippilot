// 손수 API 계층을 통째로 목한다 — 열람 페이지가 부르는 것은 단건 조회 하나뿐이다(02a ★3). 실 함수 본체
// (URL `/terms/{termsType}`, 무인증 baseClient)는 MSW 오라클(handlers.integration.test.ts)이 따로 잠근다.
jest.mock('@/shared/api', () => ({
  fetchTermsByType: jest.fn(),
}));

// 라우터 — useRouter()·router 싱글턴 두 형태가 **같은 fn** 을 공유한다(02a ★1: 구현 선택 자유).
// ⚠️ useLocalSearchParams 는 일부러 넣지 않는다(02a ★2) — termsType 은 라우트가 읽어 prop 으로 내린다.
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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { fetchTermsByType } from '@/shared/api';
import type { TermsVersion } from '@/shared/api';

import { TermsViewerPage } from '..';

/**
 * TRIP-937 · 약관 열람 화면 배선 (AC-2 · AC-4 · 브리프 §5 IO).
 *
 * 무엇을 보장하나:
 *  - AC-2: `GET /terms/{termsType}` 가 준 `body` 가 본문 영역(`terms-viewer-body`) **안에** 보이고, 헤더
 *    제목이 그 약관의 문서 이름(Figma c06 문구: 서비스 이용약관 · 개인정보 처리방침 · 위치정보 이용약관)이다.
 *  - AC-4(INV-4): 조회가 실패하면(네트워크·404) 빈 화면·무한 로딩이 아니라 오류와 재시도가 보이고,
 *    재시도는 조회를 **다시 보낸다**(호출 1→2).
 *  - IO: 헤더 뒤로가기는 `router.back()` 이다(온보딩·설정·재동의 어디서 열었든 원래 자리로).
 *
 * 3동작 뼈대: 준비(단건 조회 목 응답) → 실행(렌더·press) → 단언(보이는 것·호출 수).
 *
 * ★ 래퍼 QueryClientProvider(retry:false, 02a ★14) — 페이지를 useEffect 로 짜든 useQuery 로 짜든 돈다.
 *   useQuery 기본 재시도(3회·지수 지연)가 오류 표면을 늦추지 않게 끈다.
 *
 * (개념) `within(요소)` — 그 요소 **안에서만** 찾는 쿼리 묶음. 본문이 본문 영역에 있는지까지 잰다.
 * (개념) `getByText('문자열')` 은 완전일치다(RNTL matches.js, 02a §5-P3) — 제목 '개인정보 처리방침' 은
 *  본문 '개인정보 처리방침 전문 …' 에 걸리지 않는다.
 */

const mockFetch = fetchTermsByType as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  replace: jest.Mock;
  back: jest.Mock;
};

/** 타입별 서버 응답(openapi TermsVersion). 본문은 타입마다 달라 섞임을 잡는다. */
const TERMS: Record<string, TermsVersion> = {
  TERMS_OF_SERVICE: {
    termsType: 'TERMS_OF_SERVICE',
    version: '1.4',
    body: '서비스 이용약관 전문 — 제1조(목적)',
    effectiveAt: '2026-01-01T00:00:00Z',
    reconsentRequired: false,
  },
  PRIVACY_POLICY: {
    termsType: 'PRIVACY_POLICY',
    version: '2.1',
    body: '개인정보 처리방침 전문 — 제1조(수집 항목)',
    effectiveAt: '2026-03-01T00:00:00Z',
    reconsentRequired: false,
  },
  LOCATION_TERMS: {
    termsType: 'LOCATION_TERMS',
    version: '1.1',
    body: '위치정보 이용약관 전문 — 제1조(목적)',
    effectiveAt: '2026-02-15T00:00:00Z',
    reconsentRequired: false,
  },
};

function renderViewer(termsType: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TermsViewerPage termsType={termsType} />
    </QueryClientProvider>
  );
}

/** 본문 영역 안에 그 문자열(완전일치 leaf)이 있을 때까지 기다린다. */
async function waitForBody(body: string) {
  await waitFor(() =>
    expect(
      within(screen.getByTestId('terms-viewer-body')).getByText(body)
    ).toBeOnTheScreen()
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // 구현·Once 대기열까지 비운다 — 한 테스트의 미소비 Once 가 다음 테스트로 새지 않게.
  mockFetch.mockReset();
  mockFetch.mockImplementation((termsType: string) =>
    TERMS[termsType]
      ? Promise.resolve(TERMS[termsType])
      : Promise.reject(new Error('not found'))
  );
});

describe('TRIP-937 AC-2 · 약관 본문 열람', () => {
  it('서버가 준 body 가 본문 영역 안에 보이고, 헤더 제목은 문서 이름이다 (개인정보 처리방침)', async () => {
    // 준비·실행: 개인정보 처리방침 열람 화면을 연다.
    renderViewer('PRIVACY_POLICY');

    // 단언: 본문 영역 안에 서버 body 가 그대로 있다.
    await waitForBody(TERMS.PRIVACY_POLICY.body);
    // 단언(완전일치): 헤더 제목 — 심사자가 찾는 이름.
    expect(screen.getByText('개인정보 처리방침')).toBeOnTheScreen();
    // 단언: 경로 파라미터 그대로 단건 조회했다.
    expect(mockFetch).toHaveBeenCalledWith('PRIVACY_POLICY');
    // 단언(짝): 성공 화면에 오류 표면은 없다.
    expect(screen.queryByTestId('terms-viewer-error')).toBeNull();
  });

  it.each([
    ['TERMS_OF_SERVICE', '서비스 이용약관'],
    ['PRIVACY_POLICY', '개인정보 처리방침'],
    ['LOCATION_TERMS', '위치정보 이용약관'],
  ])(
    '%s 를 열면 제목이 "%s" 이고 그 약관의 본문이 보인다',
    async (termsType, title) => {
      // 준비·실행
      renderViewer(termsType);

      // 단언: 그 타입의 본문(다른 타입 본문과 섞이지 않음) + 문서 제목.
      await waitForBody(TERMS[termsType].body);
      expect(screen.getByText(title)).toBeOnTheScreen();
    }
  );

  it('헤더 뒤로가기를 누르면 router.back() 이 1회 나간다 (IO · 열어 준 자리로 복귀)', async () => {
    // 준비: 본문까지 로드된 화면.
    renderViewer('TERMS_OF_SERVICE');
    await waitForBody(TERMS.TERMS_OF_SERVICE.body);

    // 실행
    fireEvent.press(screen.getByTestId('terms-viewer-back'));

    // 단언: 뒤로 한 번. 열람은 이동의 끝이 아니다 — push·replace 는 없다.
    expect(routerMock.back).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});

describe('TRIP-937 AC-4 · 열람 실패 — 오류 + 재시도 (INV-4)', () => {
  it('네트워크 오류면 오류와 재시도가 보이고, 재시도가 조회를 다시 보내 본문을 되살린다 (호출 1→2)', async () => {
    // 준비: 첫 조회만 실패, 두 번째는 성공.
    mockFetch.mockRejectedValueOnce(new Error('Network Error'));
    renderViewer('PRIVACY_POLICY');

    // 단언: 조용히 비지 않는다 — 오류와 재시도가 보인다.
    await waitFor(() =>
      expect(screen.getByTestId('terms-viewer-error')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('terms-viewer-retry')).toBeOnTheScreen();
    // 단언(짝): 실패했는데 본문처럼 보이는 것은 없다.
    expect(screen.queryByText(TERMS.PRIVACY_POLICY.body)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 실행: 재시도.
    fireEvent.press(screen.getByTestId('terms-viewer-retry'));

    // 단언: 조회가 한 번 더 나갔고, 본문이 돌아오고, 오류는 걷혔다.
    await waitForBody(TERMS.PRIVACY_POLICY.body);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('terms-viewer-error')).toBeNull();
  });

  it('404(없는 약관)여도 무한 로딩이 아니라 오류와 재시도가 보인다', async () => {
    // 준비: axios 404 모양의 실패.
    mockFetch.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        response: { status: 404 },
      })
    );

    // 실행
    renderViewer('PRIVACY_POLICY');

    // 단언: 오류 표면 + 재시도 버튼, 본문은 없다.
    await waitFor(() =>
      expect(screen.getByTestId('terms-viewer-error')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('terms-viewer-retry')).toBeOnTheScreen();
    expect(screen.queryByText(TERMS.PRIVACY_POLICY.body)).toBeNull();
  });
});
