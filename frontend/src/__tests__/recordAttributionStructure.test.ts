/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-569 · US-REC-05 · AC-6·AC-8 — stayAttribution 소스 층 가드(타임존·조회 배선).
 *
 * 무엇을 보장하나:
 *  - **G2 ★타임존(AC-6)**: `stayAttribution.ts` 가 `new Date(`·`Date.now(` 로 날짜를 파싱하지
 *    않는다(기기 TZ 밀림 방지). `Date.UTC(`·문자열 접두 슬라이스·'YYYY-MM-DD' 비교는 허용 —
 *    이 축의 결정론적 신뢰 그물이다(행동 테스트는 러너 TZ 에 따라 조용히 통과할 수 있다).
 *  - **G3 ★조회 배선(AC-8)**: `features/record/**` 가 생성 훅 `useGetTripsTripIdBases`·
 *    `useGetSavedStays` 를 **직접** 감싼다(cross-feature 벽 우회 — `features/trip` import 금지의
 *    반대쪽 긍정 앵커, 새 HTTP 금지 G5 와 짝).
 *
 * AC-8 의 나머지(record→타 feature import 0 = G2, 새 HTTP 0 = G5, INV-3 소요시간 0 = G6)는
 * `recordsStructure.test.ts`·`recordsDurationStructure.test.ts` 의 **재귀 스캔이 신규 파일을
 * 자동 편입**해 잠근다 — 여기서 복제하지 않는다.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL `://` 보존).
 * **가짜 통과 방지**: 모든 "없어야 한다"는 같은 it 의 "있어야 한다"(긍정 앵커)와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const MODEL_REL = 'features/record/model/stayAttribution.ts';
const RECORD_FEATURE_DIR_REL = 'features/record';

/** 기기 타임존 날짜 파싱 탐지기(AC-6) — `Date.UTC(` 는 안 걸린다(허용). */
const FORBIDDEN_DATE = /new Date\s*\(|Date\.now\s*\(/;

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL·경로의 `//` 를 스캔 전에 안 지우기 위함. */
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

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function scanFeature(): string {
  return listSourceFiles(path.join(ROOT, RECORD_FEATURE_DIR_REL))
    .map((full) => stripComments(fs.readFileSync(full, 'utf8')))
    .join('\n');
}

describe('G1 · 탐지기 자가검사 — stripComments × FORBIDDEN_DATE 조합', () => {
  it('주석 속 new Date 는 걷히고, Date.UTC 는 허용, 코드 속 new Date 는 잡히고, URL 은 산다', () => {
    const sample = [
      '/**',
      ' * new Date(x) 를 산문으로 적어도 걷힌다.',
      ' * 참조: https://figma.com/design/x',
      ' */',
      "const util = 'https://example.com/a'; // 주석 속 new Date(y)",
      'const ok = Date.UTC(2026, 5, 11);',
      'const bad = new Date(iso);',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 산문·주석 속 금칙은 걷힌다(부정 단언을 거짓 red 로 만들지 않는다).
    expect(stripped).not.toContain('산문으로 적어도');
    // ② URL 의 // 는 주석으로 오인되지 않아 그 줄이 살아남는다.
    expect(stripped).toContain("const util = 'https://example.com/a';");
    // ③ Date.UTC( 는 허용(탐지기에 안 걸린다).
    expect(FORBIDDEN_DATE.test('const ok = Date.UTC(2026, 5, 11);')).toBe(
      false
    );
    // ④ 코드에 실재하는 new Date( 는 살아남아 검출된다(전처리가 다 지우면 G2 가 공허).
    expect(FORBIDDEN_DATE.test(stripped)).toBe(true);
    expect(FORBIDDEN_DATE.test('const t = Date.now();')).toBe(true);
  });
});

describe('🔴 G2 · AC-6 — stayAttribution.ts 는 기기 TZ 로 날짜를 파싱하지 않는다', () => {
  it('new Date(·Date.now( 0건 + deriveStayAttribution 존재(긍정 앵커)', () => {
    const source = readOne(MODEL_REL);

    // 긍정 앵커 — 파일이 실재하고 파생 함수를 export 한다(빈/부재 파일 공허 통과 차단).
    expect(source).toContain('deriveStayAttribution');

    // 부정 — 기기 TZ 파싱 0건(Date.UTC·문자열 슬라이스·'YYYY-MM-DD' 비교는 허용).
    expect(FORBIDDEN_DATE.test(source)).toBe(false);
  });
});

describe('🔴 G3 · AC-8 — record 가 bases·savedStays 생성 훅을 직접 감싼다', () => {
  it('features/record/** 가 useGetTripsTripIdBases·useGetSavedStays 를 참조한다', () => {
    const feature = scanFeature();

    // 모집단 비어있지 않음 앵커.
    expect(feature.length).toBeGreaterThan(0);

    // 긍정 — 두 생성 훅을 직접 감싼다(cross-feature 벽 우회, 새 HTTP 금지의 반대쪽 증거).
    expect(feature).toContain('useGetTripsTripIdBases');
    expect(feature).toContain('useGetSavedStays');
  });
});
