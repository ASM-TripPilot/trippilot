// https://docs.expo.dev/guides/using-eslint/
const fs = require('fs');
const path = require('path');

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// FSD 층 방향(app → pages → widgets → features → entities → shared)을 import 경계로 강제한다.
// 각 zone 의 target 은 "제한을 받는 층", from 은 "그 층이 import 하면 안 되는 상위 층들"이다.
// 하위 층은 상위 층을 모른다 — features 는 다른 feature·widgets·pages·app 을 못 보고,
// shared 는 아무 상위 층도 못 본다.
//
// eslint-plugin-import 2.32.0 계약 두 가지:
//  (1) from 이 glob 배열이면 except 도 전부 glob 이어야 한다(디렉토리와 섞으면 규칙이
//      "exceptions must be glob patterns" 로 무효화된다).
//  (2) glob 경로에서 rule 은 from·target 은 basePath 로 resolve 하지만 **except 는 원문 그대로**
//      minimatch 에 넣는다(비-glob 경로에서만 except 를 resolve — 규칙 소스의 비대칭). 그래서
//      상대 glob(`./src/features/auth/**`)을 except 로 주면 절대 import 경로에 매칭 실패해 같은
//      feature 안의 상대 import 까지 위반으로 잡힌다. → target·from·except 를 전부 `layerGlob`
//      으로 **절대 glob** 으로 통일한다(`./src/app/**` 는 `src/app-shell` 을 안 문다 — 세그먼트 경계).
//
// 같은 층 형제 슬라이스 격리(TRIP-806): 층 방향(위/아래)만이 아니라 **같은 층 안의 형제 슬라이스끼리도**
// 서로 못 보게 한다 — features 가 이미 쓰는 방식(슬라이스마다 target·from·except zone 을 만들고 자기
// 슬라이스만 except)을 pages·widgets·entities 로 복제한다. 공용이 생기면 형제에서 직접 꺼내지 말고 더
// 아래 층으로 승격한다. entities 만 예외로, 제공자 Y 가 소비자 X 에게만 내주는 `entities/Y/@x/X/**` 창구를
// except 에 추가로 넣어 통제된 교차를 허용한다(그 외 형제 직접 import 는 여전히 금지).
//
// app·app-shell 은 target 에 넣지 않는다 — 공식 FSD v2.1 은 app 층이 아래 층 전부(features 포함)를
// import 하는 것을 허용한다(TRIP-1142 결정). 라우트는 page 를 꽂는 얇은 래퍼로 둔다(권장, lint 강제 없음).
//
// 라우트(TRIP-1161): Expo Router 라우트는 src 밖 루트 app/ 에 있다(ROUTES). app 층과 같은 자리 — 아래 층이 라우트를
// import 하면 위반이고(from), 라우트 자신은 아래 층을 공개 API 로만 문다(deepZones). 아래 블록의 files 글롭도
// src/** 만 보면 라우트가 통째로 빠지므로 ROUTE_FILES 를 함께 건다(빠지면 lint 가 green 인 채 보호 4종이 꺼진다).

const SRC = path.join(__dirname, 'src');
// `layerGlob('features','auth')` → `<abs>/src/features/auth/**` (해당 층·슬라이스 아래 전부).
const layerGlob = (...segments) => path.join(SRC, ...segments, '**');
// 라우트 폴더(루트 app/) — 절대 glob(위 계약 (2)와 같은 이유).
const ROUTES = path.join(__dirname, 'app', '**');
const ROUTE_FILES = 'app/**/*.{ts,tsx}';
const ROUTE_DEV = 'app/_dev/**';

// 층별 슬라이스 목록은 손으로 나열하지 않고 디렉토리에서 읽는다 — 새 슬라이스가 생기면 자동으로
// 형제 격리 대상에 편입돼 하드코딩 드리프트를 막는다(구조 테스트도 같은 방식으로 목록을 읽는다).
// entities 는 첫 입주 전이면 디렉토리가 아예 없을 수 있어(D2) existsSync 로 방어한다 — 없으면 빈 배열이라
// zone 이 하나도 안 생기고, 있으면 그 슬라이스들이 형제 격리 대상이 된다.
//
// 슬라이스 그룹(TRIP-1156): 직계에 세그먼트 폴더(ui·model·api·lib·config)나 index.ts(x)가 있으면 슬라이스,
// 없으면 그룹 폴더라 그 안으로 내려간다 — 반환값은 'itinerary/itinerary-draft' 같은 층 기준 상대경로다.
// 그룹을 슬라이스로 잘못 보면 zone 의 except 가 그룹 전체(pages/<그룹>/**)가 돼 같은 그룹 형제 import 가
// 조용히 허용된다(공식 FSD: 그룹 안에서도 슬라이스 격리는 그대로).
const SLICE_MARKER = /^(ui|model|api|lib|config|index\.tsx?)$/;
const readSlices = (layer, rel = '') => {
  const dir = path.join(SRC, layer, rel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const sub = path.join(rel, entry.name);
      const isSlice = fs
        .readdirSync(path.join(dir, entry.name))
        .some((name) => SLICE_MARKER.test(name));
      return isSlice ? [sub] : readSlices(layer, sub);
    });
};
const FEATURES = readSlices('features');
const PAGES = readSlices('pages');
const WIDGETS = readSlices('widgets');
const ENTITIES = readSlices('entities');

