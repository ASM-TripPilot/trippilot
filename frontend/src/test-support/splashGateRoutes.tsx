/**
 * `SplashGate`(루트 Stack)가 `<Stack.Screen name=…>` 으로 선언하는 비-그룹 화면 전부를 빈 화면으로 채운 라우트 표(TRIP-1624).
 *
 * 왜 필요한가: expo-router 는 Stack 이 선언한 화면 이름에 대응하는 라우트 파일이 없으면 `[Layout children]: No route named …` 경고를
 * 테스트마다 수백 번 찍는다. `renderRouter` 는 표에 적은 라우트만 만들기 때문이다. 이 표를 펼쳐 넣으면 그 경고가 사라진다.
 * 그룹 `(auth)`·`(onboarding)`·`(tabs)` 는 `_layout` 이 있어야 해서 여기 넣지 않는다 — 호출 파일이 자기 표에 이미 갖고 있다.
 *
 * 사용: `renderRouter({ ...SPLASH_GATE_STUB_ROUTES, ...자기 표 }, …)` — 스프레드 **순서가 계약**이다.
 * 자기 표가 뒤라서 같은 키(예: `onboarding-tour: stub('tour-root')`)는 호출 파일의 것이 이긴다.
 *
 * `SplashGate.tsx` 가 새 화면 이름을 선언했는데 여기에 빠지면 소스 스캔이 아니라 렌더가 알려 준다 —
 * 경고가 다시 찍혀 `scripts/noise-budget.cjs` 의 `layout-children: 0` 예산이 red 가 된다.
 */
const Empty = () => null;

const NAMES = [
  'force-update',
  'reconsent',
  'onboarding-tour',
  'permission-location',
  'permission-push',
  'trips/[tripId]/planb/index',
  'trips/[tripId]/live/index',
  'assistant/index',
  // SplashGate 의 BAR_SCREEN_ROUTES
  'stays/index',
  'explore/places',
  'records/style',
  'trips/[tripId]/records/index',
  'trips/[tripId]/records/reflection/[date]',
  'trips/[tripId]/records/summary',
];

export const SPLASH_GATE_STUB_ROUTES: Record<string, () => null> =
  Object.fromEntries(NAMES.map((name) => [name, Empty]));
