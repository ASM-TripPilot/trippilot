// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// import 경계: features/* 는 다른 feature 를 직접 import 할 수 없고 shared/ 만 참조한다.
// 각 feature 를 target 으로, 자기 자신을 예외로 두어 "형제 feature import" 만 금지한다.
const FEATURES = [
  'onboarding',
  'home',
  'stay',
  'trip',
  'itinerary',
  'execution',
  'planb',
  'archive',
  'notification',
  'settings',
];

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
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*', 'web/*'],
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