// 각 층이 import 하면 안 되는 "더 위쪽" 층들의 glob 목록.
const ABOVE_FEATURES = [
  layerGlob('widgets'),
  layerGlob('pages'),
  layerGlob('app'),
  layerGlob('app-shell'),
  ROUTES,
];
const ABOVE_ENTITIES = [layerGlob('features'), ...ABOVE_FEATURES];
const ABOVE_WIDGETS = [
  layerGlob('pages'),
  layerGlob('app'),
  layerGlob('app-shell'),
  ROUTES,
];
const ABOVE_PAGES = [layerGlob('app'), layerGlob('app-shell'), ROUTES];
const ABOVE_SHARED = [layerGlob('entities'), ...ABOVE_ENTITIES];

const layerZones = [
  // features/<x> 는 형제 feature 와 위 층(widgets·pages·app·app-shell)을 import 하지 못한다.
  // 같은 feature(자기 자신)는 except 로 허용하고, entities·shared 는 from 에 없어 허용된다.
  ...FEATURES.map((feature) => ({
    target: layerGlob('features', feature),
    from: [layerGlob('features'), ...ABOVE_FEATURES],
    except: [layerGlob('features', feature)],
    message:
      'features 간 직접 import 금지 + 상위 층(widgets·pages·app) 역참조 금지 — 데이터는 shared/api, 공용 도메인은 entities, 화면 이동은 라우팅.',
  })),
  // pages·widgets 도 같은 층 형제 슬라이스끼리 서로 import 하지 못한다(features 와 동형). from 은
  // 그 층 전체(layerGlob), except 는 자기 슬라이스뿐 — 자기 슬라이스 안의 절대 import 는 허용된다.
  ...PAGES.map((slice) => ({
    target: layerGlob('pages', slice),
    from: [layerGlob('pages')],
    except: [layerGlob('pages', slice)],
    message:
      'pages 형제 슬라이스 간 직접 import 금지 — 공용은 widgets/features/entities/shared 로 승격한다.',
  })),
  ...WIDGETS.map((slice) => ({
    target: layerGlob('widgets', slice),
    from: [layerGlob('widgets')],
    except: [layerGlob('widgets', slice)],
    message:
      'widgets 형제 슬라이스 간 직접 import 금지 — 공용은 features/entities/shared 로 승격한다.',
  })),
  // entities 만 형제 교차 창구 `@x` 를 연다 — 제공자 Y 가 `entities/Y/@x/X/**` 로 소비자 X 에게만
  // 내준다. except 도 전부 절대 glob 이어야 한다(★4, eslint-plugin-import 2.32.0 비대칭 — 상대 glob
  // 은 매칭 실패해 정당한 자기 import 까지 위반으로 잡힌다). `@x` 외 형제 직접 import 는 여전히 금지.
  ...ENTITIES.map((slice) => ({
    target: layerGlob('entities', slice),
    from: [layerGlob('entities')],
    except: [
      layerGlob('entities', slice),
      layerGlob('entities', '*', '@x', slice),
    ],
    message:
      'entities 형제 슬라이스는 서로 모른다 — 교차가 꼭 필요하면 제공자가 낸 @x 창구(entities/<제공자>/@x/<소비자>/**)로만.',
  })),
  {
    target: layerGlob('entities'),
    from: ABOVE_ENTITIES,
    message: 'entities 는 shared 만 참조한다(features·상위 층 역참조 금지).',
  },
  {
    target: layerGlob('widgets'),
    from: ABOVE_WIDGETS,
    message: 'widgets 는 features 이하만 참조한다(pages·app 역참조 금지).',
  },
  {
    target: layerGlob('pages'),
    from: ABOVE_PAGES,
    message: 'pages 는 widgets 이하만 참조한다(app·app-shell 역참조 금지).',
  },
  {
    target: layerGlob('shared'),
    from: ABOVE_SHARED,
    message: 'shared 는 어떤 상위 층도 모른다(도메인 무관 원시 부품만).',
  },
];

