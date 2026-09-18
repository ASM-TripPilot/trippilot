/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-395 · INV-3 · PBT-U4-F2 — 여행 중 UI 소스 층 **소요시간 비표기 가드**.
 *
 * `features/{execution,planb}/ui/**` 소스 어디에도 소요시간 표기가 없다(INV-3 — 거리만, 시간 안 함).
 * 렌더 스캔이 못 보는 `accessibilityLabel="이동 30분"` 같은 prop 문자열도 여기서 잡는다
 * (`itineraryTimeStructure.test.ts`와 같은 계열·같은 규율).
 *
 * 전제: 주석을 걷어낸 소스를 스캔한다(`stripComments`, 콜론 예외로 URL 보존). "없어야 한다"는
 * 같은 it 안 "있어야 한다" 앵커와 짝을 이룬다(리포 관례).
 */

const ROOT = path.resolve('src');
const UI_DIRS = ['features/execution/ui', 'features/planb/ui'];
const SCREEN_REL = 'features/execution/ui/LiveItineraryScreen.tsx';

/** 소요시간 **표기** 탐지기 — 화면에 나갈 문자열 형태. `HH:mm`(09:30)은 숫자 뒤가 `:`이라 안 걸린다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

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
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readOne(full: string): string {
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

describe('G1 · 탐지기 자가검사', () => {
  it('주석 속 소요시간은 걷히고, 코드의 시각은 탐지되지 않으며, 진짜 표기는 잡힌다', () => {
    const sample = [
      '// INV-3 · 소요시간 30분 표기 안 함.',
      "const t = '15:00';",
    ].join('\n');
    const stripped = stripComments(sample);

    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');
    expect(stripped).toContain("const t = '15:00';");
    expect(DURATION_TEXT.test(stripped)).toBe(false);

    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
  });
});

describe('G2 · INV-3 — features/{execution,planb}/ui 소스에 소요시간 표기가 0건이다', () => {
  it('여행 중 UI 전수(주석 제외)에 분·시간·소요 표기가 없다', () => {
    const sources = UI_DIRS.flatMap((dir) =>
      listSourceFiles(path.join(ROOT, dir)).map((full) => ({
        file: relOf(full),
        source: readOne(full),
      }))
    );

    // 긍정 앵커 — 모집단이 비어 있지 않고 이 칸의 화면이 그 안에 있다(구현 전 red).
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((entry) => entry.file)).toContain(SCREEN_REL);

    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
