/**
 * @jest-environment node
 *
 * TRIP-694 · 5-b 경고-1 봉합 — 홈 컬렉션 카드 지역 핀(LocationPinGlyph)의 색 회귀 가드.
 *
 * 무엇을 보장하나: `HomeGlyphs.tsx`의 `LocationPinGlyph`가 stroke 색으로 `PRIMARY`(핑크)를
 * 쓰고 `WHITE`(흰)를 쓰지 않는다. Figma `2091:1357`에서 지역 핀은 핑크인데, 이 색은 SVG
 * stroke 상수라 렌더 트리에서 질의하기 번거롭고(글리프 색은 심판 사각 관례), 6-b 육안 전까지
 * 자동 그물이 전무했다(code-critic 경고-1). 소스 스캔 1개로 "핀 색이 흰으로 되돌아가는" 회귀를
 * 잡는다 — `loginVisual.test.ts`가 `AuthGlyphs.tsx`를 소스 스캔한 선례와 같은 층.
 *
 * 왜 블록으로 좁히나: 같은 파일의 `HeartOutlineGlyph`·`SearchGlyph` 등은 정당하게 `WHITE`/
 * `MUTED_SOFT`를 쓴다. 그래서 파일 전체가 아니라 `LocationPinGlyph` 함수 블록만 떼어 본다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'features', 'home', 'ui', 'HomeGlyphs.tsx');

// 준비(Arrange) — `export function LocationPinGlyph` 부터 다음 `export function`(또는 EOF)
// 직전까지를 이 글리프의 함수 블록으로 잘라낸다.
function locationPinBlock(source: string): string {
  const start = source.indexOf('export function LocationPinGlyph');
  if (start === -1) return '';
  const rest = source.slice(start + 'export function LocationPinGlyph'.length);
  const nextExport = rest.indexOf('\nexport function');
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe('LocationPinGlyph 색 회귀 가드 (TRIP-694 AC-4 · code-critic 경고-1)', () => {
  const source = readFileSync(SRC, 'utf8');
  const block = locationPinBlock(source);

  it('블록 추출 자가검사 — LocationPinGlyph 블록만 떼었고 이웃 글리프는 안 섞인다', () => {
    // 블록이 비어있지 않고(추출 성공), 이웃 HeartOutlineGlyph 정의가 안 섞였는지 확인.
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toContain('HeartOutlineGlyph');
  });

  it('지역 핀 stroke 는 PRIMARY(핑크)이고 WHITE 가 아니다', () => {
    // 단언(Assert) — 핑크 stroke 존재 + 흰 stroke 부재. 흰으로 되돌리면(뮤테이션) 둘 다 red.
    expect(block).toContain('stroke={PRIMARY}');
    expect(block).not.toContain('stroke={WHITE}');
  });
});
