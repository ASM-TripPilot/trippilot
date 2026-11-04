/**
 * @jest-environment node
 */

/**
 * TRIP-1716 · 부팅 경로 계수 스크립트(`scripts/boot-import-count.cjs`)의 `runtimeSpecifiers` 계약.
 *
 * 무엇을 보장하나: 원문을 넣으면 그 원문에서 런타임 의존만 뽑는다 — 운영에서 접히는 `__DEV__` 분기,
 * 함수 안 지연 로드, 타입 전용 import 는 세지 않는다. 배럴 정리 결과(부팅 목록)는 jest 가 아니라
 * 스크립트 출력으로 본다(TRIP-1145).
 * 3동작 뼈대: 준비=원문 문자열 → 실행=runtimeSpecifiers → 단언=지정자 배열.
 */
import path from 'path';

type Lib = {
  runtimeSpecifiers: (file: string, src?: string, dev?: boolean) => string[];
};

const { runtimeSpecifiers } = jest.requireActual<Lib>(
  './boot-import-count.cjs'
);

// 없는 경로를 넘긴다 — 원문을 무시하고 파일을 읽는 구현은 ENOENT 로 터진다. 순서는 계약이 아니라 정렬해 비교.
const specsOf = (src: string) =>
  runtimeSpecifiers('virtual/never-exists.ts', src).sort();

// 접히는 분기 옆에 늘 두는 대조군 — 빈 배열을 돌려주는 구현이 "X 없음"을 공허 통과하지 못하게.
const CONTROL = "require('prod-control');";

describe('runtimeSpecifiers — 원문 주입', () => {
  it('원문을 주면 파일을 읽지 않고 그 원문에서 뽑는다', () => {
    expect(specsOf(CONTROL)).toEqual(['prod-control']);
  });

  it('원문을 안 주면 파일을 읽는다(walk 의 기본 경로)', () => {
    const file = path.join(__dirname, 'boot-import-count.cjs');

    expect(runtimeSpecifiers(file)).toEqual(
      expect.arrayContaining(['fs', 'path', 'typescript'])
    );
  });
});

describe('__DEV__ 가드 — 운영에서 접히는 분기는 세지 않는다', () => {
  it.each([
    [
      '실례 dev-fault(shared/api/index.ts)',
      "if (__DEV__ && process.env.NODE_ENV !== 'test') require('@/shared/dev-fault');",
    ],
    ['&& 오른쪽', "if (x && __DEV__) require('dev-right');"],
    ['괄호식', "if ((__DEV__)) require('dev-paren');"],
    ['괄호 안 && 중첩', "if (a && (__DEV__ && b)) require('dev-nested');"],
    [
      '삼항 조건이 &&',
      "const m = x && __DEV__ ? require('dev-ternary') : null;",
    ],
  ])('%s → dev 쪽 require 는 빠지고 대조군만 남는다', (_label, line) => {
    expect(specsOf(`${line}\n${CONTROL}`)).toEqual(['prod-control']);
  });

  it('__DEV__ 삼항은 운영 쪽(else) require 만 센다', () => {
    const src =
      "const m = __DEV__ ? require('dev-only') : require('prod-branch');";

    expect(specsOf(src)).toEqual(['prod-branch']);
  });

  it('if (__DEV__) 의 else 쪽 require 는 센다', () => {
    expect(specsOf("if (__DEV__) {} else require('else-branch');")).toEqual([
      'else-branch',
    ]);
  });

  // 과잉 접기 대조군 — "__DEV__ 가 들어 있으면 다 접는" 구현을 막는다.
  it.each([
    [
      '|| (운영에서도 x 가 참이면 돈다)',
      "if (__DEV__ || x) require('dev-or');",
      'dev-or',
    ],
    [
      '!__DEV__ (운영에서 도는 쪽)',
      "if (!__DEV__) require('not-dev');",
      'not-dev',
    ],
  ])('%s → 접지 않고 센다', (_label, line, spec) => {
    expect(specsOf(`${line}\n${CONTROL}`)).toEqual(
      [spec, 'prod-control'].sort()
    );
  });
});

describe('dev 그래프(TRIP-1770 — index.view 가드용)', () => {
  it('dev 가 참이면 __DEV__ 분기를 접지 않고 양쪽 require 를 센다', () => {
    const src =
      "const m = __DEV__ ? require('dev-only') : require('prod-branch');\nif (__DEV__) require('dev-if');";

    expect(
      runtimeSpecifiers('virtual/never-exists.ts', src, true).sort()
    ).toEqual(['dev-if', 'dev-only', 'prod-branch']);
  });
});

describe('최상위 vs 지연 · 타입 전용', () => {
  it('최상위 import·export * from·require 는 센다', () => {
    // `a` 를 값으로 써야 한다 — 안 쓰인 import 는 트랜스파일이 지운다.
    const src = [
      "import a from 'default-imp';",
      "export * from 'star';",
      "require('top-req');",
      'console.log(a);',
    ].join('\n');

    expect(specsOf(src)).toEqual(['default-imp', 'star', 'top-req']);
  });

  it('함수 안 require·import() 는 지연 로드라 세지 않는다', () => {
    const src = [
      "function f() { require('lazy-req'); return import('lazy-imp'); }",
      "const g = () => require('lazy-arrow');",
      CONTROL,
    ].join('\n');

    expect(specsOf(src)).toEqual(['prod-control']);
  });

  it('import type·타입으로만 쓴 import 는 세지 않고, 값으로 쓴 import 는 센다', () => {
    const src = [
      "import type { T } from 'type-only';",
      "import { U } from 'type-used';",
      "import { v } from 'value-used';",
      'export const x: T | U = v;',
    ].join('\n');

    expect(specsOf(src)).toEqual(['value-used']);
  });
});
