/**
 * `expo-router` 의 `useRouter`·`router`·`useLocalSearchParams` 를 한 장부(`routerSpies`)로 묶어 주는 공용 목
 * (TRIP-1626 — 파일마다 `const mockPush = jest.fn(); jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))`
 * 를 복사하던 것을 대신한다).
 *
 * 쓰는 법 — **화면이 실제로 부르는 면·멤버만 `createExpoRouterMock` 으로 적는 것이 기본이다**(아래 D8). 인자 없는
 * 한 줄 형태(`jest.mock('expo-router', () => require('@/test-support/expoRouterMock'))`)는 전 면·전 멤버를 주므로
 * 헬퍼 자체 단위 테스트처럼 넓은 목이 의도일 때만 쓴다:
 *   jest.mock('expo-router', () =>
 *     require('@/test-support/expoRouterMock').createExpoRouterMock({
 *       useRouter: ['push', 'back'],
 *       params: () => mockSearchParams, // 렌더 때마다 평가 — `let mockSearchParams` 재할당을 따라간다
 *     })
 *   );
 *   const { routerSpies } = require('@/test-support/expoRouterMock'); // 단언은 여기서
 * (`jest.mock` 팩토리 안에서는 `require` 로 끌어온다 — 상단 `import` 는 hoist 순서상 아직 없다.)
 *
 * 왜 '옛 목에 없던 멤버'를 일부러 막는가(D8) — `opts` 를 주면 적은 면·멤버만 만든다. 옛 인라인 목이 `{ push }` 만
 * 가졌는데 화면이 나중에 `router.replace` 를 부르기 시작하면, 옛 테스트는 `TypeError` 로 빨갛게 터져 "이 화면이 이제
 * 다른 이동도 한다"를 알려 줬다. 전 멤버를 슬그머니 채워 주면 그 알림이 사라진다. `opts` 없이 부르면(=이 모듈 그대로)
 * 전 면·전 멤버다.
 *
 * `expo-router`·React 를 import 하지 않는다(순환 방지) — `useRouter` 안에서 React 훅도 쓰지 않아 컴포넌트 없이 함수로 부를 수 있다.
 */
export type RouterMember =
  | 'push'
  | 'replace'
  | 'back'
  | 'dismissTo'
  | 'navigate'
  | 'setParams'
  | 'canGoBack';

type Params = Record<string, string | string[] | undefined>;
type RouterObject = Partial<Record<RouterMember, jest.Mock>>;

const ALL: readonly RouterMember[] = [
  'push',
  'replace',
  'back',
  'dismissTo',
  'navigate',
  'setParams',
  'canGoBack',
];

/** 모듈 싱글턴 기록장 — 어떤 목 인스턴스를 만들든 안의 함수는 이것이다. */
export const routerSpies: Record<RouterMember, jest.Mock> = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

function pick(members: readonly RouterMember[]): RouterObject {
  const out: RouterObject = {};
  for (const m of members) out[m] = routerSpies[m];
  return out;
}

export function createExpoRouterMock(opts?: {
  useRouter?: readonly RouterMember[];
  router?: readonly RouterMember[];
  params?: () => Params;
}): {
  __esModule: true;
  useRouter?: () => RouterObject;
  router?: RouterObject;
  useLocalSearchParams?: () => Params;
} {
  const hookMembers = opts ? opts.useRouter : ALL;
  const routerMembers = opts ? opts.router : ALL;
  const params = opts ? opts.params : () => ({});
  const mock: ReturnType<typeof createExpoRouterMock> = { __esModule: true };
  if (hookMembers) mock.useRouter = () => pick(hookMembers);
  if (routerMembers) mock.router = pick(routerMembers);
  if (params) mock.useLocalSearchParams = () => params();
  return mock;
}

const full = createExpoRouterMock();
export const useRouter = full.useRouter as () => Record<
  RouterMember,
  jest.Mock
>;
export const router = full.router as Record<RouterMember, jest.Mock>;
export const useLocalSearchParams = full.useLocalSearchParams as () => Params;
