import { Pressable, Text } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { useItineraryTabBack } from './useItineraryTabBack';

/**
 * TRIP-1264 · 직접 짜기 편집기(manual 라우트)에서 ‹ · iOS 스와이프 · Android 하드웨어 뒤로가 **모두 일정 탭**에
 * 닿고, 방식 선택(3/4)이 스택에 남지 않는다 — expo-router 실물 라우터로 잰다.
 *
 * 왜 실물인가: "어느 함수를 불렀나"가 아니라 "그 이동이 스택을 어떻게 바꾸나"가 계약이다. 막힌 이동을 다시
 * 보내는 순간 같은 화면이 또 막히는지(루프), 확정·로그아웃 이동이 조용히 삼켜지는지는 라우터만 안다.
 *
 * 편집기 대신 이 훅만 쓰는 탐침 화면을 꽂는다(편집기는 MSW·지도·스토어가 필요하다). 그래서 이 파일은
 * "ManualPlanPage 가 훅을 부르는가"를 보지 않는다 — 그건 `ManualPlanPage.hookMock.test.tsx` 몫이다.
 *
 * 스와이프·하드웨어 뒤로가 보내는 액션은 각각 `router.dismiss()`(POP)·`router.back()`(GO_BACK)으로 흉내 낸다.
 * 실제 손가락 제스처의 모양은 jest 가 못 본다(6-b).
 *
 * 통합 버킷인 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 * ManualPlanPage 의 통합 파일에 붙이지 않은 이유: 그 파일은 expo-router 를 파일 전체에서 목으로 바꾼다.
 *
 * 3동작 뼈대: 준비 = 홈 탭에서 방식 선택·편집기를 쌓는다 → 실행 = 뒤로 계열/다른 이동 → 단언 = 주소·스택 모양.
 */

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

/** 편집기 자리에 꽂는 탐침 — 훅을 부르고, 돌려받은 함수를 ‹ 처럼 버튼에 건다. */
function ManualProbe() {
  const goItineraryTab = useItineraryTabBack();
  return (
    <Pressable testID="probe-back" onPress={goItineraryTab}>
      <Text>‹</Text>
    </Pressable>
  );
}

const BASE_ROUTES = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/index': stub('home-root'),
  '(tabs)/itinerary': stub('tab-itinerary-root'),
  '(auth)/login': stub('login-root'),
  'trips/[tripId]/itinerary/index': stub('h16-root'),
  'trips/[tripId]/itinerary/method': stub('method-root'),
  'trips/[tripId]/itinerary/draft': stub('draft-root'),
  'trips/[tripId]/itinerary/manual/add': stub('add-root'),
};

const ROUTES = {
  ...BASE_ROUTES,
  'trips/[tripId]/itinerary/manual/index': ManualProbe,
};

const METHOD = '/trips/T/itinerary/method';
const DRAFT = '/trips/T/itinerary/draft';
const MANUAL = '/trips/T/itinerary/manual';
const MANUAL_ADD = '/trips/T/itinerary/manual/add';
const TAB_ITINERARY = '/itinerary';

type RouterResult = ReturnType<typeof renderRouter>;

/** 루트 스택의 화면 이름들. 라우터 상태는 `__root` 한 겹으로 싸여 있다(02a §5). */
function stackNames(result: RouterResult): string[] {
  const root = result.getRouterState();
  const stack = root?.routes[0]?.state;
  return (stack?.routes ?? []).map((route) => route.name);
}

/** 홈 탭에서 시작해 방식 선택 → 편집기를 쌓는다. 탭은 마지막 탭(홈)을 기억한다 — 그래서 일정 탭 도착이 "우연"이 아니다. */
function openManualFromMethod(routes: typeof ROUTES = ROUTES): RouterResult {
  const result = renderRouter(routes, { initialUrl: '/' });
  act(() => {
    router.push(METHOD);
  });
  act(() => {
    router.push(MANUAL);
  });
  // 앵커 — 편집기에 와 있다.
  expect(result.getPathname()).toBe(MANUAL);
  return result;
}

function expectLandedOnItineraryTab(result: RouterResult): void {
  expect(result.getPathname()).toBe(TAB_ITINERARY);
  // AC-2 — 방식 선택(3/4)·초안·편집기가 하나도 남지 않는다.
  expect(stackNames(result)).toEqual(['(tabs)']);
  // 가려진 화면은 기본 쿼리에 안 잡힌다 — 잡히면 지금 보이는 화면이다(02a ★10).
  expect(screen.getByTestId('tab-itinerary-root')).toBeOnTheScreen();
}

describe('RT-0 · 탐지기 자가검사 — 이 픽스처는 "방식 선택으로 돌아가는" 버그를 볼 수 있다', () => {
  it('훅이 없는 편집기에서 뒤로 가면 방식 선택이 나온다 (선제 green)', () => {
    // 준비 — 편집기 자리에 훅 없는 가짜 화면.
    const result = openManualFromMethod({
      ...BASE_ROUTES,
      'trips/[tripId]/itinerary/manual/index': stub('plain-manual-root'),
    });

    // 실행
    act(() => {
      router.back();
    });

    // 단언 — 고치기 전의 증상(QA F2)이 이 픽스처에서 재현된다.
    expect(result.getPathname()).toBe(METHOD);
  });
});

