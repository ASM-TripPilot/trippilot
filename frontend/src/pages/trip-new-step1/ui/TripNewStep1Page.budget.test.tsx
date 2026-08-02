import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-207 g01 예산 배선 — **이 사이클의 심판**.
 *
 * 무엇을 보장하나:
 *  - **AC-1 프리필** 취향의 예산 러프값이 콤마 표기로 입력에 채워지고 안내 문구가 뜬다.
 *    값이 없는 세 갈래(축 부재 · `rawAmount: null` · 취향 자체 없음)는 전부 빈 입력이다.
 *  - **01b 불변식** 프리필이 **사용자 입력 경로를 타지 않는다** — 채워도 `touched`가 안 켜지고,
 *    필드를 탭했다 나가기만 해도 안 켜진다. 이것이 깨지면 프리필이 자기 자신을 즉시 잠근다.
 *  - **AC-1c** 지운 값은 화면을 나갔다 돌아와도 되살아나지 않는다.
 *  - **AC-2 · AC-3** 나가는 요청 본문에서 `budgetTotal` **키의 유무**가 사용자 입력으로 갈리고,
 *    실릴 때는 콤마 없는 맨 정수다.
 *  - **AC-4 · AC-5** 파싱 실패는 인라인 문구 + `[다음]` 비활성 + 전송 0건이고, 콤마 재포맷은
 *    **blur 1회**다(타이핑 중에는 원문 보존).
 *
 * 왜 node 버킷인가: 심판 대상이 **JSON 직렬화 이전의 객체**다. wire를 관찰하는 통합 테스트는
 * "키 부재"와 "값이 `undefined`"를 구별할 수 없다(직렬화가 `undefined` 키를 지운다) — AC-2의
 * "`null` 전송이 아니라 키 자체가 없다"는 `in` 연산자로만 갈리고, 그러려면 뮤테이션에 넘어간
 * 객체를 직접 봐야 한다. 그래서 훅을 모듈째 목킹하고 인자를 가로챈다(02a ★3).
 * 실제로 나간 HTTP는 `TripNewStep1Page.integration.test.tsx`가 이미 본다.
 *
 * 커버하지 않는 것: 프레젠테이션 세부(문구 배치·testID 구조)는 `TripWizardStep1Screen.budget.test.tsx`
 * 몫이다. `수정`의 실제 포커스 이동은 관찰 불가([검증] 육안).
 *
 * ⚠️ `jest.mock` 팩토리는 파일 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이
 * `mock`으로 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

let mockPreference: PreferenceView | undefined;

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: mockPreference }),
}));

/** 뮤테이션에 실제로 넘어간 인자를 가로챈다 — 이 파일의 관찰 창구다. */
const mockMutateAsync = jest.fn();

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    reset: jest.fn(),
  }),
}));

/** 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다(TRIP-205 D5). */
const BASE = '2026-06-10';

/** 페이지가 만들어 내려보내는 인라인 문구. Figma에 예산 오류 프레임이 없어 **이 칸의
 * 발명**이다(02a §2-4) — 게이트①에서 뒤집히면 페이지 상수 한 줄만 바뀐다. */
const BUDGET_ERROR = '숫자만 입력해 주세요';

/** Figma `2225:2391` 실측. 따옴표는 곡선 따옴표(‘ U+2018 / ’ U+2019)다(02a ★11). */
const PREFILL_NOTE = '온보딩에서 고른 ‘중간(50~150만)’ 범위로 채웠어요';

