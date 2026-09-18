/**
 * @jest-environment node
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-608 AC-13 · BR-U6-25(DEC-U6-6) — 삭제 고지 목록은 `deletionScope.ts` 가 **단일 소유**한다.
 *
 * 무엇을 보장하나: 계정 삭제 시 함께 삭제되는 것들의 목록(법적 사전 고지)이 오직
 * `features/settings/model/deletionScope.ts` 의 `DELETION_SCOPE` 상수에만 리터럴로 산다.
 * 다이얼로그는 이 상수를 import·map 해 그리므로(Q1 확정 — Figma 3항목 축약 산문 미채용, 전체 목록
 * 렌더), 설정 표면의 다른 소스 파일에는 이 문자열들이 **인라인으로 중복되지 않아야** 한다. 목록이
 * 두 군데로 갈리면 한쪽만 고쳐 법적 고지가 실제 삭제 범위와 어긋난다.
 *
 * 왜 소스 스캔인가: "목록이 한 곳에만 있다"는 런타임 동작이 아니라 코드 배치의 성질이다 —
 * 렌더 테스트로는 표현할 수 없고 소스 층에서만 잡힌다.
 *
 * 왜 **설정 표면 스코프**(features/settings·pages/settings·app/settings)인가, whole-repo 가 아니라:
 * `회고`·`요약` 같은 삭제 대상 어휘는 `features/reflection` 등에 **정당하게** 등장한다 —
 * 전 리포 스캔은 그걸 위반으로 오탐한다. AC-13 의 실제 표적은 "삭제 고지 목록이 다이얼로그에
 * 인라인 중복되는 것"이고, 그 중복이 생길 곳은 설정 표면뿐이다.
 *
 * ⚠️ 전처리(`stripComments`)의 줄 주석 정규식이 URL 의 `//` 를 주석으로 오인하면, 그 줄의 진짜
 * 리터럴이 통째로 사라져 거짓 green 이 난다(2026-07-31 실사고). `:` 뒤의 `//` 는 주석으로 보지
 * 않고(`tripDraftBoundary.test.ts` 확립 규약), 그 성질을 아래 자가검사가 회귀 가드로 잠근다.
 *
 * 가짜 통과 방지 규약(리포 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const DELETION_SCOPE_FILE = join(
  SRC_ROOT,
  'features',
  'settings',
  'model',
  'deletionScope.ts'
);
const SCAN_ROOTS = [
  join(SRC_ROOT, 'features', 'settings'),
  join(SRC_ROOT, 'pages', 'settings'),
  join(SRC_ROOT, 'app', 'settings'),
];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다). 줄 주석은
 * **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** — `'https://…'` 의 슬래시 오인을 막는다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 주석을 걷은 뒤 single/double 인용 문자열 리터럴을 뽑는다(deletionScope.ts 배열 항목 추출용). */
function quotedStringsOf(source: string): string[] {
  const stripped = stripComments(source);
  const out: string[] = [];
  for (const match of stripped.matchAll(/'([^']+)'|"([^"]+)"/g)) {
    out.push((match[1] ?? match[2]) as string);
  }
  return out;
}

/** 스캔 대상 프로덕션 소스(테스트 파일·deletionScope.ts 자신 제외)를 재귀로 모은다. */
function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (
      SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext)) &&
      !/\.(test|spec)\.[tj]sx?$/.test(full) &&
      full !== DELETION_SCOPE_FILE
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('AC-13 · deletionScope 단일 소유 가드', () => {
  it('탐지기 자가검사 — 주석은 걷히고, URL 옆 진짜 리터럴은 살아남고, 배열 항목이 뽑힌다', () => {
    // ① 주석 안에 적힌 삭제 어휘는 추출에 안 걸린다(머리말 산문이 스캔을 오염시키지 않게).
    const commented = [
      '/**',
      ' * 이 화면은 "등록한 숙소" 목록을 deletionScope 에서만 가져온다.',
      ' */',
      "// const scope = ['등록한 숙소', '여행 기록'];",
      'export const keep = 1;',
    ].join('\n');
    expect(stripComments(commented)).not.toContain('등록한 숙소');
    expect(stripComments(commented)).toContain('export const keep = 1;');

    // ② 회귀 가드 — URL 의 `//` 를 줄 주석으로 오인하면 그 줄의 진짜 리터럴이 사라진다.
    expect(
      quotedStringsOf(
        "const doc = 'https://policy.example.com/delete'; const s = '등록한 숙소';"
      )
    ).toContain('등록한 숙소');

    // ③ 블록 주석을 먼저 지우는 순서라야 같은 줄의 리터럴이 살아남는다.
    expect(quotedStringsOf("/* a // b */ const s = '방문 기록';")).toEqual([
      '방문 기록',
    ]);
  });

  it('DELETION_SCOPE 가 실재하고 목록이 비어있지 않다(긍정 짝)', () => {
    // 긍정 ① — 파일이 없으면 아래 추출이 무의미하다(빈 파일 가짜 통과 차단).
    expect(existsSync(DELETION_SCOPE_FILE)).toBe(true);

    const items = quotedStringsOf(readFileSync(DELETION_SCOPE_FILE, 'utf8'));
    // 긍정 ② — BR-U6-25 는 ~9항목이다. 하한 5로 스텁/빈 배열을 막는다(정확 수·문안은 미고정).
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it('삭제 목록 문자열이 설정 표면의 다른 소스 파일에 0회 등장한다', () => {
    expect(existsSync(DELETION_SCOPE_FILE)).toBe(true);
    const items = quotedStringsOf(readFileSync(DELETION_SCOPE_FILE, 'utf8'));

    const files = SCAN_ROOTS.flatMap((root) => collectSources(root));
    // 긍정 짝 — 스캔 집합이 비어 있지 않다(공집합이면 "위반 0"이 공허하다).
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      for (const item of items) {
        if (stripped.includes(item)) {
          offenders.push(
            `${relative(SRC_ROOT, file).split(sep).join('/')} → "${item}"`
          );
        }
      }
    }

    // 다이얼로그는 DELETION_SCOPE 를 import·map 하므로 리터럴은 정본 파일에만 있어야 한다.
    expect(offenders).toEqual([]);
  });
});
