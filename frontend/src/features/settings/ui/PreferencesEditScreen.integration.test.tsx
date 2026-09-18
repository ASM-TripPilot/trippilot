import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { PreferenceView } from '@/shared/api/generated/schemas';

import { PreferencesEditScreen } from './PreferencesEditScreen';

/**
 * TRIP-610 · l05 취향 전체 수정 — 편집 화면 배선(GET 초기값 → 타일 → PUT 저장/400) 통합 심판.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1 GET `PreferenceView` 가 타일 선택으로 반영된다. **isNeutralDefault=true(미설정→중립
 *    파생) 축은 값이 있어도 미선택**(설정된 것처럼 보이면 저장 버그, 01b 맹점②).
 *  - 🔴 AC-2 한 축만 바꿔 저장하면 **PUT 와이어 바디에 그 축만** 실리고 안 바꾼 축은 없다. 안 바꾼
 *    축을 `null` 로 보내면(=데이터 손실) 계약상 그 축이 서버에서 리셋된다 → `not.toHaveProperty` 가
 *    null·전체전송 회귀를 red 로 잡는다(02a §5-C).
 *  - 🔴 AC-3 미설정(중립) 축도 골라서 저장할 수 있다(초기 미선택 → 선택 → PUT 포함).
 *  - 🔴 AC-4(INV-4) PUT 400 이면 저장 안 되고 인라인 오류가 뜬다(침묵·낙관확정 금지).
 *  - 🔴 AC-우선안내 "직접 설정이 분석보다 우선" 안내 한 줄이 있다(BR-U6-28 화면 사본).
 *
 * 왜 통합(MSW)인가(02a §4-★G): 화면이 실제로 GET/PUT 을 쏘고 그 **와이어 바디**를 관찰한다 —
 * 화면이 `preferenceDraft` 로 diff 를 옳게 조립해 실제로 보냈는가를 관통한다. axios 는 params·body 를
 * 어댑터 안에서 직렬화하므로 최종 바디는 msw 만 볼 수 있다. `preferenceDraft` 자체의 omit/null 엄격
 * 규칙은 `model/preferenceDraft.test.ts`(순수 단위)가 전-직렬화 층에서 따로 잠근다.
 *
 * 3동작 뼈대: 준비(GET/PUT msw 핸들러) → 실행(렌더·탭·저장) → 단언(타일 selected·나간 PUT 바디·인라인 오류).
 * 커버하지 않는 것: 선택 테두리·체크배지 픽셀·실제 터치는 jest 사각(6-b) — testID·selected·PUT 바디까지만.
 */

const mockBack = jest.fn();
const mockPush = jest.fn();

// 화면이 뒤로가기에 useRouter 를 쓸 수 있어 무해 스텁(내비게이션은 무단언).
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  router: { back: mockBack, push: mockPush },
}));

// handlers.ts 와 동일 계산(하드코딩 대신 env 경유로 mutator 와 정합, 02a §4-★F).
const BASE = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

/** 마지막 PUT /me/preferences 의 와이어 바디(직렬화 후 파싱). 안 나갔으면 null. */
let putBody: unknown = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putBody = null;
  mockBack.mockClear();
  mockPush.mockClear();
  // 인메모리 토큰 홀더 — mutator 인증 계층이 Authorization 을 붙이게 한다
  // (ItineraryEditPage.slot-time.integration 선례).
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<PreferencesEditScreen />, { wrapper: Wrapper });
}

/** GET /me/preferences 를 지정한 View 로 응답하게 건다(케이스마다 기본 픽스처를 덮는다). */
function seedGet(view: PreferenceView) {
  server.use(http.get(`${BASE}/me/preferences`, () => HttpResponse.json(view)));
}

/** PUT /me/preferences 바디를 캡처하고 status 로 응답한다. */
function capturePut(status: number) {
  server.use(
    http.put(`${BASE}/me/preferences`, async ({ request }) => {
      putBody = await request.json();
      if (status === 200) {
        return new HttpResponse(null, { status: 200 });
      }
      return HttpResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '검증 실패' } },
        { status }
      );
    })
  );
}