function input() {
  return screen.getByTestId('trip-wizard-budget-input');
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음(승인 파일과 같은 형태). */
function addDestination(regionCode: string, nights: number): void {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    screen.getByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

/** 예산 말고는 흠이 없는 드래프트(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function fillValidDraft(): void {
  addDestination('busan', 3);
  fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
}

/** `[다음]`을 누르고 제출의 뒷정리(비동기 then)까지 흘려보낸다. */
async function pressNext(): Promise<void> {
  await act(async () => {
    fireEvent.press(next());
  });
}

/** 뮤테이션에 넘어간 **요청 본문 객체**(직렬화 전). */
function submittedBody(): Record<string, unknown> {
  const [firstCall] = mockMutateAsync.mock.calls as {
    data: Record<string, unknown>;
  }[][];
  return firstCall[0].data;
}

/** 취향에 예산 러프값이 실제로 있는 상태(칩도 함께 — 승인 파일과 같은 형태). */
function preferenceWithAmount(rawAmount: number | null): PreferenceView {
  return {
    budget: { tier: '중간', rawAmount, isNeutralDefault: false },
    styles: { value: ['미식', '전시'] },
    activities: { value: ['야경'] },
  };
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 touched가 프리필을 막아
  // AC-1이 거짓 red를 낸다.
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue({ tripId: 'trip-1' });
  mockPreference = preferenceWithAmount(1200000);
});

describe('AC-1 · 취향 러프값 프리필', () => {
  it('러프값이 콤마 표기로 채워지고 Figma 안내 문구가 뜬다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // ⚠️ 완전 일치다(02a §5-2) — 부분 문자열을 주면 실패한다.
    expect(input()).toHaveDisplayValue('1,200,000');
    expect(screen.getByText(PREFILL_NOTE)).toBeOnTheScreen();
  });

  it('0원도 프리필된다 — 거짓값으로 접지 않는다', () => {
    // 판정은 `typeof rawAmount === 'number'`다. `rawAmount ? … : …`로 쓰면 0이 조용히
    // "예산 없음"이 된다(02a ★2 — `formatPrice`·TRIP-203 PBT 두 선례).
    mockPreference = preferenceWithAmount(0);
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(input()).toHaveDisplayValue('0');
    expect(screen.getByText(PREFILL_NOTE)).toBeOnTheScreen();
  });

  const ABSENT_CASES: {
    name: string;
    preference: PreferenceView | undefined;
  }[] = [
    {
      name: 'budget 축 자체가 없다',
      preference: { pace: { value: '느긋하게', isNeutralDefault: true } },
    },
    {
      name: 'budget은 있는데 rawAmount가 null이다',
      preference: preferenceWithAmount(null),
    },
    { name: '취향 조회가 아직 안 끝났다', preference: undefined },
  ];

  it.each(ABSENT_CASES)(
    'AC-1b · $name → 빈 입력이고 안내 문구가 없다',
    ({ preference }) => {
      mockPreference = preference;
      render(<TripNewStep1Page baseDate={BASE} />);

      expect(input()).toHaveDisplayValue('');
      expect(screen.queryByTestId('trip-wizard-budget-note')).toBeNull();
    }
  );
});

describe('01b 불변식 · 프리필은 사용자 입력 경로를 타지 않는다', () => {
  /**
   * ⚠️ 이 사이클에서 **눈으로는 절대 안 보이는** 결함의 자리다. 프리필이 `onChange`(=
   * `setBudgetText`)를 거쳐 값을 넣으면 그 순간 `touched`에 `'budget'`이 켜지고, 프리필이
   * **자기 자신을 잠근다**. 겉보기 증상은 "한 번 채우고 그 뒤로 안 채움"이라 정상 동작과
   * 구별되지 않는다. 그 반대 실수(프리필이 touched를 안 켜게 하려다 사용자 입력 경로까지
   * 우회시키는 것)는 AC-2를 통째로 깬다.
   */
  it('프리필이 채워도 touched에 budget이 켜지지 않는다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 값은 보인다.
    expect(input()).toHaveDisplayValue('1,200,000');
    // 그런데 사용자는 아무것도 안 했다.
    expect(useTripWizardStore.getState().touched).not.toContain('budget');
  });

  it('짝 — 사용자가 실제로 치면 켜진다', () => {
    // 이게 없으면 "touched를 아예 안 켜는" 구현도 위를 통과하고, 그러면 지우기가 불가능해진다.
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.changeText(input(), '900,000');

    expect(useTripWizardStore.getState().touched).toContain('budget');
  });

  it('필드를 탭했다 나가기만 해도 잠기지 않는다 (01b D6 — 방아쇠는 onChange다)', () => {
    // blur 재포맷을 `touched` 가드 없이 짜면, 필드를 눌렀다 그냥 나가는 것만으로
    // `setBudgetText`가 불려 프리필이 영원히 잠긴다(02a ★1-b). D6이 방아쇠를 `onFocus`가
    // 아니라 `onChange`로 정한 이유가 정확히 이것이다 — 의사 표시 전이니 채워지는 게 맞다.
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent(input(), 'blur');

    expect(useTripWizardStore.getState().touched).not.toContain('budget');
    expect(input()).toHaveDisplayValue('1,200,000');
  });
});

