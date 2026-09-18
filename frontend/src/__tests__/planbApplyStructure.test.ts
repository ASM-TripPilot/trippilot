/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-441 · AC-5 · BR-U4-28 · INV-U4-05 — 재계획 **확정(apply) 배선** 구조가드.
 *
 * 무엇을 보장하나(소스를 글자로 읽어 잰다 — 앱을 안 돌린다):
 *  - 🔴 `useApplyReplan` 호출처는 **정확히 1곳**, `pages/planb-diff` 슬라이스뿐이다(BR-U4-28 —
 *    확정은 일정 쓰기의 유일 지점, INV-U4-05). 다른 슬라이스가 부르면 red.
 *  - 🔴 `useApplyReplan` 심볼이 실재하고(긍정 앵커), 그 소스에 `invalidateQueries` 배선이 있다
 *    (맹점① 그물 — 무효화 correctness 는 jest 원리적 사각이라 이 소스 스캔이 유일 심판).
 *  - 🔴 codegen apply 훅은 **seam(`useApplyReplan.ts`) 1곳에만 봉인**된다 — 페이지가 래퍼를
 *    건너뛰고 codegen 을 직접 부르면(맹점③) 이 집합이 늘어 red.
 *
 * 전처리×탐지기 조합(★): 소스를 stripComments 로 가공한 뒤 정규식으로 훑으므로, ① 주석 속
 * 호출이 걷혀 카운트를 부풀리지 않고 ② 진짜 호출·URL 은 살아남는지를 G1 에서 실측한다. 특히
 * 정의줄 `export function useApplyReplan(` 도 `useApplyReplan\(` 에 걸리므로(실측) 호출처 카운트
 * 모집단에서 **정의 파일을 제외**한다 — 안 빼면 정의가 "2번째 호출처"로 잡혀 거짓 red 다.
 * (문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열 · planbScopeStructure G1 선례.)
 */

const ROOT = path.resolve('src');

/** 확정 배선의 세 좌표(리포 상대경로, `/` 정규화). */
const WRAPPER_REL = 'features/planb/model/useApplyReplan.ts';
const PAGE_REL = 'pages/planb-diff/ui/PlanbDiffPage.tsx';

/** 호출처를 셀 모집단 — 재귀 스캔할 두 층. */
const SCAN_DIRS = ['features/planb', 'pages'];

const APPLY_CALL = /useApplyReplan\s*\(/;
const CODEGEN_APPLY = /usePostTripsTripIdReplanSessionsSessionIdApply\s*\(/;

/** 주석을 걷어낸다. `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 소스 파일 재귀 수집(테스트·generated 제외). 디렉토리 없으면 빈 배열(방어 — 구현 전 대비). */
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

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

/** 모집단 = 두 층의 소스(주석 제거). {file, source} 리스트. */
function scanSources(): { file: string; source: string }[] {
  return SCAN_DIRS.flatMap((dir) =>
    listSourceFiles(path.join(ROOT, dir)).map((full) => ({
      file: relOf(full),
      source: stripComments(fs.readFileSync(full, 'utf8')),
    }))
  );
}

/** 없는 파일은 `''` — ENOENT 예외로 죽으면 assertion diff 가 안 남는다(pagesLayerStructure readOne 선례). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G1 · 전처리×탐지기 자가검사 (★ 조합)', () => {
  it('주석 속 호출은 걷히고, 코드 호출·URL·codegen 은 살아남으며, 정의줄도 탐지된다', () => {
    const sample = [
      '// useApplyReplan() 은 여기서 부르지 않는다(주석).',
      "const url = 'https://figma.com/design/x';",
      'const apply = useApplyReplan();',
      '  return usePostTripsTripIdReplanSessionsSessionIdApply();',
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석 속 호출은 사라져 카운트를 부풀리지 않는다(거짓 red 방지).
    expect(stripped).not.toContain('여기서 부르지 않는다');
    // 진짜 호출은 살아남아 탐지된다(거짓 통과 방지).
    expect(stripped).toContain('const apply = useApplyReplan();');
    expect(APPLY_CALL.test(stripped)).toBe(true);
    // URL 의 `://` 는 주석으로 오인되지 않아 보존된다.
    expect(stripped).toContain('https://figma.com/design/x');
    // codegen 도 살아남는다.
    expect(CODEGEN_APPLY.test(stripped)).toBe(true);
    // ★ 정의줄도 `useApplyReplan(` 에 걸린다 → 호출처 카운트는 정의 파일을 제외해야 한다.
    expect(
      APPLY_CALL.test(
        'export function useApplyReplan(): ReturnType<typeof x> {'
      )
    ).toBe(true);
  });
});

describe('🔴 G2 · useApplyReplan 호출처는 pages/planb-diff 1곳뿐 (BR-U4-28)', () => {
  it('정의 파일을 뺀 모집단에서 useApplyReplan 을 부르는 파일이 그 슬라이스 하나다', () => {
    const callers = scanSources()
      .filter(({ file }) => file !== WRAPPER_REL) // ★ 정의줄 오탐 제외
      .filter(({ source }) => APPLY_CALL.test(source))
      .map(({ file }) => file);

    expect(callers).toEqual([PAGE_REL]);
  });
});

describe('🔴 G3 · 심볼 실재 + invalidateQueries 배선 (맹점① 그물)', () => {
  it('useApplyReplan 이 export 되고 그 소스가 itinerary 캐시를 무효화한다', () => {
    const wrapper = readOne(WRAPPER_REL);

    // 긍정 앵커 — 심볼이 있어야 아래 무효화 단언이 공허하지 않다.
    expect(wrapper).toContain('export function useApplyReplan');
    // 맹점① — 확정 성공 시 무효화 배선(문자열 존재). correctness 는 6-b·런타임 밖 사각.
    expect(wrapper).toContain('invalidateQueries');
  });
});

describe('🔴 G4 · codegen apply 는 seam 1곳에 봉인 (맹점③ · BR-U4-28 강화)', () => {
  it('usePostTripsTripIdReplanSessionsSessionIdApply 직접 호출처는 useApplyReplan.ts 뿐이다', () => {
    const direct = scanSources()
      .filter(({ source }) => CODEGEN_APPLY.test(source))
      .map(({ file }) => file);

    expect(direct).toEqual([WRAPPER_REL]);
  });
});
