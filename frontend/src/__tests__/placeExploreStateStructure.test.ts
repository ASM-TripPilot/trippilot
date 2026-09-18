/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-G3(판정의 단일 출처) · AC-G7(무회귀의 기계) · 01b Seed Q1 ⓑ(승격 재사용) ·
 * Q5(타이머 금지) · Q12(좌표 방어 배선) — d04 **상태 층** 소스 스캔 가드.
 *
 * 왜 파일을 새로 쓰나: `placeExploreStructure.test.ts` 는 게이트① 해시가 동결된 TRIP-221
 * 산출물이라 한 글자도 못 고친다. 그 파일이 이미 보는 것(INV-3 · zustand · URL 리터럴 ·
 * 타 feature import · 화면 순수성 · 층 책임)은 모집단이 **디렉토리 재귀**라 이 칸의 새 파일이
 * 자동으로 편입된다 — 그래서 여기서 다시 세우지 않는다. 이 파일이 메우는 것은 그 가드에
 * **없는 것들**뿐이다:
 *   ① 상태 판정을 화면이 다시 하지 않는다(AC-G3)
 *   ② 새 prop 이 전부 옵셔널이다(AC-G7 — 필수로 만들면 동결 렌더 헬퍼가 tsc 에서 깨진다.
 *      그 실패를 jest 단계로 당겨 온다)
 *   ③ 승격한 `StateNotice` 를 **다시 그리지 않고 가져다 쓴다**(01b Seed Q1 ⓑ)
 *   ④ 배너에 타이머를 쓰지 않는다(01b Seed Q5 — 가짜 타이머가 들어오면 이 칸의 PBT·상태
 *      판정이 전부 타이밍 의존이 된다)
 *   ⑤ 좌표 방어 순수 함수가 **실제로 불린다**(Q12 — 만들어 두고 안 부르는 상태를 막는다)
 *   ⑥ 새로 생기는 상태 부품 파일이 토큰 스캔 사정거리 안에 있다(동결 가드의 hex 모집단은
 *      `PlaceExploreScreen.tsx` **1파일 완전일치**라 새 파일이 밖으로 샌다)
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`).
 * **가짜 통과 방지 규약**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은 it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** ①③④⑤⑥ 은 층 규칙·결정 자체를 잠근다(판정 단일 출처 · 승격
 * 재사용 · 타이머 금지 · 토큰 경유). **B. 이행 체크포인트 — 한시적.** ② 의 prop 이름 3종은
 * 이번 칸의 계약 스냅숏이라 정당한 리네임에 red 를 낸다. **B 카운터 = 0.** 정당한 작업이
 * ② 때문에 red 를 낸 것이 2회 누적되면 즉시 "동결 헬퍼가 넘기는 8 prop 만으로 렌더된다"는
 * 렌더 단언(`PlaceExploreScreen.states.test.tsx` 무회귀 it)만 남기고 ② 를 뗀다.
 */

const ROOT = path.resolve('src');

const SCREEN_REL = 'features/explore/ui/PlaceExploreScreen.tsx';
const PAGE_REL = 'pages/place-explore/ui/PlaceExplorePage.tsx';

/** 타이머 금지 모집단 — 상태·배너가 사는 세 층 + 승격 컴포넌트가 사는 곳. */
const TIMER_SCAN_DIRS = [
  path.join(ROOT, 'features', 'explore'),
  path.join(ROOT, 'pages', 'place-explore'),
  path.join(ROOT, 'app', 'explore'),
  path.join(ROOT, 'shared', 'ui'),
];

const EXPLORE_UI_DIR = path.join(ROOT, 'features', 'explore', 'ui');

/**
 * `features/explore/ui` 토큰 스캔 면제 2종.
 *  - `*Glyphs.tsx` — SVG stroke/fill 색은 className 으로 줄 수 없어 raw hex 가 정당하다.
 *  - `RegionPickerScreen.tsx` — 이 칸이 만들지 않은 기존 파일이고 `placeholderTextColor="#9AA1AB"`
 *    (= `muted-soft` 토큰색)를 갖는다. 넓히는 순간 남의 빚이 이 칸의 red 가 된다.
 * 면제는 **자기검사와 함께** 쓴다(아래 it).
 */
const HEX_EXEMPT = ['features/explore/ui/RegionPickerScreen.tsx'];

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
 * 스캔 전처리 — 주석을 걷어낸다. 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지
 * 않는다**(`'https://…'` 의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다).
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
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : listSourceFiles(full);
      }
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

function readOne(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function timerScanSources() {
  return readAll(TIMER_SCAN_DIRS.flatMap((dir) => listSourceFiles(dir)));
}

/** 토큰 스캔 대상 — `features/explore/ui` 재귀에서 글리프와 면제 파일을 뺀 나머지.
 * 스켈레톤 부품이 어떤 이름으로 생기든 자동으로 여기 들어온다. */
function exploreUiStyledSources() {
  return readAll(
    listSourceFiles(EXPLORE_UI_DIR).filter((file) => !/Glyphs\.tsx$/.test(file))
  ).filter(({ file }) => !HEX_EXEMPT.includes(file));
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석은 걷히고, 코드의 URL·라우트·타이머 호출은 살아남는다', () => {
    const sample = [
      '/**',
      ' * d04 상태 — https://www.figma.com/design/x 참조.',
      ' */',
      '// const dead = setTimeout(hide, 3000);',
      "router.push('/(auth)/login'); // 주석 속 setTimeout",
      'const timer = setTimeout(hide, 3000);',
      "const href = '/explore/region?purpose=trip';",
      "const bad = 'https://cdn.example.com/x.jpg';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 걷지 않으면 "타이머를 쓰지 않는다"고 적은 주석 자체가
    //    부정 단언을 red 로 만든다(거짓 RED). 표본의 `setTimeout` 3개 중 2개가 주석이므로
    //    걷고 나면 **정확히 1개**(코드)만 남아야 한다 — ② 의 true 가 주석 잔재가 아님이
    //    이 개수로 드러난다.
    expect(stripped).not.toContain('figma.com');
    expect(stripped.split('setTimeout').length - 1).toBe(1);

    // ② ★ 조합 검증 — 전처리를 태운 **뒤에도** 탐지 대상이 살아 있어야 한다. 순진한 `//.*`
    //    제거는 URL 줄을 `const bad = 'https:` 로 잘라 URL 단언을 공짜로 통과시키고, 같은
    //    사고가 라우트 리터럴에도 난다(실측).
    expect(stripped).toContain("router.push('/(auth)/login');");
    expect(stripped).toContain("const href = '/explore/region?purpose=trip';");
    expect(stripped).toContain("const bad = 'https://cdn.example.com/x.jpg';");
    expect(/\bsetTimeout\b/.test(stripped)).toBe(true);
  });
});

