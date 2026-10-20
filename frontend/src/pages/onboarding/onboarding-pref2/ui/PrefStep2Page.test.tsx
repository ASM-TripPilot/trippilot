import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { usePreferenceStore } from '@/features/edit-preferences';
import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import { notifyBootstrapReeval } from '@/shared/lib/bootstrapReeval';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { PrefStep2Page } from './PrefStep2Page';

/**
 * AC2 · AC3 · AC4 — 취향 2/2 배선(스토어 ↔ 화면 ↔ 라우터) + TRIP-1421 온보딩 완료 호출.
 *
 * 무엇을 보장하나: 1/2에서 고른 값이 2/2를 거쳐도(unmount→재마운트) 스토어 싱글턴
 * 덕분에 그대로 남고, '완료'·일괄 탈출 모두 0개 선택에도 홈으로 replace한다(AC-done-1 · AC4).
 * TRIP-1421부터 두 출구는 **온보딩 완료(`POST /onboarding/complete`)가 성공한 뒤에만**, 그리고
 * 루트 게이트가 목적지를 HOME 으로 바꾼 뒤에만 홈으로 간다. 실패하면 화면에 남아 오류 한 줄을 보이고,
 * 응답을 기다리는 동안은 두 출구 어느 쪽을 눌러도 완료 요청이 한 번뿐이다.
 *
 * 게이트 흉내(02a ★7): 재평가 신호 목이 불리면 `publishGateDestination('HOME')` 을 부른다 — 진짜 부트스트랩
 * 재평가가 하는 일이다. 신호 없이 대기하면 영원히 안 풀리고, 대기 없이 replace 하면 AC6 케이스가 잡는다.
 *
 * 3동작: 준비(스토어 선주입/reset · 완료 응답 세팅) → 실행(마운트·탭) → 단언(화면 반영/요청 횟수/라우터 호출).
 */

jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back }),
    router: { replace, push, back },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  replace: jest.Mock;
  push: jest.Mock;
  back: jest.Mock;
};

// TRIP-353 — 온보딩 완료 재평가 신호를 목킹해, 완료·탈출이 신호를 발화하는지 spy 로 관찰한다.
// 실물 몸통(pub/sub)은 bootstrapReeval.test.ts 가 따로 잠근다.
jest.mock('@/shared/lib/bootstrapReeval', () => ({
  notifyBootstrapReeval: jest.fn(),
  subscribeBootstrapReeval: jest.fn(() => () => {}),
}));
const mockNotifyReeval = notifyBootstrapReeval as jest.MockedFunction<
  typeof notifyBootstrapReeval
>;

// TRIP-471 — 취향 저장 PUT 훅 목. useMutation 실물은 QueryClientProvider 를 요구해 이 페이지
// 단독 렌더가 죽으므로, mutate 만 spy 로 노출한다(완료가 서버로 취향을 보내는지 관찰).
const mockPutMutate = jest.fn();
jest.mock('@/shared/api/generated/preferences/preferences', () => ({
  usePutMePreferences: () => ({ mutate: mockPutMutate }),
}));

// TRIP-1421 — 온보딩 완료 호출만 바꾸고 나머지는 실물(게이트·생성 훅이 로드 때 쓰는 값 보존, 02a ★12).
const mockCompleteOnboarding = jest.fn<Promise<void>, []>();
jest.mock('@/shared/api', () => ({
  __esModule: true,
  ...jest.requireActual('@/shared/api'),
  completeOnboarding: () => mockCompleteOnboarding(),
}));

const COMPLETE_ERROR = '시작하지 못했어요. 다시 시도해 주세요';

