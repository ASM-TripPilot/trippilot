/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-571 · AC-8 (frontend-components §6 신설 가드) — 표시본 결정은 `reflectionFallback.ts` 한 곳에서만.
 *
 * 무엇을 보장하나:
 *  - 표시본(narrative → edited??draft → BASIC) 재조립이 **`reflectionFallback.ts` 단일 지점**에만 산다.
 *  - **화면(features/reflection/ui/**)이 자체 폴백을 만들지 못한다** — `draftNarrative`·`editedNarrative`
 *    를 만져 표시본을 조립하는 코드가 화면에 0건(화면은 완성된 `narrative`·`editableText` prop 만 받는다).
 *  - `resolveDisplayNarrative` 는 reflectionFallback.ts 안에서만 정의·언급되고, features/reflection 의
 *    다른 파일은 그것을 호출하지 않는다(유일 호출자는 pages 층 — 이 스캔 밖).
 *
 * 왜 소스 스캔인가: "표시본을 두 곳에서 재판정하면 조회 화면과 목록 화면이 서로 다르게 고르는 날이
 * 온다"(openapi `Reflection.narrative` 주석)는 런타임으로 안 잡힌다 — 코드 배치를 소스로 강제한다.
 *
 * **전제**: 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·경로 `//` 보존).
 */

const ROOT = path.resolve('src');
const FALLBACK_REL = 'features/reflection/model/reflectionFallback.ts';
const FEATURE_DIR_REL = 'features/reflection';
const UI_DIR_REL = 'features/reflection/ui';

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

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function scan(dirRel: string): { file: string; source: string }[] {
  return listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G1 · 탐지기 자가검사 — 전처리 × 탐지 대상 조합', () => {
  it('주석 속 토큰은 걷히고, 코드 속 토큰·URL 슬래시는 살아남는다', () => {
    const sample = [
      '/**',
      ' * resolveDisplayNarrative 는 draftNarrative·editedNarrative 를 조립한다(산문).',
      ' */',
      "const url = 'https://example.com/reflection'; // resolveDisplayNarrative 는 여기 없다",
      'const x = res.editedNarrative ?? res.draftNarrative;',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 블록 주석·줄끝 주석 속 토큰은 걷힌다(산문·주석 속 resolveDisplayNarrative 둘 다).
    expect(stripped).not.toContain('산문');
    // ② URL 의 // 는 주석으로 오인되지 않아(콜론 예외) 코드 줄이 통째로 사라지지 않는다(거짓 green 방지).
    expect(stripped).toContain('https://example.com/reflection');
    // ③ 코드 속 draft/edited 조립은 살아남는다.
    expect(stripped).toContain('res.editedNarrative ?? res.draftNarrative');
    // ④ 코드 속 draftNarrative 는 잡히고, 주석에만 있던 resolveDisplayNarrative 는 안 잡힌다.
    expect(stripped.includes('draftNarrative')).toBe(true);
    expect(stripped.includes('resolveDisplayNarrative')).toBe(false);
  });
});

describe('🔴 AC-8 · 표시본 결정 단일 출처(reflectionFallback.ts)', () => {
  it('reflectionFallback.ts 가 resolveDisplayNarrative 와 폴백 토큰을 소유한다(긍정 앵커)', () => {
    const fallback = readOne(FALLBACK_REL);
    // 긍정 — 정의·폴백 조립이 여기 실재(빈/부재 파일 공허 통과 차단).
    expect(fallback).toContain('resolveDisplayNarrative');
    expect(fallback).toContain('draftNarrative');
    expect(fallback).toContain('editedNarrative');
  });

  it('features/reflection 의 다른 파일은 resolveDisplayNarrative 를 호출하지 않는다(유일 호출자=pages)', () => {
    const others = scan(FEATURE_DIR_REL).filter((s) => s.file !== FALLBACK_REL);
    // 긍정 앵커 — 모집단이 비어있지 않다(reflectionFallback 외 파일이 실재).
    expect(others.length).toBeGreaterThan(0);

    const offenders = others
      .filter((s) => s.source.includes('resolveDisplayNarrative'))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('화면(ui)은 draft/edited 를 만져 표시본을 조립하지 않는다(자체 폴백 금지)', () => {
    const ui = scan(UI_DIR_REL);
    // 긍정 앵커 — ui 모집단이 실재.
    expect(ui.length).toBeGreaterThan(0);

    const offenders = ui
      .filter(
        (s) =>
          s.source.includes('draftNarrative') ||
          s.source.includes('editedNarrative') ||
          s.source.includes('resolveDisplayNarrative')
      )
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
