/**
 * @jest-environment node
 */
// TRIP-637 · entities/style-analysis 구조 가드(fs 소스 스캔) — entitiesStayStructure 동형.
//
// 무엇을 보장하나:
//  - AC-3 판정 한 곳: `resolveStyleFace`·`StyleFace` 정의와 서버 정식 플래그(`.official`) 읽기가
//    프로덕션 전체에서 `entities/style-analysis/lib/styleFace.ts` 한 파일뿐이다.
//  - AC-4 요약카드 배선: `styleCardModel.ts` 가 그 판정을 entities 에서 들여와 부른다.
//  - AC-5·AC-6 옛 자리 사본·재수출 shim 0: `features/reflection/model/styleThreshold.ts` 에 두 심볼 토큰 0.
//  - AC-6 경계: 두 심볼의 모든 import 출처가 entities 슬라이스이고, 슬라이스는 `@/shared` 만 본다.
//  - TRIP-956 AC-3 대칭(G7·G8): progress 폴백 `resolveStyleProgress` 는 `styleProgress.ts` 한 곳에 정의되고,
//    envelope 의 progress 칸을 직접 읽는 곳도 그 밖엔 없다. j05 페이지·요약카드 모델이 둘 다 그 함수를
//    들여와 부르고, 두 파일엔 `.progress` 토큰 자체가 없다(객체 단위 `progress ?? 기본값` 우회 차단).
//    j05 페이지는 그 결과를 `progress={resolveStyleProgress(envelope)}` 그대로 넘긴다(가공·인자 치환 차단).
//
// 전제: 모든 스캔은 주석을 걷은 코드만 본다(이력 주석은 허용). 모든 "없어야 한다"는 같은 it 의
// "있어야 한다"와 짝이다(빈 파일·틀린 경로의 공허 통과 차단 — 리포 관례).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const SLICE_REL = 'entities/style-analysis';
const STYLE_FACE_REL = 'entities/style-analysis/lib/styleFace.ts';
const OLD_THRESHOLD_REL = 'features/reflection/model/styleThreshold.ts';
const CARD_MODEL_REL = 'features/settings/model/styleCardModel.ts';
const PAGE_REL = 'pages/travel-style/ui/TravelStylePage.tsx';
const SCREEN_REL = 'features/reflection/ui/TravelStyleScreen.tsx';
/** TRIP-956 — progress 필드 단위 폴백의 자리. */
const STYLE_PROGRESS_REL = 'entities/style-analysis/lib/styleProgress.ts';

/** 판정 심볼 2종 — 함수와 얼굴 타입. */
const SYMBOLS = ['resolveStyleFace', 'StyleFace'];

