/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-G2 (01b Seed Q1 ⓑ) — **`shared/ui` 디렉토리 재귀 스캔 신설.**
 *
 * 왜 이 파일이 이 칸의 필수 산출인가: `frontend/README.md` §60 은 두 feature 가 함께 쓰게 된
 * 컴포넌트를 `shared/` 로 승격하라고 정하는데, **`shared/ui` 를 훑는 디렉토리 스캔이 리포에
 * 하나도 없다**(실측: `shared/ui` 를 보는 유일한 파일이 `tabbarVisual.test.ts` 이고 그 모집단은
 * `BottomTabBar.tsx` **1파일 완전일치**다). 그래서 `StateNotice` 를 승격하는 순간 그 파일이
 * 토큰·경계 심판의 사정거리 **밖으로** 나간다. 정본을 따르는 것이 심판을 잃는 것이 되면 안 된다.
 *
 * 무엇을 보장하나 — `shared/ui` 전체가
 *  - `@/features/*` 를 import 하지 않는다(README §61: shared 는 features 를 모른다. 반대 방향은
 *    허용이고, 그 방향은 `importBoundary.test.ts` 가 이미 본다)
 *  - `duration` 식별자가 없다(INV-3 · BR-U1-54)
 *  - 서버 상태를 Zustand 로 복사하지 않는다(README §66) · URL 리터럴을 만들지 않는다(INV-1)
 *  - className 으로 스타일링되고 토큰화된 색을 raw hex 로 우회하지 않는다
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이
 * 리포 관례). 걷어내지 않으면 머리말 산문이 부정 단언을 대신 만족시키는 거짓 GREEN 을 낸다.
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것이 층 규칙(README §59·§60·§61·§66)과 INV-3 이라
 * 컴포넌트가 늘어도 갱신이 필요 없다 — 모집단이 디렉토리 재귀라 새 파일이 자동 편입된다.
 * 갱신이 필요한 순간은 `HEX_EXEMPT` 를 늘려야 할 때뿐이고, 그때는 면제 사유를 여기 적는다.
 * **B 없음** — 이 파일에는 특정 디자인 값을 고정하는 단언이 하나도 없다(그 층은
 * `tabbarVisual.test.ts` 가 맡는다).
 */

const ROOT = path.resolve('src');
const SHARED_UI_DIR = path.join(ROOT, 'shared', 'ui');

const STATE_NOTICE_REL = 'shared/ui/StateNotice.tsx';
const TABBAR_REL = 'shared/ui/BottomTabBar.tsx';
const STAY_STATE_NOTICE = path.join(
  ROOT,
  'features',
  'stay',
  'ui',
  'StateNotice.tsx'
);
const STAY_SCREEN = path.join(
  ROOT,
  'features',
  'stay',
  'ui',
  'StaySearchScreen.tsx'
);

/**
 * raw hex 스캔 면제 — `BottomTabBar.tsx` 는 SVG stroke/fill 색을 상수로 갖는다
 * (`const PRIMARY = '#ff385c'` · `const MUTED = '#6a6a6a'`). SVG 색은 className 으로 줄 수 없어
 * 정당하고, 그 두 상수는 이미 `tabbarVisual.test.ts` AC-V4 가 tailwind 토큰에 묶어 두고 있다.
 * 면제는 **자기검사와 함께** 쓴다(아래 it) — 오타로 면제가 무효/과잉이 되면 조용히 통과한다.
 */
const HEX_EXEMPT = [TABBAR_REL];

/** 토큰으로 이미 존재하는 9색 — raw hex 로 적으면 토큰 우회다(`placeExploreStructure` 와 동일). */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#9aa1ab',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f7f7f7',
  '#ffe4e9',
];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가
 * 소실된다). 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** —
 * `'https://…'` 의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readAll(files: string[]): { file: string; source: string }[] {
  return files.map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

function sharedUiSources() {
  return readAll(listSourceFiles(SHARED_UI_DIR));
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석은 걷히고, 코드의 URL·식별자는 살아남는다', () => {
    const sample = [
      '/**',
      ' * 안내 블록 — https://www.figma.com/design/x 의 1342:1364 를 옮긴 것.',
      ' * 이 컴포넌트는 duration 을 그리지 않는다(INV-3).',
      ' */',
      '// const dead = setTimeout(fn, 100);',
      "const bad = 'https://cdn.example.com/' + id + '.jpg';",
      'const t = setTimeout(fn, 100); // 주석 속 duration',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 산문·주석으로 적은 금칙어는 걸리지 않는다.
    expect(/\bduration\b/.test(stripped)).toBe(false);
    expect(stripped).not.toContain('figma.com');

    // ② ★ 가장 중요한 짝 — 코드의 URL 리터럴은 **살아남아야** 한다. 순진한 `//.*` 제거는
    //    이 줄을 `const bad = 'https:` 로 잘라 URL 단언을 공짜로 통과시킨다(실측).
    expect(stripped).toContain(
      "const bad = 'https://cdn.example.com/' + id + '.jpg';"
    );
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ③ 코드의 식별자도 살아남는다 — 전처리가 다 지우면 부정 단언 전부가 공허해진다.
    expect(stripped).toContain('const t = setTimeout(fn, 100);');
    expect(stripComments('const d = { duration: 1 };')).toContain('duration');
  });
});

