import type * as PreferencesModel from '../model/usePreferences';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { PreferenceView } from '@/shared/api/index.schemas';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';
import { PreferencesEditScreen } from './PreferencesEditScreen';

/**
 * l05 취향 전체 수정 — PreferencesEditScreen(스스로 조회·저장하는 컨테이너) 통합 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `PreferencesEditScreen.{integration,baseline}.test.tsx` 2개를 각자의 바깥
 * describe 로 옮겼다.
 *  - **`usePreferences` 스위치(`mockFakePreferences`)** — 옛 `.baseline` 은 훅을 가짜로 바꿔 회차별 view 를 주입했고,
 *    옛 `.integration` 은 실 훅으로 msw 와 왕복했다. `jest.mock` 은 파일 전체에 걸리므로 팩토리 안에서 **불리는
 *    순간** 스위치를 읽어 가짜/실물(`jest.requireActual`)을 고른다. 가짜 관점만 켠다(최상위 afterEach 가 끈다).
 *  - 옛 `.baseline` 은 QueryClientProvider 없이 그린다 — 스위치가 켜져 있어야만 유효한 전제다.
 */

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  router: { back: mockBack, push: mockPush },
}));

// 팩토리가 참조하려면 이름이 `mock` 으로 시작해야 한다(호이스팅 예외).
let mockFakePreferences = false;
let mockView: PreferenceView | undefined;
const mockSave = jest.fn();
jest.mock('../model/usePreferences', () => {
  const actual = jest.requireActual<typeof PreferencesModel>(
    '../model/usePreferences'
  );
  const fake = () => ({
    view: mockView,
    isLoading: false,
    save: mockSave,
    saveError: false,
  });
  return {
    usePreferences: () =>
      (mockFakePreferences ? fake : actual.usePreferences)(),
  };
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mockFakePreferences = false;
  resetToast();
});
afterAll(() => server.close());