describe('AC-G3 · 상태 판정의 단일 출처', () => {
  it('resolvePlaceListState 는 페이지만 부르고, 화면은 다시 부르지 않는다', () => {
    const pageSource = readOne(PAGE_REL);
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 배선이 실제로 판정을 한다.
    expect(pageSource).toContain('resolvePlaceListState');
    // 부정 — 화면이 다시 판정하면 진실이 두 곳에 생긴다(`staySearchStructure.test.ts` 마지막
    // describe 와 같은 논리). 화면은 `state` prop 을 받아 그리기만 한다.
    expect(screenSource).not.toContain('resolvePlaceListState');
  });
});

describe('AC-G7 · 새 prop 은 전부 옵셔널이다', () => {
  it('PlaceExploreScreenProps 의 상태·대기·배너 prop 이 물음표를 달고 있다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 읽은 것이 정말 그 화면이다.
    expect(screenSource).toMatch(/export function PlaceExploreScreen\b/);

    // TRIP-221 의 동결 렌더 헬퍼는 prop 8개만 넘긴다. 하나라도 필수로 선언하면 그 파일이
    // tsc 에서 깨지는데, jest 는 통과해 버려 [검증]까지 발견이 늦는다 — 여기서 당겨 잡는다.
    expect({
      state: /\bstate\?:/.test(screenSource),
      pendingPoiIds: /\bpendingPoiIds\?:/.test(screenSource),
      saveError: /\bsaveError\?:/.test(screenSource),
    }).toEqual({ state: true, pendingPoiIds: true, saveError: true });
  });
});