describe('AC-G2 · shared/ui 모집단 — 승격이 실제로 일어났는가', () => {
  it('shared/ui 가 재귀로 스캔되고, 승격한 StateNotice 가 그 안에 있다', () => {
    const files = sharedUiSources().map(({ file }) => file);

    // 이 단언이 01b Seed Q1 ⓑ("StateNotice 만 shared/ui 승격")의 유일한 기계 심판이다.
    expect(files).toContain(STATE_NOTICE_REL);
    // 기존 거주자도 함께 잡혀야 한다 — 모집단이 한 파일로 쪼그라들면 아래 스캔이 공허해진다.
    expect(files).toContain(TABBAR_REL);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AC-G2 · shared 는 features 를 모른다 (README §59·§61·§66 · INV-1·INV-3)', () => {
  it('shared/ui 전체에 타 층 import·duration·zustand·URL 리터럴이 0건이다', () => {
    const sources = sharedUiSources();

    // 긍정 짝 — 모집단이 비어 있지 않고, 승격 파일이 실제로 그 컴포넌트다.
    const promoted = sources.find(({ file }) => file === STATE_NOTICE_REL);
    expect(promoted).toBeDefined();
    expect(promoted?.source).toMatch(/export function StateNotice\b/);

    // 부정 — 의존 방향이 뒤집히면 shared 가 feature 를 끌고 다니게 되어 승격의 의미가 사라진다.
    // eslint 는 이 방향을 안 잡는다(`eslint.config.js` 의 FEATURES 배열이 두 개뿐이고, 규칙이
    // features 쪽 파일에만 걸린다).
    const FORBIDDEN = ['@/features/', '@/pages/', 'zustand'];
    const offenders = sources.flatMap(({ file, source }) =>
      FORBIDDEN.filter((needle) => source.includes(needle)).map(
        (needle) => `${file}: ${needle}`
      )
    );
    expect(offenders).toEqual([]);

    const durationOffenders = sources
      .filter(({ source }) => /\bduration\b/i.test(source))
      .map(({ file }) => file);
    expect(durationOffenders).toEqual([]);

    const urlOffenders = sources
      .filter(({ source }) => /https?:\/\//.test(source))
      .map(({ file }) => file);
    expect(urlOffenders).toEqual([]);
  });
});

describe('AC-G2 · 토큰 우회 금지 — shared/ui', () => {
  it('면제 밖 파일이 className 으로 스타일링되고, 토큰화된 9색 raw hex 가 없다', () => {
    const sources = sharedUiSources();

    // 면제 자기검사 — 면제 원소가 모집단에 실제로 있어야 한다. 오타면 면제가 무효가 되고(=
    // 정당한 파일이 red), 파일이 사라지면 면제가 과잉이 된다(= 조용한 통과). 둘 다 잡는다.
    const files = sources.map(({ file }) => file);
    HEX_EXEMPT.forEach((exempt) => expect(files).toContain(exempt));

    const scanned = sources.filter(({ file }) => !HEX_EXEMPT.includes(file));

    // 긍정 짝 — 스캔 대상이 비어 있지 않고 전부 className 으로 스타일링돼 있다.
    expect(scanned.length).toBeGreaterThan(0);
    scanned.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    const offenders = scanned.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('01b Seed Q1 ⓑ · 승격은 이동이지 복제가 아니다', () => {
  it('features/stay 에서 StateNotice 가 사라지고, 숙소 화면이 shared 경로로 부른다', () => {
    // 부정 — 두 벌이 남으면 다음 사람이 어느 쪽을 고쳐야 할지 알 수 없다.
    expect(fs.existsSync(STAY_STATE_NOTICE)).toBe(false);

    const staySource = stripComments(fs.readFileSync(STAY_SCREEN, 'utf8'));
    // 긍정 짝 — 호출부가 실제로 승격 경로를 쓰고, 여전히 그 컴포넌트를 그린다(import 만
    // 바꾸고 렌더를 지운 상태를 차단한다).
    expect(staySource).toContain('@/shared/ui/StateNotice');
    expect(staySource).toMatch(/<StateNotice\b/);
  });
});