// ── 공개 API 강제(TRIP-1157) ───────────────────────────────────────────────────────────
// 슬라이스 밖에서는 그 슬라이스의 공개 API(index*.ts)로만 import 한다 — 딥 경로 금지. shared 는 세그먼트
// index*(shared/ui·lib 는 루트 직속 파일 + 하위 폴더 index*). 진입점은 index.ts 와 `index.<이름>.ts`(예:
// 네트워크 없는 `index.view.ts`, shared/api 의 `index.schemas.ts`·`index.hooks.ts`)를 함께 허용한다.
// 대상(target)은 각 슬라이스와 app·app-shell·라우트(ROUTES)다. 자기 슬라이스 안은 except 로 허용, entities 는 @x 창구도 허용.
// 테스트·목·`_dev` 는 이 zone 밖이다(jest.mock 은 정의 모듈을 겨눠야 index 소비처까지 가로챈다).
// import·export-from·import()·함수 안 require() 를 모두 잡는다(eslint-plugin-import 2.32.0 실측).
const PUBLIC_API = [
  ...[
    ['pages', PAGES],
    ['widgets', WIDGETS],
    ['features', FEATURES],
    ['entities', ENTITIES],
  ].flatMap(([layer, slices]) =>
    slices.map((slice) => path.join(SRC, layer, slice, 'index*.{ts,tsx}'))
  ),
  path.join(SRC, 'shared', '*', 'index*.{ts,tsx}'),
  path.join(SRC, 'shared', '{ui,lib}', '*.{ts,tsx}'),
  path.join(SRC, 'shared', '{ui,lib}', '*', 'index*.{ts,tsx}'),
];
const BELOW_APP = [
  layerGlob('pages'),
  layerGlob('widgets'),
  layerGlob('features'),
  layerGlob('entities'),
  layerGlob('shared'),
];
const DEEP_MESSAGE =
  '슬라이스 밖에서는 공개 API(index.ts·index.<이름>.ts)로만 import 한다 — 딥 경로 금지(TRIP-1157).';
const deepZones = [
  ...[
    ['pages', PAGES],
    ['widgets', WIDGETS],
    ['features', FEATURES],
    ['entities', ENTITIES],
  ].flatMap(([layer, slices]) =>
    slices.map((slice) => ({
      target: layerGlob(layer, slice),
      from: BELOW_APP,
      except: [
        ...PUBLIC_API,
        layerGlob(layer, slice),
        ...(layer === 'entities'
          ? [layerGlob('entities', '*', '@x', slice)]
          : []),
      ],
      message: DEEP_MESSAGE,
    }))
  ),
  ...['app', 'app-shell'].map((layer) => ({
    target: layerGlob(layer),
    from: BELOW_APP,
    except: PUBLIC_API,
    message: DEEP_MESSAGE,
  })),
  {
    target: ROUTES,
    from: BELOW_APP,
    except: PUBLIC_API,
    message: DEEP_MESSAGE,
  },
];

// ── 출시·보안 금지(TRIP-1145 — 소스 스캔에서 옮겨 왔다) ────────────────────────────────
// ⚠️ flat config 는 같은 규칙을 거는 블록이 여럿이면 뒤 블록 옵션이 앞 블록을 **통째로 덮는다**(합쳐지지
//    않는다). 그래서 예외 파일(StateNotice·캡처 어댑터) 블록은 아래 공통 목록을 펼쳐 다시 선언한다.
// ⚠️ no-restricted-imports 는 정적 import·export-from 만 본다 — require()·import() 는 사각이다(받아들인
//    잔여). 덕분에 shared/photo 의 호출 시점 require 와 shareCapture 의 동적 import() 는 그대로 허용된다.
const TEST_IGNORES = [
  'src/**/*.test.{ts,tsx}',
  'src/**/__tests__/**',
  'src/**/__mocks__/**',
  'src/mocks/**',
  'src/test-support/**',
];
// 모든 앱 파일 공통: msw·목(RN 부팅 크래시 + 테스트 전용), 개발 프리뷰의 가짜 데이터.
const COMMON_BANNED_PATHS = [
  { name: 'msw', message: 'msw 는 테스트 오라클 전용 — 앱 코드 import 금지.' },
];
const COMMON_BANNED_PATTERNS = [
  {
    // 상대경로(`../../mocks/server`)도 막는다 — `**/mocks` 는 경로 조각 단위라 `__mocks__` 와 안 겹친다.
    group: ['msw/*', '@/mocks', '@/mocks/*', '**/mocks', '**/mocks/**'],
    message: '목은 테스트 전용 — 앱 코드 import 금지.',
  },
  {
    group: ['**/_dev', '**/_dev/**'],
    message: '개발 프리뷰(가짜 데이터)를 앱 코드가 끌지 않는다.',
  },
];
// 네이티브 모듈은 정적으로 끌면 모듈이 없는 빌드에서 부팅 크래시 — 입구는 호출 시점 require 뿐.
// 루트 이름(`paths`)과 하위 경로(`<패키지>/*` 패턴)를 함께 막는다 — `paths` 는 글자가 정확히 같을 때만 문다.
const NATIVE_MODULES = [
  'expo-image-picker',
  'expo-media-library',
  'react-native-view-shot',
  'expo-sharing',
];
const NATIVE_MESSAGE =
  '네이티브 모듈 정적 import 금지 — 사진은 @/shared/photo 의 require 입구, 공유 캡처는 shareCaptureNative 로만.';