describe('🔴 AC-1r·AC-2 · 스와이프·하드웨어 뒤로도 일정 탭에 닿고, 방식 선택이 스택에 남지 않는다', () => {
  // 하드웨어 뒤로 = GO_BACK(`router.back`) · iOS 스와이프 취소 뒤 native-stack 이 보내는 것 = POP(`router.dismiss`).
  it.each<[string, () => RouterResult, 'back' | 'dismiss']>([
    [
      '방식 선택에서 들어와 하드웨어 뒤로',
      () => openManualFromMethod(),
      'back',
    ],
    ['방식 선택에서 들어와 스와이프', () => openManualFromMethod(), 'dismiss'],
    [
      '초안에서 push 로 들어와 하드웨어 뒤로',
      () => {
        const result = renderRouter(ROUTES, { initialUrl: '/' });
        act(() => {
          router.push(DRAFT);
        });
        act(() => {
          router.push(MANUAL);
        });
        expect(result.getPathname()).toBe(MANUAL);
        return result;
      },
      'back',
    ],
    [
      '초안 자리를 replace 로 차지하고 하드웨어 뒤로',
      () => {
        const result = renderRouter(ROUTES, { initialUrl: '/' });
        act(() => {
          router.push(DRAFT);
        });
        act(() => {
          router.replace(MANUAL);
        });
        expect(result.getPathname()).toBe(MANUAL);
        return result;
      },
      'back',
    ],
  ])('%s', (_label, open, gesture) => {
    // 준비
    const result = open();

    // 실행
    act(() => {
      if (gesture === 'back') router.back();
      else router.dismiss();
    });

    // 단언
    expectLandedOnItineraryTab(result);
  });
});

describe('🔴 AC-6 · ‹ 는 그대로 일정 탭으로 가고, 스스로 다시 막히는 루프가 없다', () => {
  it('‹(훅이 돌려준 함수)를 누르면 일정 탭에 닿는다', () => {
    // 준비
    const result = openManualFromMethod();

    // 실행 — 루프라면 여기서 React 가 "Maximum update depth exceeded" 로 던진다(02a ★5).
    fireEvent.press(screen.getByTestId('probe-back'));

    // 단언
    expectLandedOnItineraryTab(result);
  });
});

describe('🔴 AC-4 · 확정 뒤 h16 으로 바꿔 가는 이동은 막지 않는다', () => {
  it('편집기에서 replace(/trips/T/itinerary) 하면 확정 일정 화면이 뜬다', () => {
    // 준비
    const result = openManualFromMethod();

    // 실행 — ManualPlanPage 확정 성공 경로와 같은 이동.
    act(() => {
      router.replace('/trips/T/itinerary');
    });

    // 단언 — 편집기 자리를 h16 이 차지했다(방식 선택은 그 아래 그대로).
    expect(result.getPathname()).toBe('/trips/T/itinerary');
    expect(stackNames(result)).toEqual([
      '(tabs)',
      'trips/[tripId]/itinerary/method',
      'trips/[tripId]/itinerary/index',
    ]);
    expect(screen.getByTestId('h16-root')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · 계정 경계(로그아웃·세션 만료) 이동은 막지 않는다', () => {
  it('dismissAll 뒤 replace(/login) 하면 로그인 화면이다 — 일정 탭이 아니다', () => {
    // 준비
    const result = openManualFromMethod();

    // 실행 — `useAccountBoundaryReset` 과 같은 순서.
    act(() => {
      router.dismissAll();
      router.replace('/login');
    });

    // 단언
    expect(result.getPathname()).toBe('/login');
    expect(screen.getByTestId('login-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('tab-itinerary-root')).toBeNull();
  });
});

describe('🔴 AC-8 · 장소 추가(push)는 가로채지 않는다', () => {
  it('장소 추가로 갔다가 뒤로 오면 편집기, 한 번 더 뒤로 가면 일정 탭이다', () => {
    // 준비
    const result = openManualFromMethod();

    // 실행 ① — 장소 추가 push.
    act(() => {
      router.push(MANUAL_ADD);
    });

    // 단언 ① — 편집기는 빠지지 않고 그 위에 장소 추가가 쌓였다.
    expect(result.getPathname()).toBe(MANUAL_ADD);
    expect(stackNames(result).slice(-2)).toEqual([
      'trips/[tripId]/itinerary/manual/index',
      'trips/[tripId]/itinerary/manual/add',
    ]);

    // 실행 ② · 단언 ② — 장소 추가 화면엔 가로채기가 없다(편집기로 한 칸).
    act(() => {
      router.back();
    });
    expect(result.getPathname()).toBe(MANUAL);

    // 실행 ③ · 단언 ③ — 편집기에서 뒤로는 일정 탭.
    act(() => {
      router.back();
    });
    expectLandedOnItineraryTab(result);
  });
});

describe('🔴 D1 · 네이티브 스와이프 취소 신호가 편집기 화면에 실린다 (raw beforeRemove 기각)', () => {
  /** 그 요소의 조상 중 `preventNativeDismiss` prop 을 가진 첫 host(RNSScreen)의 값. */
  function preventNativeDismissOf(testID: string): unknown {
    let node: { props: Record<string, unknown>; parent: unknown } | null =
      screen.getByTestId(testID, { includeHiddenElements: true });
    while (node !== null && node.props.preventNativeDismiss === undefined) {
      node = node.parent as typeof node;
    }
    return node?.props.preventNativeDismiss;
  }

  it('편집기 화면은 preventNativeDismiss=true, 아래 깔린 방식 선택은 아니다', () => {
    // 준비 · 실행 — 쌓기만 한다(iOS 는 이 값이 true 여야 스와이프를 네이티브에서 취소한다).
    openManualFromMethod();

    // 단언
    expect(preventNativeDismissOf('probe-back')).toBe(true);
    // 짝 — 탐지기가 아무 화면에나 true 를 돌려주는 게 아니다.
    expect(preventNativeDismissOf('method-root')).not.toBe(true);
  });
});
