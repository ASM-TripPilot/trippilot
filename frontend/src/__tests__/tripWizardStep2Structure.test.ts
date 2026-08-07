/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-225 g02 거점 숙소 2/2 — **층 책임과 판정 권위의 소스면 심판.**
 *
 * ── 이 파일은 `tripWizardStep2Placeholder.test.ts`의 후계다 ──────────────────
 * 그 파일(TRIP-206 AC-7)은 `/trips/new/step2`가 **자리만**임을 잠갔다: 소스에 `준비 중`이 있고
 * `@/pages`·`@/features`를 물어오지 않는다. 이번 티켓이 그 라우트를 실 화면으로 바꾸므로 두
 * 단언은 **정당하게 만료**됐다 — 버그가 아니라 계약 만료이고, 그 파일 자신이 처분 시점을
 * *"그 화면은 TRIP-84 몫이다"*로 적어 뒀다(이번 칸이 그 TRIP-84). 잠그던 성질은 하나도 잃지
 * 않고 **부호만 뒤집어** 여기서 이어받는다:
 *   - P-0 탐지기 자가검사 → 아래 첫 describe (헬퍼를 그 파일에서 복사, 이번 칸 문자열로 재검증)
 *   - P-1 라우트 실재      → AC-G1 (실재 + `export default`)
 *   - P-2 층 책임          → AC-G1 (이제는 **가리켜야** 하고, 마크업은 **없어야** 한다)
 *
 * 무엇을 보장하나 — 렌더로는 볼 수 없는 네 가지:
 *  1. **AC-G1** 라우트는 얇다. 배선은 `pages/trip-new-step2`가 진다(`step1.tsx` 선례).
 *  2. **★1 (INV-2 · 01b D16-b)** 막을지의 권위가 `blocked` 필드 하나다. 클라이언트가 `days`를
 *     세서 같은 결론에 도달하는 구현은 **렌더 단언으로는 구별되지 않는다** — 소스에서만 보인다.
 *  3. **★7 (TRIP-224 계승)** 정렬·박 번호 산식은 `toBaseSections`가 소유한다. 화면이 몰래 다시
 *     정렬해도 결과가 같으면 렌더 단언은 통과한다.
 *  4. **층 경계** 화면(`features/trip/ui`)은 조회·라우팅·스토어를 모른다(README §59·§66).
 *
 * ⚠️ **전처리 함정(02a ★15).** 모든 스캔은 주석을 걷어낸 소스를 본다. 이 칸의 소스에는 설계
 * 근거를 적은 머리말이 붙고 그 안에 `GAP`·`OVERLAP`·`sort`·Figma URL이 **실제로 등장한다**
 * (지금 이 머리말이 그 증거다) — 걷지 않으면 산문이 부정 단언을 red로 만드는 **거짓 red**가 난다.
 * 반대로 순진한 `//.*` 제거는 `'https://…'`의 슬래시를 주석 시작으로 오인해 그 줄의 진짜 코드를
 * 통째로 지운다(2026-07-31 실사고). 아래 `stripComments`는 그 사고를 고친 사본이고, 첫 describe가
 * **전처리와 탐지기를 함께 태워** 둘이 서로를 지우지 않음을 회귀 가드로 잠근다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은 it
 * 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는다.
 */

const SRC_ROOT = resolve(__dirname, '..');

const ROUTE_REL = 'app/trips/new/step2.tsx';
const BARREL_REL = 'pages/trip-new-step2/index.ts';
const PAGE_REL = 'pages/trip-new-step2/ui/TripNewStep2Page.tsx';
const SCREEN_REL = 'features/trip/ui/TripWizardStep2Screen.tsx';
const MODEL_REL = 'features/trip/model/baseScreen.ts';
const HOOKS_REL = 'features/trip/model/useTripBases.ts';