// TRIP-610 · TRIP-778 · TRIP-990
describe('GET 초기값 → 타일 → PUT 저장·400 (옛 .integration)', () => {
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

  // handlers.ts 와 동일 계산(하드코딩 대신 env 경유로 mutator 와 정합, 02a §4-★F).
  const BASE = `${
    process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
  }/api/v1`;

  /** 마지막 PUT /me/preferences 의 와이어 바디(직렬화 후 파싱). 안 나갔으면 null. */
  let putBody: unknown = null;

  beforeEach(() => {
    putBody = null;
    mockBack.mockClear();
    mockPush.mockClear();
    // 인메모리 토큰 홀더 — mutator 인증 계층이 Authorization 을 붙이게 한다
    // (ItineraryEditPage.integration 「시각 조정 시트」 선례).
    setAccessToken('valid-access');
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    // 토스트 스토어는 모듈 싱글턴이라 파일 안 테스트 사이로 샌다 — 새 describe 만이 아니라 모든 테스트 뒤에
    // 비운다(03b 차단-1).
    resetToast();
  });

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
    server.use(
      http.get(`${BASE}/me/preferences`, () => HttpResponse.json(view))
    );
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
      // 합친 뒤 이 테스트가 파일 첫 테스트라 냉시작(모듈 첫 로드)을 흡수한다 — CI 에서 기본 1000ms 를
      // 넘겨 첫 테스트만 red 가 나는 일이 합친 통합 파일마다 반복됐다(TRIP-1144 SavedPlacesPage 선례).
      await screen.findByTestId('settings-pref-style-휴양', undefined, {
        timeout: 5000,
      });

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
      expect(
        await screen.findByTestId('settings-pref-error')
      ).toBeOnTheScreen();
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

  /**
   * TRIP-778 D11 — 저장이 성공하면 취향 조회를 다시 한다.
   *
   * 왜: 설정 화면(l05)은 스택에 남은 채 이 편집 화면을 push 하므로 돌아와도 다시 마운트되지 않는다. 저장 뒤
   * `/me/preferences` 를 무효화하지 않으면 설정의 취향 요약이 옛 값을 계속 보인다(01 맹점 ④ — 새로 연 값
   * 표면이 거짓말). 이 화면의 조회는 살아 있으므로(active), 무효화되면 GET 이 실제로 한 번 더 나간다 —
   * 그 "한 번 더"를 와이어에서 센다(무효화 키를 틀리면 재요청이 없어 red).
   */
  describe('PreferencesEditScreen — 저장 뒤 취향 조회 무효화 (TRIP-778 D11)', () => {
    it('I6(D11) PUT 200 뒤 GET /me/preferences 가 다시 나간다(1 → 2)', async () => {
      // 준비 — GET 호출 수를 센다.
      let gets = 0;
      server.use(
        http.get(`${BASE}/me/preferences`, () => {
          gets += 1;
          return HttpResponse.json({
            styles: { value: ['휴양'], isNeutralDefault: false },
          });
        })
      );
      capturePut(200);

      // 실행 — 첫 조회 후 한 축 바꾸고 저장.
      renderScreen();
      fireEvent.press(await screen.findByTestId('settings-pref-style-미식'));
      expect(gets).toBe(1);
      fireEvent.press(screen.getByTestId('settings-pref-save'));
      await waitFor(() => expect(putBody).not.toBeNull());

      // 단언 — 저장 성공 뒤 조회가 한 번 더 나간다.
      await waitFor(() => expect(gets).toBe(2));
    });

    it('짝: PUT 이 400 이면 다시 조회하지 않는다(실패를 성공처럼 갱신하지 않음)', async () => {
      let gets = 0;
      server.use(
        http.get(`${BASE}/me/preferences`, () => {
          gets += 1;
          return HttpResponse.json({
            styles: { value: ['휴양'], isNeutralDefault: false },
          });
        })
      );
      capturePut(400);

      renderScreen();
      fireEvent.press(await screen.findByTestId('settings-pref-style-미식'));
      fireEvent.press(screen.getByTestId('settings-pref-save'));
      // 앵커 — 실패가 화면에 처리된 뒤에 센다.
      expect(
        await screen.findByTestId('settings-pref-error')
      ).toBeOnTheScreen();

      expect(gets).toBe(1);
    });
  });

  /**
   * TRIP-990 · S2 (#030 · BR-U6-28 · 01b Q5) — 취향 저장이 성공하면 "취향을 저장했어요" 토스트를 띄우고
   * 설정으로 돌아간다(back + 토스트).
   *
   * 왜 둘 다인가: 성공해도 화면이 말이 없으면 저장됐는지 모른다(INV-4 정신). 돌아간 뒤에도 토스트는
   * 루트 호스트가 그리므로 보인다(D19). 설정의 취향 요약은 저장 뒤 무효화(TRIP-778 D11)로 이미 갱신된다.
   *
   * 무엇을 보장하나: 200 → 토스트 + back 1회. 짝: 400 → 인라인 오류만, 토스트·back 없음.
   *
   * 3동작 뼈대: 준비=GET·PUT 응답 → 실행=타일 하나 바꿔 저장 → 단언=토스트·back.
   */
  describe('🔴 S2 · 취향 저장 성공 토스트 + 뒤로 (#030)', () => {
    function renderWithToast() {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false },
        },
      });
      render(
        <QueryClientProvider client={client}>
          <WithToastHost>
            <PreferencesEditScreen />
          </WithToastHost>
        </QueryClientProvider>
      );
    }

    it('PUT 200 이면 "취향을 저장했어요" 토스트가 뜨고 뒤로 1회 간다', async () => {
      seedGet({ styles: { value: ['휴양'], isNeutralDefault: false } });
      capturePut(200);

      renderWithToast();
      fireEvent.press(await screen.findByTestId('settings-pref-style-미식'));
      fireEvent.press(screen.getByTestId('settings-pref-save'));

      const toast = await screen.findByTestId('settings-pref-saved');
      expect(within(toast).getByText('취향을 저장했어요')).toBeOnTheScreen();
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    });

    it('짝: PUT 400 이면 인라인 오류만 뜨고 토스트도 뒤로도 없다', async () => {
      seedGet({ styles: { value: ['휴양'], isNeutralDefault: false } });
      capturePut(400);

      renderWithToast();
      fireEvent.press(await screen.findByTestId('settings-pref-style-미식'));
      fireEvent.press(screen.getByTestId('settings-pref-save'));

      // 실패가 처리된 뒤에 센다.
      expect(
        await screen.findByTestId('settings-pref-error')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('settings-pref-saved')).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();
    });
  });
});