describe('01b Seed Q1 ⓑ · 승격한 안내 블록을 가져다 쓴다', () => {
  it('화면이 shared/ui 의 StateNotice 를 import 하고, explore 안에 사본을 만들지 않는다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 — 정답은 "explore 가 stay 를 import" 도 "explore 에 복제" 도 아니라 shared 승격이다
    // (`frontend/README.md` §60). 타 feature import 자체는 동결 가드가 이미 0건으로 막는다.
    expect(screenSource).toContain('@/shared/ui/StateNotice');

    // 부정 — 같은 컴포넌트를 다시 그리면 승격의 의미가 사라지고 두 벌이 갈라진다.
    const offenders = readAll(
      listSourceFiles(path.join(ROOT, 'features', 'explore'))
    )
      .filter(({ source }) => /export function StateNotice\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('01b Seed Q5 · 배너에 타이머를 쓰지 않는다', () => {
  it('탐색 표면과 shared/ui 어디에도 setTimeout·setInterval 이 없다', () => {
    const sources = timerScanSources();

    // 긍정 짝 — 모집단에 화면·배선이 실제로 들어 있다.
    const files = sources.map(({ file }) => file);
    expect(files).toContain(SCREEN_REL);
    expect(files).toContain(PAGE_REL);

    // 부정 — 배너는 **다음 조작 시** 사라진다. 타이머로 지우면 테스트에 가짜 타이머가 들어오고,
    // 그 순간 이 칸의 상태 판정·PBT 가 전부 타이밍 의존이 된다.
    const offenders = sources.flatMap(({ file, source }) =>
      ['setTimeout', 'setInterval']
        .filter((needle) => source.includes(needle))
        .map((needle) => `${file}: ${needle}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe('01b Seed Q12 · 좌표 방어가 실제로 배선돼 있다', () => {
  it('페이지가 담기 전에 hasUsableCoords 를 부른다', () => {
    const pageSource = readOne(PAGE_REL);

    // 순수 함수만 만들어 두고 아무도 안 부르면 방어는 문서일 뿐이다. 이 단언이 그 유일한
    // 심판이다 — 계약(`Place.lat`·`lng` required·non-nullable)이 이 갈래를 만들 수 없어
    // 통합 테스트로는 계약 위반 응답을 손으로 만들어야만 닿는다.
    expect(pageSource).toContain('hasUsableCoords');
  });
});

describe('토큰 우회 금지 — 새로 생기는 상태 부품까지 (사정거리 확장)', () => {
  it('explore/ui 의 화면·상태 부품이 className 스타일링이고 raw hex 가 0건이다', () => {
    const all = readAll(listSourceFiles(EXPLORE_UI_DIR)).map(
      ({ file }) => file
    );
    // 면제 자기검사 — 오타면 면제가 무효가 되고(정당한 파일이 red), 파일이 사라지면 면제가
    // 과잉이 된다(조용한 통과). 둘 다 잡는다.
    HEX_EXEMPT.forEach((exempt) => expect(all).toContain(exempt));

    const sources = exploreUiStyledSources();

    // 긍정 짝 — 이 칸의 화면이 실제로 스캔됐고, 대상이 전부 className 으로 스타일링돼 있다.
    expect(sources.map(({ file }) => file)).toContain(SCREEN_REL);
    sources.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    // 부정 — 동결 가드의 hex 모집단은 화면 1파일 완전일치라 새 부품이 밖으로 샌다. 여기서 메운다.
    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
