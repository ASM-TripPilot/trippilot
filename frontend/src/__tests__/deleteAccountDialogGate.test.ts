/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-772 · 맹점 ② — 계정 삭제 2단 게이트(AC-12 · BR-U6-25)는 프로덕션 경로에서 1단부터만 열린다.
 *
 * 무엇을 보장하나:
 *  - `_dev` 밖 프로덕션 코드는 `DeleteAccountDialog` 를 이름 그대로 import 하고, JSX 로 쓸 때
 *    `onCancel`·`onConfirmDeletion` 두 prop 만 넘긴다(G2·G3). 2단부터 여는 수단은 프리뷰 전용이다.
 *  - 최종 삭제 버튼(`settings-delete-confirm-final`)은 게이트 컴포넌트 파일에만 있다 — 프리뷰의 2단
 *    얼굴도 그 컴포넌트의 실물이다(G4, `_dev` 포함).
 *
 * 게이트가 막는 것: 삭제 범위 고지(1단)를 거치지 않고 최종 확인(2단)에 닿는 경로. 기본값이 1단인지는
 * `DeleteAccountDialog.test.tsx`, 1단 후 POST 0·2단 후 1회는 `SettingsPage.test.tsx` 가 지킨다.
 *
 * census 순서: import/export 문(`from` 절)을 먼저 뽑고 그 안에서 모듈을 판정한다(하네스 규칙).
 * 주석을 걷은 원문을 보며, 전처리+탐지기 조합은 G0 이 합성 문자열로 매번 확인한다.
 * "없어야 한다" 단언은 SettingsScreen 앵커("있어야 한다")와 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const MODULE_NAME = 'DeleteAccountDialog';
const DEFINITION = 'features/settings/ui/DeleteAccountDialog.tsx';
const ANCHOR = 'features/settings/ui/SettingsScreen.tsx';
const ALLOWED_PROPS = ['onCancel', 'onConfirmDeletion'];
const FINAL_TEST_ID = 'settings-delete-confirm-final';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listSources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

/** src 기준 상대경로(구분자 `/`). */
const relOf = (full: string) => relative(SRC_ROOT, full).split(sep).join('/');

const isTestFile = (rel: string) =>
  /\.test\.tsx?$/.test(rel) ||
  rel.split('/').includes('__tests__') ||
  rel.split('/').includes('__mocks__');

/** import/export … from '<spec>' 문과 require(/import( 호출 — spec 마지막 조각이 모듈명인 것만. */
function moduleStatements(source: string): string[] {
  const found: string[] = [];
  const isModule = (spec: string) => spec.split('/').pop() === MODULE_NAME;
  for (const m of source.matchAll(
    /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g
  )) {
    if (isModule(m[1])) found.push(m[0]);
  }
  for (const m of source.matchAll(
    /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g
  )) {
    if (isModule(m[1])) found.push(m[0]);
  }
  return found;
}

/** 허용 형태는 `import { DeleteAccountDialog } from '…/DeleteAccountDialog'` 하나뿐. */
const ALLOWED_IMPORT = new RegExp(
  `^import\\s*\\{\\s*${MODULE_NAME}\\s*\\}\\s*from\\s*['"][^'"]*['"]$`
);

/**
 * `<DeleteAccountDialog` 여는 태그마다 최상위 prop 이름을 모은다. 중괄호 깊이·따옴표를 추적해
 * 깊이 0 의 식별자만 이름으로 본다(값 없는 불리언 prop 포함). 스프레드는 `{...}` 로 기록한다.
 */
function jsxPropsOf(source: string): string[][] {
  const tags: string[][] = [];
  for (const m of source.matchAll(
    new RegExp(`<${MODULE_NAME}(?![\\w$])`, 'g')
  )) {
    const names: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    for (let i = (m.index ?? 0) + m[0].length; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '{') {
        if (depth === 0 && source.startsWith('...', i + 1)) names.push('{...}');
        depth += 1;
        continue;
      }
      if (c === '}') {
        depth -= 1;
        continue;
      }
      if (depth > 0) continue;
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '>') break;
      const id = /^[A-Za-z_$][\w$-]*/.exec(source.slice(i));
      if (id) {
        names.push(id[0]);
        i += id[0].length - 1;
      }
    }
    tags.push(names);
  }
  return tags;
}

/** 허용 import 문과 JSX 태그 토큰을 지운 뒤에도 남는 모듈명 출현 수. */
function residualNameCount(source: string): number {
  let rest = source;
  for (const stmt of moduleStatements(source)) {
    if (ALLOWED_IMPORT.test(stmt.trim())) rest = rest.replace(stmt, '');
  }
  rest = rest.replace(new RegExp(`</?${MODULE_NAME}(?![\\w$])`, 'g'), '');
  return (rest.match(new RegExp(`\\b${MODULE_NAME}\\b`, 'g')) ?? []).length;
}

const ALL = listSources(SRC_ROOT).map((full) => ({
  rel: relOf(full),
  source: stripComments(readFileSync(full, 'utf8')),
}));
const NON_TEST = ALL.filter(({ rel }) => !isTestFile(rel));
const PRODUCTION = NON_TEST.filter(
  ({ rel }) => !rel.startsWith('app/_dev/') && rel !== DEFINITION
);