/**
 * 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** — `'https://…'`의 슬래시를
 * 주석 시작으로 오인하지 않기 위한 것이고, 완전한 파서를 만들지 않는 것이 의도다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 구현 전에도 "무엇이 없는가"를 깨끗한 assertion diff 로 남기기 위해서다
 * (ENOENT 예외로 죽으면 diff가 안 남는다). 빈 문자열이 부정 단언을 공짜로 통과시키는 것은 같은
 * it 안의 긍정 짝이 먼저 막는다. */
function readOne(rel: string): string {
  const full = join(SRC_ROOT, rel);
  if (!existsSync(full)) return '';
  return stripComments(readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: existsSync(join(SRC_ROOT, rel)) };
}

/** 주어진 소스들에서 needle을 가진 파일 목록 — 위반을 **파일 이름과 함께** 남긴다. */
function offenders(
  sources: { file: string; source: string }[],
  needle: string | RegExp
): string[] {
  const test =
    typeof needle === 'string'
      ? (source: string) => source.includes(needle)
      : (source: string) => needle.test(source);
  return sources.filter(({ source }) => test(source)).map(({ file }) => file);
}

function read(rels: string[]): { file: string; source: string }[] {
  return rels.map((file) => ({ file, source: readOne(file) }));
}

describe('P-0 계승 · 탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('머리말은 걷히고, 코드의 URL·정렬·박 산식·import는 살아남는다', () => {
    // 이 칸에서 실제로 쓰일 화면 소스를 본뜬 문자열이다 — 머리말 Figma URL, 주석 속 상태 코드,
    // 주석 처리된 정렬, 그리고 코드 쪽의 URL·정렬·박 템플릿이 전부 들어 있다.
    // 핵심은 **이 셋이 서로를 지우는가**다.
    const sample = [
      '/**',
      ' * g02 거점 숙소 2/2 — Figma https://www.figma.com/design/1MTF3dt?node-id=1707-1183',
      ' * days를 세서 blocked를 만들지 않는다. GAP·OVERLAP을 열거하지 않는다.',
      ' * 정렬(sort)은 toBaseSections가 소유한다.',
      ' */',
      "import { toBaseSections } from '@/features/trip/model/baseSections';",
      '// const dead = rows.sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : 1));',
      'const blocked = coverage.data?.blocked ?? false;',
      'const label = `${firstNight}박`;',
      "const url = 'https://cdn.example.com/x.jpg';",
      'const rows = toBaseSections(bases, stays, trip);',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 걷지 않으면 "GAP을 열거하지 않는다"고 **적은 주석 자체가**
    //    아래 부정 단언을 red 로 만든다(거짓 red).
    expect(stripped).not.toContain('figma.com');
    expect(stripped).not.toContain('GAP');
    expect(stripped).not.toContain('OVERLAP');
    expect(/\.sort\s*\(/.test(stripped)).toBe(false);

    // ② ★ 조합 검증 — 전처리를 태운 **뒤에도** 탐지 대상이 살아 있어야 한다. 순진한 `//.*`
    //    제거는 URL 줄을 `const url = 'https:` 로 잘라 URL 단언을 공짜로 통과시킨다.
    expect(stripped).toContain("const url = 'https://cdn.example.com/x.jpg';");
    expect(stripped).toContain('toBaseSections(bases, stays, trip)');
    expect(stripped).toContain('coverage.data?.blocked');

    // ③ 진짜 위반은 여전히 잡힌다 — 탐지기가 전처리 때문에 눈이 먼 것이 아니다.
    expect(/\.sort\s*\(/.test(stripComments('rows.sort((a, b) => 0);'))).toBe(
      true
    );
    expect(/\$\{[^}]*\}박/.test(stripped)).toBe(true);
  });
});

