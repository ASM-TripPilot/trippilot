/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-765 · j05 여행 스타일 Figma 정합 — className 크롬 소스 가드
 * (`travelStyleStructure.test.ts` 미러, 콜론예외 stripComments 공유).
 *
 * 왜 소스 스캔인가: 색·정렬·카드 크롬은 NativeWind className 이고 실제 렌더 색/정렬은 jest 사각(6-b).
 * 그래서 "정합 토큰이 소스에 있고 옛 토큰이 없다"까지를 소스로 잠근다(seed ★ "className 소스 스캔").
 *
 * 무엇을 보장하나:
 *  - 🔴 AC-2 StatTile 크롬: `bg-surface-soft` 제거 + `border-hairline`(흰배경+hairline) 추가.
 *  - 🔴 AC-3 EvidenceLink 플레인 → **TRIP-637 행 자체 제거**: 근거 링크 파일이 없고 화면이 그것을 안 문다
 *    (목적지 라우트·근거 방문 데이터 계약이 없어 누를 곳 없는 링크였다 — 크롬을 다듬던 행을 통째로 걷음).
 *  - 🔴 AC-4 캡션 좌정렬: 캡션 Text className 에 `text-center`·`text-muted-soft` 제거 + `text-muted`.
 *  - 🔴 AC-7 칩 색: 미리보기 칩 View className `bg-surface-strong`→`bg-primary-pale`.
 *
 * ★ 스코프 주의: `text-muted-soft`(3회)·`text-center` 는 화면의 지도/보조문구 자리에도 있어 **파일 전역**
 *   스캔은 캡션만 겨냥하지 못한다 → 캡션/칩은 그 요소의 **여는 태그 attrs 를 캡처**해 그 className 만 본다.
 *   StatTile·EvidenceLink 는 대상 토큰이 파일에 각 1곳(대상 요소)뿐이라 파일 전역 스캔이 유효(02a §5 실측).
 * 가짜 통과 방지: 모든 "없어야 한다"는 같은 it 의 "있어야 한다"(또는 캡처 성공)와 짝을 이룬다(리포 관례).
 */

const ROOT = path.resolve('src');

const SCREEN_REL = 'features/reflection/ui/TravelStyleScreen.tsx';
const STATTILE_REL = 'features/reflection/ui/StatTile.tsx';
/** TRIP-637 로 삭제된 근거 링크 — 부재 단언 대상. */
const EVIDENCE_REL = 'features/reflection/ui/EvidenceLink.tsx';

/** 콜론(:) 뒤 // 는 주석으로 안 본다 — URL·경로 `//` 보존. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

/** className 문자열을 공백 토큰 배열로. `text-muted-soft` 가 `text-muted` 로 오탐되지 않게 정확 토큰 비교용. */
function classTokens(className: string): string[] {
  return className.trim().split(/\s+/);
}

/** 여는 태그(대상 텍스트/testID 를 가진 요소)의 attrs 블롭에서 className 값을 뽑는다(속성 순서 무관). */
function classNameNear(source: string, openTagRe: RegExp): string | null {
  const m = source.match(openTagRe);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const cn = attrs.match(/className="([^"]+)"/);
  return cn ? (cn[1] ?? '') : '';
}

describe('🔴 TRIP-765 · AC-2 StatTile 크롬 교체(흰배경+hairline)', () => {
  it('StatTile 에 bg-surface-soft 0 + border-hairline 존재', () => {
    const src = readOne(STATTILE_REL);

    // 긍정 앵커 — 빈 파일 공허 통과 차단.
    expect(src).toContain('StatTileProps');
    // 부정 — 옛 회색 배경 제거.
    expect(src).not.toContain('bg-surface-soft');
    // 긍정 — hairline 테두리 도입.
    expect(src).toContain('border-hairline');
  });
});

describe('🔴 TRIP-765 · AC-3 EvidenceLink 플레인 행 → TRIP-637 행 자체 제거', () => {
  it('EvidenceLink.tsx 가 없고 화면 소스가 그것을 import·렌더하지 않는다', () => {
    const src = readOne(SCREEN_REL);

    // 긍정 앵커 — 화면 파일을 제대로 읽었다(빈 파일 공허 통과 차단).
    expect(src).toContain('CategoryBarList');
    // 부정 — 근거 링크 파일 부재(readOne 은 없는 파일에 '' 이라 존재를 직접 본다).
    expect(fs.existsSync(path.join(ROOT, EVIDENCE_REL))).toBe(false);
    // 부정 — 화면 코드(주석 제거)에 컴포넌트명·testID 0.
    expect(src).not.toContain('EvidenceLink');
    expect(src).not.toContain('reflection-style-evidence');
  });
});

describe('🔴 TRIP-765 · AC-4 캡션 → TRIP-939 AC-5 지도 자리표시·범례 캡션 제거', () => {
  it('화면 소스에 지도 자리표시 문구·범례 캡션 문구가 없다(가짜 지도 표면 제거, Q7)', () => {
    // TRIP-939: 좌표 계약이 없어 지도는 늘 자리표시였다 → 자리표시와 그 범례를 통째로 뺀다
    // (구 TRIP-765 AC-4 "캡션 좌정렬"은 캡션 자체가 사라져 "부재"로 뒤집는다).
    // ⚠️ 원문 스캔(주석 미제거)이라 주석에 두 문구를 적어도 red 다(02a ★14).
    const src = readOne(SCREEN_REL);

    // 긍정 앵커 — 화면 파일을 제대로 읽었다(빈 파일 공허 통과 차단).
    expect(src).toContain('CategoryBarList');
    // 부정 — 자리표시 문구·범례 캡션 문구 부재.
    expect(src).not.toContain('지도 표시 예정');
    expect(src).not.toContain('점 = 방문 장소');
  });
});

describe('🔴 TRIP-765 · AC-7 미리보기 칩 색 restyle', () => {
  it('칩 View className 에 bg-surface-strong 0 + bg-primary-pale 존재', () => {
    const src = readOne(SCREEN_REL);

    // 칩 여는 태그 attrs 캡처 — testID 를 가진 View(속성 순서 무관).
    const className = classNameNear(
      src,
      /<View([^>]*testID="reflection-style-preview-chip"[^>]*)>/
    );
    // 긍정 앵커 — 칩이 실재해 캡처에 성공(null 이면 red).
    expect(className).not.toBeNull();

    const tokens = classTokens(className ?? '');
    // 부정 — 옛 회색 배경 제거.
    expect(tokens).not.toContain('bg-surface-strong');
    // 긍정 — 연배경(primary-pale) 칩.
    expect(tokens).toContain('bg-primary-pale');
  });
});