/** 손으로 풀 수 있는 약속 — "응답 대기 중"을 만든다. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 마이크로태스크 한 바퀴 — 완료 호출 앞에 await 가 한 번 끼어도 횟수 단언이 흔들리지 않게. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

// 모듈 싱글턴(게이트 목적지·연타 창·스토어)은 파일 최상위에서 리셋한다(02a ★8).
beforeEach(() => {
  resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
  usePreferenceStore.getState().reset();
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  mockPutMutate.mockClear();
  mockCompleteOnboarding.mockReset();
  mockCompleteOnboarding.mockResolvedValue(undefined);
  resetGateDestination();
  publishGateDestination('ONBOARDING');
  mockNotifyReeval.mockReset();
  mockNotifyReeval.mockImplementation(() => {
    publishGateDestination('HOME');
  });
});

afterEach(() => {
  resetGateDestination();
});

describe('PrefStep2Page — 복귀 시 선택값 보존 (AC2 · AC3 · 5-4)', () => {
  it('1/2에서 고른 값이 2/2를 언마운트·재마운트해도 남는다', () => {
    // 준비 — 1/2에서 이미 골랐다고 가정하고 스토어에 직접 선주입(스토어는 화면과 독립된
    // 모듈 싱글턴이라 이렇게 미리 채워도 된다 — §1 개념 박스).
    usePreferenceStore.getState().toggleStyle('rest');
    usePreferenceStore.getState().toggleFood('japanese');

    // 실행 — 렌더 후 언마운트, 다시 렌더(1/2↔2/2 왕복의 등가).
    const { unmount } = render(<PrefStep2Page />);
    unmount();
    render(<PrefStep2Page />);

    // 단언 — japanese 칩이 여전히 선택 상태(스토어가 화면 수명과 무관함을 증명).
    // TRIP-719: back chevron 제거로 back 배선 단언은 사라졌다(스토어 보존만 남는다).
    expect(screen.getByTestId('onboarding-pref2-food-japanese')).toBeSelected();
  });
});

describe('PrefStep2Page — 완료 내비게이션 (AC3 · AC-done-1 · 5-5)', () => {
  it('0개 선택에도 완료를 탭하면 홈으로 replace한다', async () => {
    // 준비 — 아무 것도 고르지 않은 채 렌더.
    render(<PrefStep2Page />);

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — 완료 응답·게이트 전환 뒤 replace('/').
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });
});

describe('PrefStep2Page — 완료 시 서버에 취향 PUT (TRIP-471)', () => {
  it('완료를 탭하면 slug→서버값으로 번역한 취향을 PUT 하고, 홈으로도 이동한다', async () => {
    // 준비 — 2축 선택(style + 동행 pet 특례).
    usePreferenceStore.getState().toggleStyle('rest');
    usePreferenceStore.getState().toggleCompanion('pet');
    render(<PrefStep2Page />);

    // 실행 — 완료 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — PUT 이 번역된 바디로 정확히 1회, 완료 흐름(replace)도 그대로 진행.
    expect(mockPutMutate).toHaveBeenCalledTimes(1);
    const body = mockPutMutate.mock.calls[0][0].data;
    expect(body.styles).toEqual(['휴양']);
    // 예산 입력이 없어졌으니 키 자체를 보내지 않는다 — 생략은 서버에서 변경 없음(저장된 등급 유지).
    expect(body).not.toHaveProperty('budgetTier');
    expect(body).not.toHaveProperty('budgetRawAmount');
    expect(body.petFlag).toBe(true); // pet 은 companionTypes 가 아니라 petFlag
    expect(body.companionTypes).toEqual([]);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });
});

// TRIP-1500 — 재진입(앱 재시작 뒤 2/2)에선 스토어가 비어 있다. 그 상태로 PUT 하면 7키가 전부 null 이라 서버에
// 저장된 취향이 지워진다. 비어 있으면 PUT 을 건너뛰고 완료만 보낸다(부분 선택 보존은 범위 밖 — 02a ★12).
describe('PrefStep2Page — 빈 스토어 [완료]는 취향 PUT 을 보내지 않는다 (TRIP-1500 AC1)', () => {
  it('아무것도 안 고르고 [완료]하면 취향 PUT 은 0회이고, 완료·재평가·홈 이동은 그대로 한다', async () => {
    // 준비 — 스토어 6축이 전부 null(재진입 직후). 앵커로 한 번 확인한다(리셋이 깨지면 이 케이스가 거짓으로 돈다).
    const draft = usePreferenceStore.getState();
    expect(
      [
        draft.styles,
        draft.pace,
        draft.companions,
        draft.foods,
        draft.transports,
        draft.activities,
      ].every((axis) => axis === null)
    ).toBe(true);
    render(<PrefStep2Page />);

    // 실행 — [완료] 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — 홈 이동까지 끝난 뒤에 본다(흐름이 다 지난 시점의 0회). 취향 PUT 0 · 완료 1 · 재평가 1.
    await waitFor(() => expect(routerMock.replace.mock.calls).toEqual([['/']]));
    expect(mockPutMutate).not.toHaveBeenCalled();
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockNotifyReeval).toHaveBeenCalledTimes(1);
  });
});

describe('PrefStep2Page — 한 축이라도 골랐으면 [완료]는 취향을 PUT 한다 (TRIP-1500 AC2)', () => {
  // 1/2 에서 고른 styles·pace 는 이 화면이 직접 안 그리는 축이다 — 2/2 의 4축만 보는 구현이면
  // 첫 가입 사용자의 1/2 선택이 조용히 저장되지 않는다(그래서 6축 전부 단독으로 시험한다).
  it.each([
    [
      'styles',
      () => usePreferenceStore.getState().toggleStyle('rest'),
      'styles',
      ['휴양'],
    ],
    [
      'pace',
      () => usePreferenceStore.getState().togglePace('relaxed'),
      'pace',
      '느긋하게',
    ],
    [
      'companions',
      () => usePreferenceStore.getState().toggleCompanion('solo'),
      'companionTypes',
      ['혼자'],
    ],
    [
      'foods',
      () => usePreferenceStore.getState().toggleFood('korean'),
      'foodTastes',
      ['한식'],
    ],
    [
      'transports',
      () => usePreferenceStore.getState().toggleTransport('walk'),
      'transportModes',
      ['도보'],
    ],
    [
      'activities',
      () => usePreferenceStore.getState().toggleActivity('nature'),
      'activities',
      ['자연'],
    ],
  ])(
    '%s 만 골라도 PUT 은 1회 나가고 고른 값이 실린다',
    async (_axis, pick, bodyKey, expected) => {
      // 준비 — 한 축만 고른다.
      pick();
      render(<PrefStep2Page />);

      // 실행 — [완료] 탭.
      fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

      // 단언 — PUT 1회 + 그 축의 서버값(번역 결과) + 홈 이동.
      expect(mockPutMutate).toHaveBeenCalledTimes(1);
      expect(mockPutMutate.mock.calls[0][0].data[bodyKey]).toEqual(expected);
      await waitFor(() =>
        expect(routerMock.replace.mock.calls).toEqual([['/']])
      );
    }
  );
});

describe('PrefStep2Page — 일괄 탈출 (AC4 · 5-6)', () => {
  it('skip-top을 탭하면 홈으로 replace하고, 이미 고른 styles는 그대로 남는다', async () => {
    // 준비 — styles만 미리 선택된 상태.
    usePreferenceStore.getState().toggleStyle('rest');
    render(<PrefStep2Page />);

    // 실행 — 상단 skip 탭(TRIP-719로 하단 링크 제거, 탈출구는 상단 하나).
    fireEvent.press(screen.getByTestId('onboarding-pref2-skip-top'));

    // 단언 — 홈으로 replace.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    // 단언 — 나머지 5축은 null 유지, styles는 그대로(01b: 고른 값 폐기 안 함 — 관찰 가능
    // 차이 없음 결정의 표면). activities는 TRIP-254 신설 7번째 축 — 탈출이 이 축도 안 건드림.
    const state = usePreferenceStore.getState();
    expect(state.styles).toEqual(['rest']);
    expect(state.pace).toBeNull();
    expect(state.companions).toBeNull();
    expect(state.foods).toBeNull();
    expect(state.transports).toBeNull();
    expect(state.activities).toBeNull();
  });
});

describe('PrefStep2Page — 동행 축 탭↔스토어 왕복 (AC2 · US-ONB-07 · 5-8)', () => {
  it('동행 항목을 탭하면 그 타일이 선택 표시되고 스토어 companions에 담긴다', () => {
    // 준비 — 렌더.
    render(<PrefStep2Page />);

    // 실행 — '혼자' 동행 타일을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-companion-solo'));

    // 단언 ① — 읽기 경로: 타일이 선택 표시된다.
    expect(
      screen.getByTestId('onboarding-pref2-companion-solo')
    ).toBeSelected();
    // 단언 ② — 쓰기 경로: companions는 복수 축이라 배열로 담긴다(원소 1개라 순서
    // 자유도가 없으므로 toEqual로 길이·원소·순서 전부를 고정한다).
    expect(usePreferenceStore.getState().companions).toEqual(['solo']);
  });
});

describe('PrefStep2Page — 음식 축 탭↔스토어 왕복 (AC-3 · US-ONB-10 · 5-9)', () => {
  it('음식 칩을 탭하면 그 칩이 선택 표시되고 스토어 foods에 담긴다', () => {
    // 준비 — 렌더. (기존 5-4는 'japanese'를 선주입으로 쓴다 — 여기는 다른 slug
    // 'korean'을 실제로 탭해, 이 케이스가 선주입이 아니라 쓰기 경로 증명임을 눈에 띄게 한다.)
    render(<PrefStep2Page />);

    // 실행 — '한식' 칩을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-food-korean'));

    // 단언 ① — 읽기 경로: 칩이 선택 표시된다.
    expect(screen.getByTestId('onboarding-pref2-food-korean')).toBeSelected();
    // 단언 ② — 쓰기 경로: foods 배열에 담긴다.
    expect(usePreferenceStore.getState().foods).toEqual(['korean']);
  });
});

describe('PrefStep2Page — 활동 축 탭↔스토어 왕복 (AC-4 · US-ONB-08 · 5-11)', () => {
  it('활동 칩을 탭하면 그 칩이 선택 표시되고 스토어 activities에 담긴다', () => {
    // 준비 — 렌더(스토어는 beforeEach가 이미 reset해서 7축 모두 null).
    render(<PrefStep2Page />);

    // 실행 — '자연' 활동 칩을 탭(★food가 아니라 activity prefix).
    fireEvent.press(screen.getByTestId('onboarding-pref2-activity-nature'));

    // 단언 ① — 읽기 경로: 칩이 선택 표시된다(스토어 값이 selectedActivities로 내려가
    // 화면이 다시 그려졌다).
    expect(
      screen.getByTestId('onboarding-pref2-activity-nature')
    ).toBeSelected();
    // 단언 ② — 쓰기 경로: 탭이 toggleActivity 액션에 연결돼 activities 배열에 담긴다
    // (복수 축이라 배열 — 원소 1개라 toEqual로 길이·원소 전부 고정).
    expect(usePreferenceStore.getState().activities).toEqual(['nature']);
  });
});

describe('PrefStep2Page — 이동 축 탭↔스토어 왕복 (AC2 · US-ONB-09 · 5-10)', () => {
  it('이동 항목을 탭하면 그 타일이 선택 표시되고 스토어 transports에 담긴다', () => {
    // 준비 — 렌더.
    render(<PrefStep2Page />);

    // 실행 — '도보 위주' 이동 타일을 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-transport-walk'));

    // 단언 ① — 읽기 경로: 타일이 선택 표시된다.
    expect(
      screen.getByTestId('onboarding-pref2-transport-walk')
    ).toBeSelected();
    // 단언 ② — 쓰기 경로: transports 배열에 담긴다.
    expect(usePreferenceStore.getState().transports).toEqual(['walk']);
  });
});

describe('PrefStep2Page — 온보딩 완료 재평가 신호 발화 (AC-A2 · TRIP-353)', () => {
  it('완료(done)를 탭하면 재평가 신호를 발화하고 여전히 홈으로 replace 한다', async () => {
    // 준비 — 렌더.
    render(<PrefStep2Page />);

    // 실행 — 완료 CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — 재평가 신호를 정확히 1회 발화(결함 A 수정) + 기존 계약(홈으로 replace) 유지.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(mockNotifyReeval).toHaveBeenCalledTimes(1);
  });

  it('일괄 탈출(skip-top)을 탭해도 재평가 신호를 발화하고 홈으로 replace 한다', async () => {
    // 준비 — 렌더.
    render(<PrefStep2Page />);

    // 실행 — 상단 '나중에 설정하고 시작' 탭(TRIP-719로 하단 링크 제거).
    fireEvent.press(screen.getByTestId('onboarding-pref2-skip-top'));

    // 단언 — 탈출 경로도 반드시 신호를 발화한다(하나만 고치면 다른 쪽 사용자가 갇힘) + replace 유지.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(mockNotifyReeval).toHaveBeenCalledTimes(1);
  });
});

// TRIP-1421 — 온보딩 완료를 닉네임 단계에서 이 화면의 두 출구로 옮겼다.
describe('PrefStep2Page — 온보딩 완료 호출 (TRIP-1421 AC2 · AC3)', () => {
  it('[완료]는 취향 PUT 과 완료를 함께 보내고, 완료가 성공한 뒤에만 재평가·홈 이동을 한다', async () => {
    // 준비 — 취향을 하나 골라 두고(TRIP-1500: 빈 스토어면 PUT 을 안 보낸다) 완료 응답을 붙잡아 둔다(대기 중).
    usePreferenceStore.getState().toggleStyle('rest');
    const pending = deferred();
    mockCompleteOnboarding.mockReturnValue(pending.promise);
    render(<PrefStep2Page />);

    // 실행 ① — [완료] 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 ① — PUT 은 응답을 안 기다리고 나갔고 완료도 1회. 아직 홈으로 안 간다.
    await flushMicrotasks();
    expect(mockPutMutate).toHaveBeenCalledTimes(1);
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockNotifyReeval).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 실행 ② — 완료 성공.
    await act(async () => {
      pending.resolve();
    });

    // 단언 ② — 이제 재평가 1회 · 홈 1회.
    await waitFor(() => expect(routerMock.replace.mock.calls).toEqual([['/']]));
    expect(mockNotifyReeval).toHaveBeenCalledTimes(1);
  });

  it('skip-top 은 취향 PUT 없이 완료만 보내고, 성공하면 홈으로 간다', async () => {
    // 준비 — styles 하나 고른 상태.
    usePreferenceStore.getState().toggleStyle('rest');
    render(<PrefStep2Page />);

    // 실행 — skip-top 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-skip-top'));

    // 단언 — 완료 1회 · PUT 0회(US-ONB-11: 고른 값을 서버로 안 보낸다) · 홈 이동.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockPutMutate).not.toHaveBeenCalled();
    expect(usePreferenceStore.getState().styles).toEqual(['rest']);
  });
});

describe('PrefStep2Page — 완료 실패 (TRIP-1421 AC4 · INV-4)', () => {
  it.each([
    ['[완료]', 'onboarding-pref2-done'],
    ['skip-top', 'onboarding-pref2-skip-top'],
  ])(
    '%s 의 완료가 실패하면 화면에 남아 오류 한 줄을 보이고, 재평가·홈 이동을 하지 않는다',
    async (_label, testId) => {
      // 준비 — 완료가 실패한다.
      mockCompleteOnboarding.mockRejectedValue(new Error('500'));
      render(<PrefStep2Page />);
      // 앵커 — 누르기 전엔 오류가 없다.
      expect(
        screen.queryByTestId('onboarding-pref2-complete-error')
      ).toBeNull();

      // 실행 — 출구 탭.
      fireEvent.press(screen.getByTestId(testId));

      // 단언 — 정확한 문구(완전 일치, 02a ★11) · 재평가 0 · 이동 0.
      expect(
        await screen.findByTestId('onboarding-pref2-complete-error')
      ).toHaveTextContent(COMPLETE_ERROR);
      expect(mockNotifyReeval).not.toHaveBeenCalled();
      expect(routerMock.replace).not.toHaveBeenCalled();
    }
  );

  it('실패 뒤 [완료]를 다시 누르면 완료를 다시 보내고, 성공하면 홈으로 간다', async () => {
    // 준비 — 1차 실패, 2차 성공.
    mockCompleteOnboarding
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce(undefined);
    render(<PrefStep2Page />);
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));
    await screen.findByTestId('onboarding-pref2-complete-error');

    // 실행 — 연타 창을 닫고(400ms 지난 것과 같다) 다시 누른다.
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — 완료 2회째가 나갔고 홈으로 한 번.
    await waitFor(() => expect(routerMock.replace.mock.calls).toEqual([['/']]));
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(2);
  });
});

describe('PrefStep2Page — 응답 대기 중 두 출구 잠금 공유 (TRIP-1421 AC5)', () => {
  it.each([
    [
      '[완료] → [완료] → skip-top',
      [
        'onboarding-pref2-done',
        'onboarding-pref2-done',
        'onboarding-pref2-skip-top',
      ],
    ],
    [
      'skip-top → [완료] → skip-top',
      [
        'onboarding-pref2-skip-top',
        'onboarding-pref2-done',
        'onboarding-pref2-skip-top',
      ],
    ],
  ])(
    '%s 를 눌러도 완료 요청은 1회이고, 성공하면 홈 이동도 1회다',
    async (_label, presses) => {
      // 준비 — 완료 응답을 붙잡아 둔다.
      const pending = deferred();
      mockCompleteOnboarding.mockReturnValue(pending.promise);
      render(<PrefStep2Page />);

      // 실행 — 탭 사이마다 연타 창을 닫는다: 400ms 창이 아니라 "응답 대기 잠금"만 시험한다(02a ★9).
      for (const testId of presses) {
        resetPressGuard();
        fireEvent.press(screen.getByTestId(testId));
      }

      // 단언 ① — 완료 요청은 한 번뿐.
      await flushMicrotasks();
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);

      // 실행 ② — 응답 성공.
      await act(async () => {
        pending.resolve();
      });

      // 단언 ② — 홈 이동도 한 번.
      await waitFor(() =>
        expect(routerMock.replace.mock.calls).toEqual([['/']])
      );
      await flushMicrotasks();
      expect(routerMock.replace).toHaveBeenCalledTimes(1);
    }
  );
});

describe('PrefStep2Page — 게이트가 HOME 을 연 뒤에만 이동 (TRIP-1421 AC6)', () => {
  it('완료가 성공해도 게이트 목적지가 아직 ONBOARDING 이면 홈으로 보내지 않고, HOME 이 되는 순간 보낸다', async () => {
    // 준비 — 재평가 신호가 게이트를 바로 바꾸지 않게 한다(부트스트랩 재조회가 아직 진행 중인 순간).
    mockNotifyReeval.mockImplementation(() => {});
    render(<PrefStep2Page />);

    // 실행 ① — [완료] 탭 → 완료 성공까지 흘려보낸다.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));
    await waitFor(() => expect(mockNotifyReeval).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 단언 ① — 목적지가 ONBOARDING 인 동안 '/'로 보내면 온보딩 index 로 떨어진다(브리프 미확인 1).
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 실행 ② — 게이트가 HOME 을 공개한다.
    act(() => {
      publishGateDestination('HOME');
    });

    // 단언 ② — 그제야 홈으로 한 번.
    await waitFor(() => expect(routerMock.replace.mock.calls).toEqual([['/']]));
  });
});