describe('AC-G1 · 라우트는 얇다 (P-1 · P-2 계승, 부호가 뒤집힌 짝)', () => {
  it('step2 라우트가 pages 배선을 가리키고, 마크업과 조회를 직접 갖지 않는다', () => {
    // 긍정 짝 ① — 파일이 실재한다. `typedRoutes: true`라 이 파일이 사라지면
    // `router.push('/trips/new/step2')`가 타입에서 막힌다(TRIP-206이 이 라우트를 세운 이유).
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const source = readOne(ROUTE_REL);

    // 긍정 짝 ② — 빈 파일이 아니다. 이게 없으면 아래 금칙 0건을 빈 파일도 통과한다.
    expect(source).toMatch(/export\s+default\s+function\s+\w+/);
    // 본체 — 배선 층을 실제로 가리킨다. **placeholder 가드가 금지하던 바로 그 import다.**
    expect(source).toContain('@/pages/trip-new-step2');

    // 부정 — 라우트가 화면을 직접 그리거나 서버를 직접 부르면 층이 무너진다
    // (`step1.tsx`는 6줄이다).
    const FORBIDDEN = [
      'View',
      'Text',
      'useTripBases',
      'useSavedStays',
      '@tanstack/react-query',
    ];
    expect(FORBIDDEN.filter((needle) => source.includes(needle))).toEqual([]);
  });
});