// TRIP-610
describe('저장 diff 기준선 — 가짜 훅 (옛 .baseline)', () => {
  /**
   * TRIP-610 · 5-c 심판 강화 — 저장 diff 기준선은 "편집을 시작한 스냅숏"이어야 한다(경고-1 봉합).
   *
   * 무엇을 보장하나(닫는 사각):
   *  - 🔴 편집 도중 GET 이 재요청(재연결/무효화/포그라운드 focus)으로 **다른 데이터**를 돌려줘 화면의
   *    `view` 가 갈려도, 저장 diff 는 **시드 시점 기준선**으로 계산된다 — 사용자가 손대지 않은 축은
   *    PUT 에 실리지 않는다(서버 최신값을 덮어쓰는 lost update 금지, AC-2 가 막으려던 손실의 역유입).
   *
   * 왜 기존 통합(MSW)이 아니라 usePreferences 모듈 목인가:
   *  화면이 자족 컨테이너(스스로 GET/PUT)라 "편집 도중 view 가 다른 데이터로 갱신되는" 순간을 회차별로
   *  주입할 창구가 필요하다. 훅을 목해 1회차 view=A(시드) → 2회차 view=B(재요청 시뮬레이션)로 바꾸면
   *  화면이 `buildPreferenceInput` 에 **어느 view 를 기준선으로 넘기는지**를 `save` 인자로 직접 관찰할 수
   *  있다. 순수함수 `buildPreferenceInput(view, selection)` 자체는 무죄 — 고칠 곳은 화면이 넘기는 view 가
   *  frozen(시드 스냅숏)이어야 한다는 것뿐이다(`preferenceDraft` 는 real 로 두어 화면이 틀린 view 를
   *  넘기면 실제로 축이 새는 것을 관통한다). I1~I5(MSW 배선)·preferenceDraft 단위는 별 파일이라 무간섭.
   *
   * 왜 지금 RED 인가: 현재 `handleSave` 는 저장 시점의 **살아있는 view**(=B)를 기준선으로 넘긴다 —
   *  안 만진 styles 가 B(`['미식']`) 기준으로 "바뀐 것"처럼 보여 시드값 `['휴양']` 이 PUT 에 실린다.
   *  구현자가 기준선 스냅숏을 상태로 얼리면(baseline freeze) GREEN.
   *
   * 3동작 뼈대: 준비(view=A 시드) → 실행(pace만 편집 → view 를 B 로 갈아 재렌더 → 저장) →
   *  단언(save 인자에 편집한 pace 만, 안 만진 styles 는 없음).
   */

  beforeEach(() => {
    mockFakePreferences = true;
    mockView = undefined;
    mockSave.mockClear();
  });

  describe('PreferencesEditScreen — 저장 diff 기준선(경고-1)', () => {
    it('편집 도중 view 가 갱신돼도 안 만진 축은 시드 기준선으로 빠진다(lost update 금지)', async () => {
      // 준비 — 진입 시 GET=A: styles 설정('휴양'), pace 미설정. 이 A 가 편집 기준선.
      mockView = { styles: { value: ['휴양'], isNeutralDefault: false } };
      const { rerender } = render(<PreferencesEditScreen />);

      // 시드 확인(공허 통과 차단) — A 가 타일에 반영됐다.
      expect(
        await screen.findByTestId('settings-pref-style-휴양')
      ).toBeSelected();

      // 실행 ① — 사용자는 pace 만 '알차게'로 바꾼다(styles 미접촉).
      fireEvent.press(screen.getByTestId('settings-pref-pace-알차게'));
      expect(screen.getByTestId('settings-pref-pace-알차게')).toBeSelected();

      // 실행 ② — 그 사이 재요청으로 GET=B(타 기기가 styles 를 '미식'으로 바꿈) → 화면 view 가 B 로 갈린다.
      mockView = { styles: { value: ['미식'], isNeutralDefault: false } };
      rerender(<PreferencesEditScreen />);

      // 실행 ③ — 저장.
      fireEvent.press(screen.getByTestId('settings-pref-save'));

      // 단언 — 편집한 pace 만 실린다. 안 만진 styles 는 기준선(A) 대비 무변경이라 빠져야 한다.
      // 현재 구현은 기준선을 B 로 잡아 시드값 `['휴양']` 을 styles 로 실어 서버의 '미식'을 덮는다 → RED.
      // toStrictEqual 로 여분 축·undefined 키까지 잠근다(02a §5-B).
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave.mock.calls[0][0]).toStrictEqual({ pace: '알차게' });
    });
  });
});
