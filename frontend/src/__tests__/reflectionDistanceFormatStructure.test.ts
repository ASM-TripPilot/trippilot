/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1086 · 결정 1(a) — 회고 거리 표기는 `features/reflection/model/formatKm.ts` 한 곳에서 만든다.
 *
 * 무엇을 보장하나: 거리 문자열을 만들던 세 자리(j03 타일 · j04/j06 통계 · 폴백 ③ 문장)가 모두
 * `formatKm(` 을 부르고, 날값 보간(`${…DistanceKm}km`)은 남아 있지 않다.
 *
 * 왜 소스 스캔인가: 화면 테스트는 "1.9km 가 보인다"만 잰다. 세 자리가 각자 반올림을 복붙해도 그 값은
 * 같게 나와 green 이다 — "한 함수로 모은다"는 결정은 import 관계로만 드러난다.
 *
 * **전제**: 주석을 걷은 소스를 본다(세 파일 머리 주석에 `${km}km` 산문이 실재). 콜론 뒤 `//` 는 보존.
 */

const ROOT = path.resolve('src');

const FORMAT_REL = 'features/reflection/model/formatKm.ts';
const CALLERS = [
  'features/reflection/ui/ReflectionStatsRow.tsx',
  'features/reflection/model/summaryStats.ts',
  'features/reflection/model/reflectionFallback.ts',
];

/** 날값 보간 탐지기 — `${stats.distanceKm}km` · `${stats.totalDistanceKm}km`. */
const RAW_KM = /\$\{[^}]*istanceKm\}\s*km/;
const CALLS_FORMAT = /\bformatKm\(/;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readStripped(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — stripComments × RAW_KM·CALLS_FORMAT 조합', () => {
  it('주석 속 날값 보간은 걷히고, 코드 줄의 보간·호출은 살아남아 걸린다', () => {
    const sample = [
      '/**',
      ' * 옛 표기 `${stats.distanceKm}km` 를 산문으로 적어도 걷힌다.',
      ' */',
      '// 한 줄 주석 `${stats.totalDistanceKm}km` 도 걷힌다.',
      'const a = `이동 ${stats.distanceKm}km`;',
      'const b = formatKm(stats.distanceKm);',
    ].join('\n');

    const stripped = stripComments(sample);

    // 블록 주석이 걷히면 줄 번호가 당겨진다 — 위치가 아니라 내용으로 판정한다.
    // 날값 보간이 걸리는 줄은 코드 줄 하나뿐이다(주석 속 두 개는 걷혔다).
    expect(stripped.split('\n').filter((line) => RAW_KM.test(line))).toEqual([
      'const a = `이동 ${stats.distanceKm}km`;',
    ]);
    // formatKm 호출 코드 줄도 살아남는다(전처리가 다 지우면 아래 부정 단언이 공허해진다).
    expect(stripped).toMatch(CALLS_FORMAT);
  });
});

describe('🔴 결정 1(a) · 거리 표기 단일 출처(formatKm)', () => {
  it('formatKm.ts 가 실재한다', () => {
    expect(fs.existsSync(path.join(ROOT, FORMAT_REL))).toBe(true);
  });

  it.each(CALLERS)('%s 는 formatKm 을 부르고 날값 보간이 없다', (rel) => {
    const source = readStripped(rel);

    // 긍정 앵커 — 파일이 실재한다(빈 문자열 공허 통과 차단).
    expect(source.length).toBeGreaterThan(0);
    expect(source).toMatch(CALLS_FORMAT);
    expect(source).not.toMatch(RAW_KM);
  });
});