describe('d-층 파일이 실재하고 각자의 심볼을 갖는다', () => {
  it('배럴·배선·화면·순수 함수·훅 다섯이 서 있다', () => {
    [BARREL_REL, PAGE_REL, SCREEN_REL, MODEL_REL, HOOKS_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 배럴이 `export {}` 빈 스텁이 아니라 실제로 심볼을 재수출한다(fsdStructure AC-2 규약).
    expect(readOne(BARREL_REL)).toContain('TripNewStep2Page');
    expect(readOne(PAGE_REL)).toMatch(/export function TripNewStep2Page\b/);
    expect(readOne(SCREEN_REL)).toMatch(
      /export function TripWizardStep2Screen\b/
    );
  });
});

describe('★1 · 막을지의 권위는 blocked 필드 하나다 (INV-2 · 01b D16-b)', () => {
  it('네 소스 어디에도 GAP·OVERLAP 리터럴이 없고, 배선은 blocked를 읽는다', () => {
    const sources = read([PAGE_REL, SCREEN_REL, MODEL_REL, HOOKS_REL]);

    // 긍정 짝 — 배선이 실제로 서버 판정을 **읽는다**. 없으면 아무 판정도 안 하는 빈 파일이
    // 아래 부정 단언을 공짜로 통과한다.
    expect(readOne(PAGE_REL)).toContain('blocked');
    // 긍정 짝 — 나열 규칙이 "AUTO가 아닌 것"이라는 **배제 목록**으로 서 있다(01b D16).
    expect(readOne(MODEL_REL)).toContain('AUTO');

    // 본체 — `blocked`를 클라이언트가 만들려면 **어느 상태가 나쁜가**를 열거해야 한다.
    // 그 열거가 0건이면 재판정 통로가 구조적으로 막힌다. 나열 규칙이 배제 목록이라
    // 정상 구현은 이 둘을 적을 이유가 없다.
    expect(offenders(sources, 'GAP')).toEqual([]);
    expect(offenders(sources, 'OVERLAP')).toEqual([]);
  });
});

describe('★7 · 정렬과 박 번호는 toBaseSections가 소유한다 (TRIP-224 계승)', () => {
  it('배선·화면이 다시 정렬하지 않고 박 라벨을 다시 만들지 않는다', () => {
    const sources = read([PAGE_REL, SCREEN_REL]);

    // 긍정 짝 — 배선이 그 순수 함수를 실제로 쓴다. 없으면 "아무 데도 안 쓰면서 정렬도 안 하는"
    // 빈 파일이 통과한다. TRIP-224가 소비자 0으로 남긴 함수의 **첫 소비자**가 이 파일이다.
    expect(readOne(PAGE_REL)).toContain('toBaseSections');

    // 부정 ① — 화면이 몰래 다시 정렬해도 결과가 같으면 렌더 단언은 통과한다. 진실이 두 곳으로
    // 갈리는 것을 여기서만 막을 수 있다.
    expect(offenders(sources, /\.sort\s*\(/)).toEqual([]);

    // 부정 ② — `${n}박` 템플릿은 박 번호 산식을 다시 짰다는 뜻이다. `nightLabel`을 **받아
    // 그대로 쓰는** 구현에는 이 형태가 나올 수 없다(`${nightLabel}에 지정됨`은 걸리지 않는다).
    expect(offenders(sources, /\$\{[^}]*\}박/)).toEqual([]);
  });

  it('toBaseSections가 읽는 만큼만 요구한다 — 여행은 네 번째 조회가 아니다', () => {
    // 이 칸의 조회는 **셋**이다(01b D7·D14가 그 셋으로 실패 규칙을 짰다). 그런데
    // `toBaseSections`의 세 번째 인자는 `Trip` 전체 타입이라, 배선이 가진 `startDate`
    // 하나로는 호출할 수 없다 — `GET /trips/{tripId}`를 넷째로 붙이거나 `as Trip`으로
    // 얼버무리는 두 갈래가 생긴다. 둘 다 나쁘다(전자는 실패 규칙이 흔들리고, 후자는
    // 그 파일 자신이 *"`as Trip` 캐스팅으로 얼버무리면 계약 변경을 놓친다"*고 적어 거부했다).
    //
    // 그래서 **읽는 만큼으로 좁힌다** — 함수가 실제로 쓰는 필드는 `trip.startDate` 하나뿐이다.
    // `Trip`은 `Pick<Trip,'startDate'>`에 그대로 대입되므로 TRIP-224의 동결 테스트는 손대지
    // 않고 계속 통과한다(픽스처가 인라인 리터럴이 아니라 `trip()` 헬퍼의 반환값이라
    // 초과 속성 검사에도 걸리지 않는다 — 실측).
    //
    // ⚠️ 타입 계약이라 jest 단독으로는 절반만 잰다. 나머지 절반은 `pnpm tsc`가 진다
    // (02 매핑표의 "명령 기반 검증" 행).
    const sectionsSource = readOne('features/trip/model/baseSections.ts');

    // 긍정 짝 — 읽은 것이 정말 그 파일이고, 함수가 그대로 서 있다.
    expect(sectionsSource).toMatch(/export function toBaseSections\b/);
    expect(sectionsSource).toContain("Pick<Trip, 'startDate'>");

    // 배선은 그 좁은 값을 스토어에서 만들어 넘긴다 — 여행 조회를 새로 붙이지 않았다.
    expect(readOne(PAGE_REL)).toContain('startDate');
    expect(readOne(PAGE_REL)).not.toContain('useGetTripsTripId');
  });
});

describe('층 경계 · 화면은 판정하지 않는다 (README §59·§66)', () => {
  it('화면이 조회·라우팅·스토어·생성 클라이언트를 모른다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 읽은 것이 정말 그 화면이고, 아이콘은 같은 feature 안에서 가져온다
    // (`features/stay`·`features/home`의 글리프를 쓰면 importBoundary 위반이다).
    expect(screenSource).toMatch(/export function TripWizardStep2Screen\b/);
    expect(screenSource).toContain('@/features/trip/ui/TripGlyphs');

    // 부정 — 화면이 이 중 하나라도 쥐면 "완성된 문자열/불리언만 받는다"는 계약이 깨지고,
    // 판정이 배선과 화면 두 곳에 살게 된다.
    const FORBIDDEN = [
      'expo-router',
      '@tanstack/react-query',
      'useTripBases',
      'useTripCoverage',
      'useSavedStays',
      'useTripWizardStore',
      '@/shared/api/generated',
      'toBaseSections',
    ];
    expect(FORBIDDEN.filter((needle) => screenSource.includes(needle))).toEqual(
      []
    );
  });
});