/** 정의 탐지기 — 선언만 잡는다(import·호출·이웃 이름 `StyleFaceX` 는 불매치, 02a §5-A). */
const DEF_FN =
  /\bfunction\s+resolveStyleFace\s*\(|\b(?:const|let)\s+resolveStyleFace\s*=/;
const DEF_TYPE = /\b(?:type|interface)\s+StyleFace\b\s*[=<{]/;

/** 서버 정식 플래그 읽기(`envelope.official`·`envelope?.official`). */
const OFFICIAL_READ = /\.official\b/;

/** TRIP-956 폴백 함수 정의 탐지기 — 선언만(import·호출 불매치, 02a §5-A). */
const DEF_PROGRESS_FN =
  /\bfunction\s+resolveStyleProgress\s*\(|\b(?:const|let)\s+resolveStyleProgress\s*=/;

/** 호출 탐지기 — import 문장엔 괄호가 없어 안 걸린다. */
const CALL_PROGRESS_FN = /\bresolveStyleProgress\s*\(/;

/**
 * envelope 의 progress 칸 읽기(`x.progress.current`·`x?.progress?.required` …). 앞에 점이 있어야 하므로
 * 이미 폴백이 끝난 화면 prop(`progress.current`)·다른 도메인(`entry.progress`)은 안 걸린다(02a ★8).
 */
const PROGRESS_FIELD_READ = /\.progress\??\.(?:current|required)\b/;

/** progress 토큰 자체 — 두 소비처에만 거는 더 센 금지(02a ★10). */
const PROGRESS_TOKEN = /\.progress\b/;

/**
 * j05 페이지 prop 고정 — 공유 함수 결과를 가공·인자 치환 없이 그대로 넘긴다(TRIP-956 02c, 03b 경고-1).
 * 공백·줄바꿈은 `\s*` 로 흡수하고, 앞 글자 제약으로 `clampProgress=`·`x.progress=` 는 안 걸린다.
 */
const PAGE_PROGRESS_PROP =
  /(?<![\w$.])progress\s*=\s*\{\s*resolveStyleProgress\s*\(\s*envelope\s*\)\s*\}/;

/**
 * import·재수출 문장 파서 — `from` 절을 먼저 잡고 그 안의 이름 목록을 본다(심볼명 선검색은 사용처와
 * 섞인다). `[^}]*` 가 줄바꿈을 먹어 여러 줄 import 도 한 문장. 이름은 `type ` 접두·`as` 별칭을 걷는다.
 */
const IMPORT_RE =
  /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** 모든 모듈 지정자(`from '…'`·부수효과 `import '…'`·`require('…')`·동적 `import('…')`). */
const SPECIFIER_RE =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 블록 주석 먼저, 줄 주석은 바로 앞이 `:` 면 주석 아님(URL 보존). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importsOf(source: string): { names: string[]; from: string }[] {
  return [...source.matchAll(IMPORT_RE)].map((m) => ({
    names: (m[1] ?? '')
      .split(',')
      .map((part) =>
        (
          part
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0] ?? ''
        ).trim()
      )
      .filter(Boolean),
    from: m[2] ?? '',
  }));
}

function specifiersOf(source: string): string[] {
  return [...source.matchAll(SPECIFIER_RE)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? ''
  );
}

/** 프로덕션 소스만(테스트 파일·`__tests__`·`generated` 제외 — 이 심판 파일 자신이 금칙 샘플을 담는다). */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'generated' || entry.name === '__tests__'
          ? []
          : listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readScoped(dir: string): { file: string; source: string }[] {
  return listSourceFiles(dir).map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — 주석 제거 × import 파서 × 정의/플래그 탐지기 조합', () => {
  it('주석 속 import 는 걷히고, 여러 줄 import·재수출·URL·?.official 은 살아남아 잡힌다', () => {
    // 준비: 주석 속 가짜 위반 + 진짜 여러 줄 import + 재수출 + URL + 옵셔널 체이닝.
    const sample = [
      "/* import { resolveStyleFace } from '@/features/reflection/model/styleThreshold'; */",
      "// import { StyleFace } from '../model/styleThreshold';",
      'import {',
      '  categoryLabel,',
      '  type StyleFace,',
      '  resolveStyleFace as rsf,',
      "} from '@/entities/style-analysis/lib/styleFace';",
      "export { resolveStyleFace } from '@/entities/style-analysis/lib/styleFace';",
      "const u = 'https://x.y/z';",
      'const o = envelope?.official;',
    ].join('\n');

    // 실행
    const stripped = stripComments(sample);
    const imports = importsOf(stripped);

    // 단언 ① 주석 속 옛 경로 import 는 안 잡히고, 진짜 두 문장만 잡힌다(별칭·type 접두 걷힘).
    expect(imports).toEqual([
      {
        names: ['categoryLabel', 'StyleFace', 'resolveStyleFace'],
        from: '@/entities/style-analysis/lib/styleFace',
      },
      {
        names: ['resolveStyleFace'],
        from: '@/entities/style-analysis/lib/styleFace',
      },
    ]);
    // ② URL 은 콜론 예외로 보존, ③ 옵셔널 체이닝 플래그 읽기도 잡힌다.
    expect(stripped).toContain("const u = 'https://x.y/z';");
    expect(OFFICIAL_READ.test(stripped)).toBe(true);
    // ④ 정의 탐지기는 선언만 — import·호출·이웃 이름엔 안 걸린다.
    expect(DEF_FN.test('export function resolveStyleFace(e) {')).toBe(true);
    expect(DEF_TYPE.test("export type StyleFace = 'official';")).toBe(true);
    expect(DEF_TYPE.test("import type { StyleFace } from 'x';")).toBe(false);
    expect(DEF_TYPE.test('type StyleFaceX = 1;')).toBe(false);
    expect(DEF_FN.test('const f = resolveStyleFace(envelope);')).toBe(false);
    // ⑤ 지정자 수집기 — from·부수효과·require·동적 import 전부.
    expect(
      specifiersOf(
        "import a from 'a'; import 'b'; const c = require('c'); await import('d');"
      )
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('🔴 G1 · AC-3 판정의 자리 — entities/style-analysis/lib/styleFace.ts', () => {
  it('파일이 있고 resolveStyleFace 함수와 StyleFace 타입을 정의한다', () => {
    // 준비·실행
    const source = readOne(STYLE_FACE_REL);

    // 단언
    expect(fs.existsSync(path.join(ROOT, STYLE_FACE_REL))).toBe(true);
    expect(DEF_FN.test(source)).toBe(true);
    expect(DEF_TYPE.test(source)).toBe(true);
  });
});

describe('🔴 G2 · AC-3 정의는 프로덕션 전체에서 한 파일뿐', () => {
  it('resolveStyleFace·StyleFace 를 정의하는 파일 = styleFace.ts 하나', () => {
    // 준비: src 프로덕션 전수.
    const sources = readScoped(ROOT);
    expect(sources.length).toBeGreaterThan(100); // 모집단 앵커

    // 실행
    const fnDefs = sources.filter(({ source }) => DEF_FN.test(source));
    const typeDefs = sources.filter(({ source }) => DEF_TYPE.test(source));

    // 단언: 두 벌이던 판정이 한 곳에만 산다.
    expect(fnDefs.map(({ file }) => file)).toEqual([STYLE_FACE_REL]);
    expect(typeDefs.map(({ file }) => file)).toEqual([STYLE_FACE_REL]);
  });
});

describe('🔴 G3 · AC-3 서버 정식 플래그(.official)를 읽는 곳도 한 파일뿐', () => {
  it('프로덕션에서 .official 을 읽는 파일 = styleFace.ts 하나(요약카드는 직접 안 읽는다)', () => {
    // 준비·실행
    const readers = readScoped(ROOT)
      .filter(({ source }) => OFFICIAL_READ.test(source))
      .map(({ file }) => file);

    // 단언 — 구조 분해(`{ official } = envelope`)는 이 스캔의 사각이라 동치 property(AC-4)가 행동으로 메운다.
    expect(readers).toEqual([STYLE_FACE_REL]);
  });
});

describe('🔴 G4 · AC-4·AC-6 소비처 census — 판정은 entities 에서만 들여온다', () => {
  it('두 심볼을 들여오는 모든 문장의 출처가 entities/style-analysis 이고, 세 소비처가 실제로 문다', () => {
    // 준비: import 문장을 먼저 파싱하고, 그 이름 목록에 판정 심볼이 있는 문장만 고른다.
    const statements = readScoped(ROOT).flatMap(({ file, source }) =>
      importsOf(source)
        .filter(({ names }) => names.some((n) => SYMBOLS.includes(n)))
        .map(({ from }) => ({ file, from }))
    );

    // 실행: 출처가 슬라이스 밖(옛 reflection 경로 등)인 문장.
    const isInsideSlice = ({ file, from }: { file: string; from: string }) =>
      from.startsWith('@/entities/style-analysis') ||
      (file.startsWith(`${SLICE_REL}/`) && from.startsWith('.'));
    const offenders = statements
      .filter((s) => !isInsideSlice(s))
      .map(({ file, from }) => `${file} ← ${from}`);

    // 단언 ① 옛 경로 import 0.
    expect(offenders).toEqual([]);
    // ② 긍정 짝 — j05 페이지·화면과 l03 요약카드 모델이 모두 같은 판정을 문다.
    expect(statements.map(({ file }) => file)).toEqual(
      expect.arrayContaining([PAGE_REL, SCREEN_REL, CARD_MODEL_REL])
    );
    // ③ 요약카드는 들여오기만 하지 않고 실제로 부른다.
    expect(readOne(CARD_MODEL_REL)).toMatch(/\bresolveStyleFace\s*\(/);
  });
});

describe('🔴 G5 · AC-5·AC-6 옛 자리 사본·재수출 shim 0', () => {
  it('features/reflection/model/styleThreshold.ts 에 두 심볼 토큰 0 + categoryLabel 은 남는다', () => {
    // 준비·실행
    const source = readOne(OLD_THRESHOLD_REL);

    // 단언 — 긍정 짝(j05 전용 표시 변환은 이동 대상 아님, 01b Q3).
    expect(source).toContain('categoryLabel');
    // 부정 — 정의도 `export { … } from` 재수출도 없다(정의 탐지기로는 shim 을 못 잡아 토큰으로 본다).
    expect(source).not.toMatch(/\bresolveStyleFace\b/);
    expect(source).not.toMatch(/\bStyleFace\b/);
  });
});

describe('🔴 G6 · AC-6 entities/style-analysis 는 @/shared 만 본다', () => {
  it('슬라이스 소스의 모듈 지정자는 @/shared/… 또는 슬라이스 안 상대경로뿐', () => {
    // 준비
    const sliceDir = path.join(ROOT, SLICE_REL);
    const sources = readScoped(sliceDir);

    // 실행: 슬라이스 밖으로 새는 지정자(타 층·형제 슬라이스·외부 패키지).
    const offenders = sources.flatMap(({ file, source }) =>
      specifiersOf(source)
        .filter((spec) => {
          if (spec.startsWith('@/shared/')) return false;
          if (spec.startsWith('.')) {
            const resolved = path.resolve(
              path.dirname(path.join(ROOT, file)),
              spec
            );
            return !resolved.startsWith(sliceDir + path.sep);
          }
          return true;
        })
        .map((spec) => `${file} → ${spec}`)
    );

    // 단언 — 긍정 짝: 모집단이 있고 서버 계약 타입을 shared 에서 가져온다.
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(
      sources.some(({ source }) =>
        source.includes('@/shared/api/generated/schemas')
      )
    ).toBe(true);
    // 부정
    expect(offenders).toEqual([]);
  });
});

describe('G0b · TRIP-956 탐지기 자가검사 — 주석 제거 × progress 읽기·정의·호출 탐지기 조합', () => {
  it('주석 속 progress 읽기는 걷히고, 코드 속 envelope 칸 읽기만 잡히며 prop·다른 도메인은 안 잡힌다', () => {
    // 준비: 주석 속 가짜 읽기 + 여러 줄 import + URL + 세 가지 칸 읽기 + 오탐 후보 셋.
    const sample = [
      '/* envelope.progress.current */',
      '// const x = envelope.progress?.current ?? 0;',
      'import {',
      '  resolveStyleProgress,',
      "} from '@/entities/style-analysis/lib/styleProgress';",
      "const u = 'https://x.y/progress.current';",
      'const a = envelope?.progress?.current ?? 0;',
      'const b = envelope.progress?.required ?? 10;',
      'const c = envelope.progress.current;',
      'state: toMapPinState(entry.progress),',
      '{progress.current}곳',
      'progress={resolveStyleProgress(envelope)}',
    ].join('\n');

    // 실행
    const stripped = stripComments(sample);
    const lines = stripped.split('\n');

    // 단언 ① 칸 읽기 = 코드 속 세 줄뿐(주석·URL·prop·다른 도메인 제외).
    expect(lines.filter((l) => PROGRESS_FIELD_READ.test(l))).toEqual([
      'const a = envelope?.progress?.current ?? 0;',
      'const b = envelope.progress?.required ?? 10;',
      'const c = envelope.progress.current;',
    ]);
    // ② URL 은 살아남는다(콜론 예외).
    expect(stripped).toContain("const u = 'https://x.y/progress.current';");
    // ③ 토큰 금지는 다른 도메인(entry.progress)도 잡는다 — 그래서 두 소비처에만 건다.
    expect(PROGRESS_TOKEN.test('state: toMapPinState(entry.progress),')).toBe(
      true
    );
    expect(
      PROGRESS_TOKEN.test('progress={resolveStyleProgress(envelope)}')
    ).toBe(false);
    // ④ import 파서는 여러 줄 import 를 한 문장으로 잡는다.
    expect(importsOf(stripped)).toEqual([
      {
        names: ['resolveStyleProgress'],
        from: '@/entities/style-analysis/lib/styleProgress',
      },
    ]);
    // ⑤ 정의 탐지기는 선언만, 호출 탐지기는 import 에 안 걸린다.
    expect(
      DEF_PROGRESS_FN.test('export function resolveStyleProgress(e) {')
    ).toBe(true);
    expect(
      DEF_PROGRESS_FN.test('export const resolveStyleProgress = (e) =>')
    ).toBe(true);
    expect(
      DEF_PROGRESS_FN.test('const p = resolveStyleProgress(envelope);')
    ).toBe(false);
    expect(CALL_PROGRESS_FN.test('resolveStyleProgress(envelope)')).toBe(true);
    expect(
      CALL_PROGRESS_FN.test("import { resolveStyleProgress } from 'x';")
    ).toBe(false);
  });
});

describe('🔴 G7 · TRIP-956 progress 폴백의 자리 — 정의는 styleProgress.ts 한 곳', () => {
  it('파일이 있고, resolveStyleProgress 를 정의하는 프로덕션 파일은 그 하나뿐이다', () => {
    // 준비: src 프로덕션 전수.
    const sources = readScoped(ROOT);
    expect(sources.length).toBeGreaterThan(100); // 모집단 앵커

    // 실행
    const defs = sources
      .filter(({ source }) => DEF_PROGRESS_FN.test(source))
      .map(({ file }) => file);

    // 단언
    expect(fs.existsSync(path.join(ROOT, STYLE_PROGRESS_REL))).toBe(true);
    expect(defs).toEqual([STYLE_PROGRESS_REL]);
  });
});

describe('🔴 G8 · TRIP-956 AC-3 소비처 census — j05 페이지와 요약카드가 같은 폴백을 부른다', () => {
  it('progress 칸 읽기는 styleProgress.ts 밖에 0 이고, 두 소비처는 entities 에서 들여와 부르며 .progress 를 직접 안 만진다', () => {
    // 준비: import 문장을 먼저 파싱하고, 그 이름 목록에 폴백 함수가 있는 문장만 고른다.
    const sources = readScoped(ROOT);
    const statements = sources.flatMap(({ file, source }) =>
      importsOf(source)
        .filter(({ names }) => names.includes('resolveStyleProgress'))
        .map(({ from }) => ({ file, from }))
    );

    // 실행 ① 슬라이스 밖에서 envelope 의 progress 칸을 직접 읽는 파일.
    const strayReaders = sources
      .filter(({ file }) => file !== STYLE_PROGRESS_REL)
      .filter(({ source }) => PROGRESS_FIELD_READ.test(source))
      .map(({ file }) => file);
    // 실행 ② 출처가 entities 슬라이스가 아닌 import 문장.
    const offenders = statements
      .filter(
        ({ file, from }) =>
          !(
            from.startsWith('@/entities/style-analysis') ||
            (file.startsWith(`${SLICE_REL}/`) && from.startsWith('.'))
          )
      )
      .map(({ file, from }) => `${file} ← ${from}`);

    // 단언 ① 칸 읽기·옛 경로 import 0.
    expect(strayReaders).toEqual([]);
    expect(offenders).toEqual([]);
    // ② 긍정 짝 — 두 화면의 소비처가 모두 폴백을 들여온다.
    expect(statements.map(({ file }) => file)).toEqual(
      expect.arrayContaining([PAGE_REL, CARD_MODEL_REL])
    );
    // ③ 들여오기만 하지 않고 실제로 부른다 + ④ progress 를 직접 만지는 코드가 없다.
    for (const rel of [PAGE_REL, CARD_MODEL_REL]) {
      const source = readOne(rel);
      expect(source).toMatch(CALL_PROGRESS_FN);
      expect(source).not.toMatch(PROGRESS_TOKEN);
    }
    // ⑤ j05 페이지는 그 결과를 그대로 prop 에 넘긴다 — 감싸기·인자 바꿔치기는 카드와 값이 갈린다.
    expect(readOne(PAGE_REL)).toMatch(PAGE_PROGRESS_PROP);
  });
});
