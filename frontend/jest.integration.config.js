// MSW 통합테스트 전용 설정(테스트 인프라).
//
// 왜 별도 설정인가: MSW 2 의존 트리는 ESM(type:module/.mjs)이라
// --experimental-vm-modules 가 켜지면 jest 가 이들을 ESM 로더로 보내고 CJS require 가 실패한다.
// 그래서 이 버킷은 flag **없이** 돌린다(순수 CJS 트랜스폼). 기본(node) 설정은 반대로 flag 가
// 필요한 테스트(`await import()`·eslintReleaseRules)를 담당한다 → 두 버킷을 pnpm test 가 순차 실행한다.
//
// 나머지 설정(preset·transform·moduleNameMapper)은 기본 설정을 그대로 상속한다.
const base = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/*.integration.test.[jt]s?(x)'],
  // 비동기 대기 기본 상한(RNTL `asyncUtilTimeout`)을 5초로 — 냉캐시·CPU 경합에서 첫 테스트가 1초를 넘긴다(TRIP-1365).
  // 테스트 하나의 상한은 비동기 대기 상한(5초)보다 커야 한다 — 같으면 대기 한 번만 늘어져도 jest 기본 5초에 먼저 걸려
  // "Exceeded timeout of 5000 ms for a test" 로 끊긴다(CI 실측: MyTripsListPage·LiveItineraryPage, 로컬은 통과).
  testTimeout: 20000,
  // base 의 reporters 는 bucket:'node' 라 반드시 덮어쓴다(안 덮으면 통합 버킷이 node 예산으로 판정된다).
  reporters: [
    'default',
    ['<rootDir>/scripts/noise-reporter.cjs', { bucket: 'integration' }],
  ],
  setupFilesAfterEnv: [
    ...(base.setupFilesAfterEnv ?? []),
    '<rootDir>/src/test-support/integrationSetup.ts',
  ],
};