describe('AC-1c · 지운 값은 재진입해도 되살아나지 않는다', () => {
  it('프리필을 지우고 화면을 나갔다 오면 여전히 비어 있다', () => {
    const first = render(<TripNewStep1Page baseDate={BASE} />);

    // 실행 — 프리필된 값을 지운다.
    fireEvent.changeText(input(), '');
    expect(input()).toHaveDisplayValue('');
    // 안내 문구도 사라진다 — 더 이상 "취향에서 온 값"이 아니다.
    expect(screen.queryByTestId('trip-wizard-budget-note')).toBeNull();

    // 실행 — 화면을 통째로 내렸다 새로 올린다(뒤로 갔다 돌아온 것과 같은 상황).
    first.unmount();
    render(<TripNewStep1Page baseDate={BASE} />);

    // 취향은 그대로 1,200,000을 주고 있다. 그래도 다시 채우면 안 된다.
    expect(input()).toHaveDisplayValue('');
  });

  it('짝 — reset 뒤에는 다시 채워진다', () => {
    // 위 단언이 "프리필이 아예 한 번만 동작한다"가 아니라 **사용자 의사를 존중한 것**임을
    // 보이는 짝. 새 여행 드래프트에서는 프리필이 정상 동작해야 한다.
    const first = render(<TripNewStep1Page baseDate={BASE} />);
    fireEvent.changeText(input(), '');
    first.unmount();

    useTripWizardStore.getState().reset();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(input()).toHaveDisplayValue('1,200,000');
  });
});

describe('AC-5 · 콤마 재포맷은 blur 1회 (01b D8)', () => {
  it('타이핑 중에는 원문 그대로이고, blur에서 한 번 정리된다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // ⚠️ 두 단계를 **나눠서** 본다. 뒤 단언만 두면 실시간 재포맷 구현도 통과하고, 앞
    // 단언만 두면 재포맷이 아예 없는 구현도 통과한다(02a ★7).
    fireEvent.changeText(input(), '1200000');
    expect(input()).toHaveDisplayValue('1200000');

    fireEvent(input(), 'blur');
    expect(input()).toHaveDisplayValue('1,200,000');
  });

  it('숫자로 못 읽는 값은 blur해도 그대로 남는다 (AC-4의 "남아 있으면")', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.changeText(input(), '120만');
    fireEvent(input(), 'blur');

    // 정리한답시고 지우거나 0으로 접으면 사용자가 무엇을 잘못 썼는지 볼 수 없다.
    expect(input()).toHaveDisplayValue('120만');
  });
});

