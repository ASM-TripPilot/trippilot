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
// 전방 app→features 제한은 이번엔 두지 않는다(Q1 옵션 A) — app·app-shell 을 target 으로 넣지
// 않는다. app→features 실측 110건이 즉시 red 가 되고 TRIP-803 "소급 이동 없음"과 충돌하기
// 때문. pages 이주로 app→features 가 자연 감소한 뒤 별도 티켓에서 켠다.

const SRC = path.join(__dirname, 'src');
// `layerGlob('features','auth')` → `<abs>/src/features/auth/**` (해당 층·슬라이스 아래 전부).
const layerGlob = (...segments) => path.join(SRC, ...segments, '**');

// features 목록은 손으로 나열하지 않고 디렉토리에서 읽는다 — 새 feature 가 생기면 자동으로
// 격리 대상에 편입돼 하드코딩 드리프트를 막는다(구조 테스트도 같은 방식으로 목록을 읽는다).
const FEATURES = fs
  .readdirSync(path.join(SRC, 'features'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// 각 층이 import 하면 안 되는 "더 위쪽" 층들의 glob 목록.
const ABOVE_FEATURES = [
  layerGlob('widgets'),
  layerGlob('pages'),
  layerGlob('app'),
  layerGlob('app-shell'),
];
const ABOVE_ENTITIES = [layerGlob('features'), ...ABOVE_FEATURES];
const ABOVE_WIDGETS = [
  layerGlob('pages'),
  layerGlob('app'),
  layerGlob('app-shell'),
];
const ABOVE_PAGES = [layerGlob('app'), layerGlob('app-shell')];
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

module.exports = defineConfig([
  expoConfig,
  {
    // .claude/** = 에이전트·스킬·Workflow 스크립트(dictate.js 등). 워크플로 JS는 최상위 await/return을
    // 쓰는 런타임 스크립트라 일반 ESM 린트 대상이 아니다(파싱 에러). 앱 소스 아님 → 린트 제외.
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*', 'web/*', '.claude/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': ['error', { zones: layerZones }],
      // NativeWind 전역 스타일은 side-effect import 이며 확장자 resolver 대상이 아니다.
      'import/no-unresolved': ['error', { ignore: ['\\.css$'] }],
    },
  },
  {
    // shared/ui 전체를 상태·라우팅·네트워크 import 금지로 묶을 수는 없다(BottomTabBar처럼
    // shared/ui에 정당하게 상태를 가질 거주자가 있을 수 있다) — 그래서 "프레젠테이션 순수성"이
    // 필요한 파일만 좁게 막는다. StateNotice.tsx는 features/stay/ui에서 승격되며 그 경계를 재던
    // stay 쪽 소스 스캔(staySearchStructure.test.ts의 FORBIDDEN_IN_STAY_UI)의 사정거리 밖으로
    // 나갔다(TRIP-222 03b W-3) — jest 스캔은 새로 못 만들어(sharedUiStructure.test.ts 동결)
    // 여기서 대신 막는다.
    files: ['src/shared/ui/StateNotice.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
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
          ],
        },
      ],
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
