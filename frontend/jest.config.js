// MSW 2 는 ESM 우선 배포라, 그 의존 트리(rettime·@mswjs/interceptors 등)를 babel 로
// 트랜스폼해야 jest(CJS) 가 require 할 수 있다. jest-expo 기본 whitelist(RN/expo) 를
// 유지한 채 msw 생태계 패키지명을 추가한다 — pnpm 중첩 node_modules 세그먼트 기준.
const mswTransformAllowed = [
  'msw',
  '@mswjs',
  '@bundled-es-modules',
  '@open-draft',
  'until-async',
  'strict-event-emitter',
  'headers-polyfill',
  'outvariant',
  'is-node-process',
  'graphql',
  'rettime',
  'path-to-regexp',
  'cookie',
  'tough-cookie',
  'statuses',
].join('|');

const expoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // 이 설정(node 버킷)은 --experimental-vm-modules 아래 돈다(importBoundary 의 ESLint
  // 동적 import 가 필요). MSW 통합테스트(.integration.test)는 그 flag 아래서 ESM 이 안 떠서
  // 여기서 제외하고, flag 없는 jest.integration.config.js 로 따로 돌린다.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.'],
  transform: {
    // 프리셋의 babel transform 키(\.[jt]sx?$)는 .mjs 를 못 잡는다. MSW 의존 트리는
    // .mjs(ESM) 로 배포되므로 .mjs 도 babel 로 트랜스폼하도록 규칙을 더한다.
    ...expoPreset.transform,
    '^.+\\.mjs$': [
      'babel-jest',
      {
        caller: {
          name: 'metro',
          bundler: 'metro',
          platform: 'ios',
          // metro caller 는 기본적으로 ESM 을 보존한다 → jest(CJS) 가 못 읽는다.
          // 서드파티 .mjs 는 CommonJS 로 강제 변환한다.
          supportsStaticESM: false,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    `/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|${mswTransformAllowed}))`,
    '/node_modules/react-native-reanimated/plugin/',
  ],
  moduleNameMapper: {
    // MSW 의 exports 맵은 react-native 조건에서 ./node 를 null 로 두므로(RN jest env 가
    // 그 조건을 먼저 고른다) `msw/node` 가 해석되지 않는다. CJS dist 로 직접 매핑해 우회한다.
    '^msw/node$': '<rootDir>/node_modules/msw/lib/node/index.js',
    '^msw$': '<rootDir>/node_modules/msw/lib/core/index.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