describe('TRIP-772 · 삭제 다이얼로그 2단 게이트 — 프로덕션은 1단부터만', () => {
  it('G0 탐지기 자가검사 — 주석·URL·화살표 값을 거친 결과가 기대대로 갈린다', () => {
    // 준비: 합성 소스(전처리 → 탐지기 순서로 실제 경로와 똑같이 태운다).
    const commented = stripComments(
      [
        "const u = 'https://example.com/a';",
        `// <${MODULE_NAME} extraProp onCancel={noop} />`,
        `/* <${MODULE_NAME} {...rest} /> */`,
        `<${MODULE_NAME}`,
        '  onCancel={() => setOpen(a === b)}',
        '  onConfirmDeletion={() => { go(); close(); }}',
        '/>',
      ].join('\n')
    );
    const flagged = stripComments(
      `<${MODULE_NAME} onCancel={noop} extraProp onConfirmDeletion={noop} />\n<${MODULE_NAME} {...rest} />`
    );
    const aliased = stripComments(
      `import { ${MODULE_NAME} as D } from './${MODULE_NAME}';\nconst x = <D />;`
    );
    const plain = stripComments(
      `import { ${MODULE_NAME} } from '@/features/settings/ui/${MODULE_NAME}';\nconst x = <${MODULE_NAME} onCancel={a} onConfirmDeletion={b} />;`
    );

    // 단언 (a)(b)(c): 주석 속 태그는 사라지고, URL 뒤 진짜 태그는 남으며, 값 안 식별자는 안 센다.
    expect(jsxPropsOf(commented)).toEqual([['onCancel', 'onConfirmDeletion']]);
    // 단언 (d): 값 없는 prop 과 스프레드를 잡는다.
    expect(jsxPropsOf(flagged)).toEqual([
      ['onCancel', 'extraProp', 'onConfirmDeletion'],
      ['{...}'],
    ]);
    // 단언 (e): 별칭 import 는 허용 형태가 아니고 이름 잔여로도 남는다. 짝: 정상 형태는 잔여 0.
    expect(moduleStatements(aliased)).toHaveLength(1);
    expect(ALLOWED_IMPORT.test(moduleStatements(aliased)[0])).toBe(false);
    expect(residualNameCount(aliased)).toBeGreaterThan(0);
    expect(moduleStatements(plain).map((s) => ALLOWED_IMPORT.test(s))).toEqual([
      true,
    ]);
    expect(residualNameCount(plain)).toBe(0);
  });

  it('G2 프로덕션 코드는 DeleteAccountDialog 를 이름 그대로 한 가지 형태로만 import 한다', () => {
    // 준비·실행: 프로덕션 범위의 모듈 import/export 문을 전수로 뽑는다(from 절 먼저).
    const statements = PRODUCTION.flatMap(({ rel, source }) =>
      moduleStatements(source).map((stmt) => ({ rel, stmt: stmt.trim() }))
    );

    // 단언: 앵커 — SettingsScreen 이 잡혔다(탐지기가 빈손이 아니다).
    expect(statements.map(({ rel }) => rel)).toContain(ANCHOR);
    // 단언: 허용 형태 밖(별칭·다른 이름·re-export·require 등)이 0.
    const offenders = statements.filter(
      ({ stmt }) => !ALLOWED_IMPORT.test(stmt)
    );
    expect(offenders).toEqual([]);
  });

  it('G3 프로덕션의 모든 <DeleteAccountDialog> 는 onCancel·onConfirmDeletion 두 prop 만 받는다', () => {
    // 준비·실행: 프로덕션 파일마다 여는 태그의 최상위 prop 이름을 모은다.
    const tags = PRODUCTION.flatMap(({ rel, source }) =>
      jsxPropsOf(source).map((props) => ({ rel, props }))
    );

    // 단언: 앵커 — SettingsScreen 의 태그가 정확히 두 prop 이다.
    expect(tags.filter(({ rel }) => rel === ANCHOR)).toEqual([
      { rel: ANCHOR, props: ALLOWED_PROPS },
    ]);
    // 단언: 허용 집합 밖 prop(스프레드 포함)이 어느 태그에도 없다.
    const offenders = tags.filter(({ props }) =>
      props.some((name) => !ALLOWED_PROPS.includes(name))
    );
    expect(offenders).toEqual([]);
  });

  it('G3′ 프로덕션에서 DeleteAccountDialog 이름은 허용 import 와 JSX 태그 자리에만 나온다', () => {
    // 준비·실행: 파일마다 허용 자리를 지운 뒤 남는 출현 수.
    const offenders = PRODUCTION.map(({ rel, source }) => ({
      rel,
      count: residualNameCount(source),
    })).filter(({ count }) => count > 0);
    // 앵커: 이름이 실제로 쓰이는 프로덕션 파일이 있다.
    const users = PRODUCTION.filter(({ source }) =>
      new RegExp(`\\b${MODULE_NAME}\\b`).test(source)
    ).map(({ rel }) => rel);

    // 단언.
    expect(users).toContain(ANCHOR);
    expect(offenders).toEqual([]);
  });

  it('G4 최종 삭제 버튼 testID 는 게이트 컴포넌트 파일에만 있다(_dev 포함)', () => {
    // 준비·실행: 테스트가 아닌 전 소스(프리뷰 포함)에서 최종 버튼 testID 를 가진 파일.
    const owners = NON_TEST.filter(({ source }) =>
      source.includes(FINAL_TEST_ID)
    ).map(({ rel }) => rel);

    // 단언: 정확히 정의 파일 하나(앵커 겸 부정 — 0 개도, 2 개 이상도 red).
    expect(owners).toEqual([DEFINITION]);
  });
});
