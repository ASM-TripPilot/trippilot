// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// import 경계: features/* 는 다른 feature 를 직접 import 할 수 없고 shared/ 만 참조한다.
// 각 feature 를 target 으로, 자기 자신을 예외로 두어 "형제 feature import" 만 금지한다.
const FEATURES = ['onboarding', 'home'];

// auth 는 실재하지만 이 배열에 없다(선재 결함, 이 목록이 정리되기 전부터 빠져 있었다) — 넣으면
// auth → 다른 feature 방향 import 를 새로 막는 동작 변경이라 전용 테스트가 필요한 별건이다.
// 지금은 auth → onboarding 등 그 방향의 위반이 안 잡힌다는 사실만 여기 남겨둔다.

// `except` 의 경로는 **`from` 기준 상대경로**다(eslint-plugin-import 규약).
// `./src/features/${feature}` 로 쓰면 from 아래에서 다시 해석돼 예외가 하나도 잡히지 않고,
// 같은 feature 안의 형제 파일 import(`./TermsScreen`)까지 위반으로 잡힌다.
const featureIsolationZones = FEATURES.map((feature) => ({
  target: `./src/features/${feature}`,
  from: './src/features',
  except: [`./${feature}`],
  message:
    'features 간 직접 import 금지 — 데이터 공유는 shared/api, 화면 이동은 라우팅으로.',
}));

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
      'import/no-restricted-paths': ['error', { zones: featureIsolationZones }],
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
    // 기본 설정에 __dirname/__filename 전역이 빠져 있어 no-undef 오탐이 난다.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', __filename: 'readonly' },
    },
  },
]);
