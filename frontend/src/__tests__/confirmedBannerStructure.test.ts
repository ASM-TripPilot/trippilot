/**
 * @jest-environment node
 */
// TRIP-1047 AC-3 — h16 확정 일정의 지도 위 상주 배너(`ConfirmedBanner`, testID `itinerary-confirmed-banner`)는
// 없어졌다. 확정 알림은 확정한 순간의 토스트 1회로 옮겼다(01b). 페이지만 지우고 프리뷰(`h16-plan-confirmed`)에
// 배너가 남으면 6-b 육안에서 "아직 있다"로 보이고, 컴포넌트 파일만 남으면 소비처 없는 고아가 된다 — 프로덕션
// 소스 어디에도 그 이름·testID 가 없음을 한 번에 잠근다(파일 자체도 이름을 담으므로 삭제까지 잠긴다, 02a ★12).
//
// 리포 확립 규약: "없어야 한다"(부정)는 "있어야 한다"(긍정 짝)와 같은 it 안에 둔다.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');

/** 배너 컴포넌트 이름 또는 testID. */
const BANNER = /\bConfirmedBanner\b|itinerary-confirmed-banner/;

/**
 * 주석 제거 — 블록 먼저. 줄 주석은 바로 앞 글자가 `:` 이면 주석으로 보지 않는다(`'https://…'` 보존,
 * 리포 관례). 주석 속 "배너를 지웠다" 같은 이력 문구가 위반으로 잡히지 않게 한다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** src 아래 테스트·생성물이 아닌 .ts/.tsx 전부(src 기준 상대경로). */
function listProductionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') return [];
      return listProductionFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path.relative(ROOT, full).split(path.sep).join('/')];
  });
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G0 · 탐지기 자가검사 — 주석 걷기와 배너 탐지를 함께 태운다', () => {
  it('주석 속 이름은 안 잡고, import 와 문자열(URL 속 포함) 속 testID 는 잡는다', () => {
    const commentOnly = [
      '// ConfirmedBanner 는 TRIP-1047 로 지웠다',
      '/* itinerary-confirmed-banner 대신 토스트 */',
    ].join('\n');
    const importLine = "import { ConfirmedBanner } from './ConfirmedBanner';";
    const urlLine = "const u = 'https://x.dev/itinerary-confirmed-banner';";

    expect(BANNER.test(stripComments(commentOnly))).toBe(false);
    expect(BANNER.test(stripComments(importLine))).toBe(true);
    expect(BANNER.test(stripComments(urlLine))).toBe(true);
    // 비슷한 이름은 안 잡는다(단어 경계).
    expect(BANNER.test('const ConfirmedBannerless = 1;')).toBe(false);
  });
});

describe('🔴 AC-3 · 상주 확정 배너는 프로덕션 소스 어디에도 없다', () => {
  it('배너 이름·testID 를 담은 파일이 0개이고, 페이지·프리뷰는 스캔 대상이며 h16 프리뷰 키는 남는다', () => {
    const files = listProductionFiles(ROOT);

    // 긍정 짝 — 모집단이 비거나 두 소비처가 빠져 "0개"가 공짜로 통과하지 않게.
    expect(files).toContain('pages/itinerary-plan/ui/ItineraryPlanPage.tsx');
    expect(files).toContain('app/_dev/preview.tsx');
    expect(read('app/_dev/preview.tsx')).toContain("'h16-plan-confirmed'");

    // 부정 — 이름·testID 를 코드로 담은 파일이 없다(컴포넌트 파일 자체 포함).
    const offenders = files.filter((rel) =>
      BANNER.test(stripComments(read(rel)))
    );
    expect(offenders).toEqual([]);
  });
});
