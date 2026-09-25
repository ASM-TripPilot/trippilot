/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-768 · AC-9 — records-default 프리뷰 픽스처가 j 밴드 마커족(visited 사진 2·planned 2·stay 1)을
 * **로컬 번들 사진**으로 주입한다는 소스 층 가드. 렌더로 못 보는 것(픽스처 구성·에셋 출처)만 본다.
 *
 * 무엇을 보장하나:
 *  - records-default 지도가 5핀(사진2·planned2·stay1)으로 채워졌다 — kind 분기·연결선 검증(파일 B)이
 *    실제 프리뷰에서 무엇을 그리는지의 입력.
 *  - 사진은 **인라인 `require('@/assets/...')`(번들 number source)** 다 — `DRAFT_PREVIEW_PHOTOS`
 *    (= `Image.resolveAssetSource(...).uri` 로 해석된 문자열/null)를 재사용하면 마커 래스터가 async URL
 *    로 흔들린다(seed 결정 2). 그 함정을 "블록 안 require ≥ 2 + 파일 실재"로 잠근다.
 *
 * http(s) 리터럴 0건(외부 URL 금지)은 전역 S4(itineraryMapSurfaceStructure)가 preview.tsx 전체에서
 * 이미 잠근다 — 여기서는 records-default 블록에 국한해 이중으로 확인한다.
 *
 * ⚠️ 모든 스캔은 주석을 걷어낸 소스를 본다(리포 관례). 줄 주석 규칙에서 바로 앞 글자가 `:` 이면
 * 주석으로 보지 않는다(URL 슬래시 오인 방지). 아래 조합 자가검사가 전처리+탐지기가 서로를 지우지
 * 않음을 1회 확인한다.
 */

const ROOT = path.resolve('src');
const PREVIEW_REL = 'app/_dev/preview.tsx';
const RECORDS_KEY = 'records-default';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readPreview(): string {
  const full = path.join(ROOT, PREVIEW_REL);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

/** `key: 'records-default'` 항목 하나를 다음 `key: '` 직전까지 떼어낸다. 못 찾으면 빈 문자열
 *  (도달 앵커가 잡는다). */
function fixtureBlock(source: string, key: string): string {
  const start = source.indexOf(`key: '${key}'`);
  if (start === -1) return '';
  const next = source.indexOf("key: '", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function countKind(block: string, kind: string): number {
  return [...block.matchAll(new RegExp(`kind:\\s*'${kind}'`, 'g'))].length;
}

describe('조합 자가검사 — stripComments 와 kind 탐지기가 서로를 지우지 않는다', () => {
  it('주석 속 kind 지문은 걷히고 코드의 kind 리터럴은 살아남는다', () => {
    const sample = [
      '// planned 는 회색 점선으로 그린다',
      "{ number: 3, kind: 'planned' },",
      "const photo = require('@/assets/itinerary/draft-preview-1.jpg');",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석은 걷힌다 — 안 걷으면 주석의 'planned' 가 카운트를 부풀린다.
    //    주석줄 전체가 사라졌으므로 planned 카운트는 코드의 1개뿐이다.
    expect(countKind(stripped, 'planned')).toBe(1);
    // ② ★ 코드의 require 는 살아남아야 한다(`://` 가드 없으면 잘림 — 리포 실측 함정).
    expect(stripped).toContain(
      "require('@/assets/itinerary/draft-preview-1.jpg')"
    );
  });
});

describe('🔴 AC-9 — records-default 픽스처: visited 2·planned 2·stay 1 + 로컬 require 사진 2', () => {
  it('블록에 kind 5핀 구성과 실재하는 @/assets require 가 있고 외부 URL 은 없다', () => {
    const source = readPreview();
    const block = fixtureBlock(source, RECORDS_KEY);

    // 도달 앵커 — 파일을 실제로 읽었고 블록을 정확히 떼어냈다.
    expect(source.length).toBeGreaterThan(1000);
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain(RECORDS_KEY);

    // ① kind 구성 — 사진(visited) 2 · planned 2 · stay 1 (= 5핀).
    expect(countKind(block, 'visited')).toBe(2);
    expect(countKind(block, 'planned')).toBe(2);
    expect(countKind(block, 'stay')).toBe(1);

    // ② 사진은 인라인 로컬 require(번들 number source) 로 최소 2개.
    const required = [
      ...block.matchAll(/require\(\s*['"]@\/assets\/([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);
    expect(required.length).toBeGreaterThanOrEqual(2);

    // ③ 가리키는 파일이 전부 디스크에 실재한다(없는 경로 require 는 Metro 번들을 깨뜨린다).
    const missing = required.filter(
      (rel) => !fs.existsSync(path.join(ROOT, 'assets', rel))
    );
    expect(missing).toEqual([]);

    // ④ 외부 URL 0건(S4 전역과 이중, records 블록 국한). 죽은 링크·오프라인 미표시가 프리뷰를
    //    실제보다 나쁘게 보이게 하는 것을 막는다.
    expect(/https?:\/\//.test(block)).toBe(false);
  });
});