const nativePaths = (names) =>
  names.map((name) => ({ name, message: NATIVE_MESSAGE }));
const nativeSubpaths = (names) =>
  names.map((name) => ({ group: [`${name}/*`], message: NATIVE_MESSAGE }));
const CAPTURE_ADAPTER_PATTERN = {
  group: ['**/shareCaptureNative'],
  message: '캡처 어댑터는 동적 import() 로만 — 정적으로 끌면 부팅 크래시.',
};
const STATE_NOTICE_PATHS = [
  {
    name: 'react',
    importNames: ['useState', 'useReducer'],
    message:
      'StateNotice는 프레젠테이션 순수 컴포넌트다 — 로컬 상태는 호출부(feature) 몫.',
  },
  {
    name: 'expo-router',
    message:
      'StateNotice는 라우팅을 모른다 — 이동은 호출부가 onPress로 넘긴다.',
  },
  {
    name: '@tanstack/react-query',
    message: 'StateNotice는 네트워크 상태를 모른다.',
  },
  { name: 'axios', message: 'StateNotice는 네트워크 상태를 모른다.' },
];
const restrictedImports = (paths, patterns = []) => [
  'error',
  {
    paths: [...COMMON_BANNED_PATHS, ...paths],
    patterns: [...COMMON_BANNED_PATTERNS, ...patterns],
  },
];