describe('AC-4 · 파싱 실패 — 인라인 오류 + 게이트 차단 + 전송 0건', () => {
  it('숫자로 못 읽는 값을 치면 문구가 서고 [다음]이 실제로 막힌다', async () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    // 앵커 — 예산을 건드리기 전에는 열려 있었다. 없으면 "원래부터 닫힌" 게이트를
    // 예산 탓으로 오독한다.
    expect(next()).toBeEnabled();

    fireEvent.changeText(input(), 'abc');

    expect(screen.getByTestId('trip-wizard-error-budget')).toBeOnTheScreen();
    expect(screen.getByText(BUDGET_ERROR)).toBeOnTheScreen();

    // ⚠️ 두 단언이 짝이다. `toBeDisabled()`는 접근성 상태만 읽으므로, 회색이기만 하고
    // 실제로는 눌리는 버튼이 매처를 통과한다(02a ★5 실측).
    expect(next()).toBeDisabled();
    await pressNext();
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('짝 — 숫자로 고치면 문구가 사라지고 다시 열린다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    fireEvent.changeText(input(), 'abc');
    expect(next()).toBeDisabled();

    fireEvent.changeText(input(), '120000');

    expect(screen.queryByTestId('trip-wizard-error-budget')).toBeNull();
    expect(next()).toBeEnabled();
  });

  it('비운 것은 오류가 아니다 — 문구 없이 그대로 진행된다 (AC-2 전제)', () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    fireEvent.changeText(input(), '');

    // "비어 있음"과 "못 읽음"을 한 갈래로 접으면 예산이 사실상 필수가 된다(US-TRIP-01 위반).
    expect(screen.queryByTestId('trip-wizard-error-budget')).toBeNull();
    expect(next()).toBeEnabled();
  });
});

describe('AC-2 · AC-3 · 나가는 요청 본문', () => {
  it('AC-2 · 비우면 취향에 러프값이 있어도 budgetTotal 키가 붙지 않는다', async () => {
    // 준비 — 취향은 1,200,000을 주고 있다(프리필도 됐다). 사용자가 그것을 지운다.
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();
    fireEvent.changeText(input(), '');

    await pressNext();

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    const body = submittedBody();

    // ⚠️ `in` 연산자라야 갈린다. `toEqual`은 값이 `undefined`인 키를 무시하므로
    // `{budgetTotal: undefined}`와 키 부재를 **구별하지 못하고**, `toBeUndefined()`는
    // 둘 다 통과한다(02a ★3). "키 부재 ≠ null 전송" 선례: `buildStayRegisterRequest`(TRIP-198 AC-5).
    expect('budgetTotal' in body).toBe(false);
    // 짝(긍정) — 조립이 실제로 뭔가를 만들었다. 없으면 빈 객체를 보내는 구현도 통과한다.
    expect(body.startDate).toBe('2026-06-10');
  });

  it('AC-3 · 프리필 값을 그대로 두면 콤마 없는 맨 정수로 실린다', async () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    // 앵커 — **사용자에게 보이는 값**이 곧 전송될 값이다. 이 줄이 없으면 이 케이스는
    // "취향에서 몰래 붙는" 옛 경로(TRIP-207이 뒤집는 바로 그 동작)로도 통과한다 — 실제로
    // 구현 전 실행에서 이 it만 green이었다. 화면에 그 값이 떠 있음을 먼저 못박아, 심판
    // 대상을 "입력 필드를 통과한 값"으로 고정한다.
    expect(input()).toHaveDisplayValue('1,200,000');

    await pressNext();

    const body = submittedBody();
    expect(body.budgetTotal).toBe(1200000);
    // 계약이 `integer`다 — 표시 문자열 `'1,200,000'`이 그대로 나가면 서버가 거부한다.
    expect(typeof body.budgetTotal).toBe('number');
  });

  it('BR-U1-38 · 사용자가 덮어쓰면 그 값이 나간다 (입력이 취향을 이긴다)', async () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();
    fireEvent.changeText(input(), '500,000');

    await pressNext();

    // 여행 단위 덮어쓰기가 성립한다(계정 취향은 불변).
    expect(submittedBody().budgetTotal).toBe(500000);
  });

  it('0원을 직접 입력하면 0이 실린다 — 키 생략이 아니다', async () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();
    fireEvent.changeText(input(), '0');

    await pressNext();

    const body = submittedBody();
    expect('budgetTotal' in body).toBe(true);
    expect(body.budgetTotal).toBe(0);
  });
});