describe('PreferencesEditScreen — 취향 전체 수정 배선', () => {
  it('I1(AC-1) GET 초기값이 타일 선택으로 반영되고, 중립 기본값 축은 선택되지 않는다', async () => {
    // 준비 — 스타일·페이스는 진짜 설정, 음식은 중립(미설정→서버 파생값).
    seedGet({
      styles: { value: ['휴양'], isNeutralDefault: false },
      pace: { value: '균형있게', isNeutralDefault: false },
      foodTastes: { value: ['한식'], isNeutralDefault: true },
    });

    // 실행 — 렌더 후 GET 이 해소돼 타일이 시드되길 기다린다.
    renderScreen();
    await screen.findByTestId('settings-pref-style-휴양');

    // 단언 — 설정된 값은 selected, 아닌 값은 not selected.
    expect(screen.getByTestId('settings-pref-style-휴양')).toBeSelected();
    expect(screen.getByTestId('settings-pref-style-미식')).not.toBeSelected();
    expect(screen.getByTestId('settings-pref-pace-균형있게')).toBeSelected();
    // 중립 기본값 축은 value 가 있어도 미선택(isNeutralDefault 관통).
    expect(screen.getByTestId('settings-pref-food-한식')).not.toBeSelected();
  });

  it('I2(AC-2) 한 축만 바꿔 저장하면 PUT 바디에 그 축만, 안 바꾼 축은 없다', async () => {
    // 준비 — 스타일 설정(안 만짐), 음식 미설정. 음식만 새로 고른다.
    seedGet({
      styles: { value: ['휴양'], isNeutralDefault: false },
      foodTastes: { value: [], isNeutralDefault: true },
    });
    capturePut(200);

    // 실행 — 음식 한식 탭 → 저장.
    renderScreen();
    fireEvent.press(await screen.findByTestId('settings-pref-food-한식'));
    fireEvent.press(screen.getByTestId('settings-pref-save'));
    await waitFor(() => expect(putBody).not.toBeNull());

    // 단언 — 바꾼 축만 값으로 실린다.
    expect(putBody).toHaveProperty('foodTastes', ['한식']);
    // 안 바꾼 스타일은 키 자체가 없다 — null 로 실려도(데이터 손실) 전체전송해도 red(§5-C).
    expect(putBody).not.toHaveProperty('styles');
  });

  it('I3(AC-3) 미설정(중립) 축을 골라 저장하면 그 축이 저장된다', async () => {
    // 준비 — 음식 축이 중립(미설정)뿐인 View.
    seedGet({ foodTastes: { value: [], isNeutralDefault: true } });
    capturePut(200);

    // 실행 — 중립이라 초기 미선택 → 고르면 선택 → 저장.
    renderScreen();
    const food = await screen.findByTestId('settings-pref-food-한식');
    expect(food).not.toBeSelected();
    fireEvent.press(food);
    expect(screen.getByTestId('settings-pref-food-한식')).toBeSelected();
    fireEvent.press(screen.getByTestId('settings-pref-save'));
    await waitFor(() => expect(putBody).not.toBeNull());

    // 단언 — 미설정이던 축도 신규 설정·저장된다.
    expect(putBody).toHaveProperty('foodTastes', ['한식']);
  });

  it('I4(AC-4·INV-4) PUT 400이면 저장되지 않고 인라인 오류가 뜬다(침묵 금지)', async () => {
    // 준비 — GET 정상, PUT 은 400.
    seedGet({ styles: { value: ['휴양'], isNeutralDefault: false } });
    capturePut(400);

    // 실행 — 한 축 바꾸고 저장.
    renderScreen();
    fireEvent.press(await screen.findByTestId('settings-pref-style-미식'));
    fireEvent.press(screen.getByTestId('settings-pref-save'));

    // 단언 — 인라인 오류가 화면에 나타난다(낙관 확정·침묵 없음).
    expect(await screen.findByTestId('settings-pref-error')).toBeOnTheScreen();
  });

  it('I5(AC-우선안내) "직접 설정이 분석보다 우선" 안내 한 줄이 있다', async () => {
    // 준비 — 빈 View 여도 안내는 상시.
    seedGet({});

    // 실행
    renderScreen();
    const note = await screen.findByTestId('settings-pref-priority-note');

    // 단언 — 문구 표현 자유를 위해 정규식 부분일치(문자열 인자는 완전일치 함정, §5-A).
    expect(note).toHaveTextContent(/우선/);
  });
});