// 계정 삭제는 1단계 확인부터(BR-U6-25) — initialStep 등 다른 prop·펼치기로 건너뛰지 못하게.
const DELETE_DIALOG_GATE = [
  {
    selector:
      "JSXOpeningElement[name.name='DeleteAccountDialog'] > JSXAttribute:not([name.name=/^(onCancel|onConfirmDeletion)$/])",
    message:
      '계정 삭제는 1단계부터(BR-U6-25) — onCancel·onConfirmDeletion 외 prop(initialStep 등) 금지.',
  },
  {
    selector:
      "JSXOpeningElement[name.name='DeleteAccountDialog'] > JSXSpreadAttribute",
    message: '계정 삭제 다이얼로그에 props 펼치기 금지(숨은 initialStep 통로).',
  },
  {
    // 다른 이름으로 들여오면 위 두 태그 검사를 통째로 비켜 간다.
    selector:
      "ImportSpecifier[imported.name='DeleteAccountDialog'][local.name!='DeleteAccountDialog']",
    message:
      '계정 삭제 다이얼로그는 원래 이름으로만 import 한다(별칭은 게이트 우회).',
  },
];
// 아무것도 안 하는 핸들러 금지(앱 심사 2.1). 주석은 AST 노드가 아니라 주석뿐인 본문도 빈 본문으로 잡힌다.
// 정당한 빈 핸들러는 그 줄에 `// eslint-disable-next-line no-restricted-syntax -- <사유>` 로 연다.
const DEAD_HANDLER = [
  {
    selector:
      "JSXAttribute[name.name=/^on[A-Z]/] > JSXExpressionContainer > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
    message:
      '아무것도 안 하는 핸들러 금지(심사 2.1) — 동작이 없으면 버튼을 숨기거나 disabled.',
  },
  {
    selector:
      "JSXAttribute[name.name=/^on[A-Z]/] > JSXExpressionContainer > Identifier[name='undefined']",
    message: '핸들러에 undefined 를 명시 주입하지 않는다(심사 2.1).',
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    // .claude/** = 에이전트·스킬·Workflow 스크립트(dictate.js 등). 워크플로 JS는 최상위 await/return을
    // 쓰는 런타임 스크립트라 일반 ESM 린트 대상이 아니다(파싱 에러). 앱 소스 아님 → 린트 제외.
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*', 'web/*', '.claude/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}', ROUTE_FILES],
    rules: {
      'import/no-restricted-paths': ['error', { zones: layerZones }],
      // NativeWind 전역 스타일은 side-effect import 이며 확장자 resolver 대상이 아니다.
      'import/no-unresolved': ['error', { ignore: ['\\.css$'] }],
    },
  },
  {
    // 공개 API 강제(TRIP-1157) — 프로덕션 파일만. 같은 규칙이라 층 zone 을 펼쳐 함께 선언한다(위 ⚠️ 덮어쓰기).
    // 테스트·목·_dev 는 앞 블록(층 zone 만)이 그대로 남는다.
    files: ['src/**/*.{ts,tsx}', ROUTE_FILES],
    ignores: [...TEST_IGNORES, ROUTE_DEV],
    rules: {
      'import/no-restricted-paths': [
        'error',
        { zones: [...layerZones, ...deepZones] },
      ],
    },
  },
  {
    // 출시·보안 공통 금지 — 앱 프로덕션 파일 전부(테스트·목·test-support 제외).
    files: ['src/**/*.{ts,tsx}', ROUTE_FILES],
    ignores: TEST_IGNORES,
    rules: {
      'no-restricted-imports': restrictedImports(nativePaths(NATIVE_MODULES), [
        ...nativeSubpaths(NATIVE_MODULES),
        CAPTURE_ADAPTER_PATTERN,
      ]),
      'no-console': 'error',
    },
  },
  {
    // 캡처 어댑터만 캡처 3종을 정적으로 문다(사진 피커·공통 금지는 그대로).
    files: ['src/features/share-trip-card/model/shareCaptureNative.ts'],
    rules: {
      // 루트·하위 경로 모두 사진 피커만 다시 건다 — 캡처 3종의 하위 경로 패턴이 여기 실려 오면 안 된다.
      'no-restricted-imports': restrictedImports(
        nativePaths(['expo-image-picker']),
        nativeSubpaths(['expo-image-picker'])
      ),
    },
  },
  {
    // shared/ui 전체를 상태·라우팅·네트워크 import 금지로 묶을 수는 없다(BottomTabBar처럼
    // shared/ui에 정당하게 상태를 가질 거주자가 있을 수 있다) — 그래서 "프레젠테이션 순수성"이
    // 필요한 파일만 좁게 막는다. StateNotice.tsx는 features/stay/ui에서 승격되며 stay 쪽 소스 스캔의
    // 사정거리 밖으로 나갔다(TRIP-222 03b W-3) — 여기서 대신 막는다. 공통 목록을 펼쳐 함께 선언한다(위 ⚠️).
    files: ['src/shared/ui/StateNotice.tsx'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [...STATE_NOTICE_PATHS, ...nativePaths(NATIVE_MODULES)],
        [...nativeSubpaths(NATIVE_MODULES), CAPTURE_ADAPTER_PATTERN]
      ),
    },
  },
  {
    files: ['src/**/*.tsx', 'app/**/*.tsx'],
    ignores: [...TEST_IGNORES, ROUTE_DEV],
    rules: { 'no-restricted-syntax': ['error', ...DELETE_DIALOG_GATE] },
  },
  {
    // 빈 핸들러 금지는 pages·라우트만(원 스캔 범위). 같은 규칙이라 삭제 게이트를 펼쳐 함께 선언한다(위 ⚠️).
    files: ['src/pages/**/*.tsx', 'app/**/*.tsx'],
    ignores: [...TEST_IGNORES, ROUTE_DEV],
    rules: {
      'no-restricted-syntax': ['error', ...DELETE_DIALOG_GATE, ...DEAD_HANDLER],
    },
  },
  {
    // 테스트 라이브러리(fast-check)의 표준 default import(`import fc from 'fast-check'`)는
    // `fc.property`/`fc.assert` 형태가 문서화된 API 다 — namespace 경고를 끈다.
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    // .cjs 는 node CommonJS 런타임으로 실행되는 스크립트다(하네스 스크립트 포함).
    // eslint.config.js 도 CommonJS 런타임 파일이며, 층 zone 을 세우려 `__dirname` 으로
    // src 위치를 잡는다(위 layerGlob). 기본 설정에 __dirname/__filename 전역이 빠져 있어
    // no-undef 오탐이 나므로 두 대상에 CommonJS 전역을 준다.
    files: ['**/*.cjs', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', __filename: 'readonly' },
    },
  },
]);
