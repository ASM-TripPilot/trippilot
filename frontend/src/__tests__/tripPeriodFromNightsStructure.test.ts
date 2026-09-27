/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-1027 AC-7 · O5 — 기간을 박수에서 파생하면서 **사라져야 할 표면**이 실제로 사라졌는지 소스로 본다.
 *
 * 무엇을 보장하나:
 *  - 1/4 박수·기간 불일치 안내 한 줄(TRIP-1010)의 prop·testID·문구 조립·조사 헬퍼가 화면·배선에 없다.
 *  - 2탭 범위 전이 `applyRangePick` 이 정의·사용 어디에도 없다(시작만 고르므로 고아 — 01b O5).
 *  - 그 안내를 보여 주던 프리뷰 키가 없다.
 *
 * 왜 소스 스캔인가: 렌더 테스트는 "안내가 안 뜬다"까지만 본다. 안 쓰는 prop·헬퍼·함수가 코드에
 * 남아 있어도 렌더는 같으므로, 고아 제거는 소스에서만 잴 수 있다.
 *
 * 전처리: 주석을 걷고 본다(`:` 뒤 `//` 는 URL 이라 주석으로 보지 않는다 — 리포 관례). 제거 사실을
 * 설명하는 주석이 남아도 오탐하지 않게 하려는 것이다(02a ★15).
 * 가짜 통과 방지: 모든 "없어야 한다"는 같은 it 안에서 그 파일의 "있어야 한다"와 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  return stripComments(readFileSync(join(SRC_ROOT, rel), 'utf8'));
}

const CASES: { file: string; forbidden: string[]; anchor: string }[] = [
  {
    file: 'pages/trip-new-step1/ui/TripNewStep1Page.tsx',
    forbidden: [
      'nightsMismatchNote',
      'withDirectionalParticle',
      'applyRangePick',
    ],
    anchor: 'PeriodEditSheet',
  },
  {
    file: 'features/trip/ui/TripWizardStep1Screen.tsx',
    forbidden: ['nightsMismatchNote', 'nights-mismatch-note'],
    anchor: 'trip-wizard-summary-period',
  },
  {
    file: 'features/trip/model/tripDatePicker.ts',
    forbidden: ['applyRangePick'],
    anchor: 'export function dateCell',
  },
  {
    file: 'app/_dev/preview.tsx',
    forbidden: ['trip-new-step1-nights-mismatch', 'nightsMismatchNote'],
    anchor: 'trip-new-step1-period-sheet',
  },
];

describe('G0 · 탐지기 자가검사 (전처리 × needle)', () => {
  it('주석 속 이름은 걷히고, 코드 속 이름과 URL 은 살아남는다', () => {
    const sample = [
      '// TRIP-1010 의 nightsMismatchNote 를 지웠다',
      '/* applyRangePick 은 고아라 삭제 */',
      "const url = 'https://example.com/a';",
      'const keep = applyRangePick;',
    ].join('\n');

    const stripped = stripComments(sample);

    expect(stripped).not.toContain('nightsMismatchNote');
    expect(stripped.match(/applyRangePick/g)).toHaveLength(1);
    expect(stripped).toContain('https://example.com/a');
  });
});

describe('TRIP-1027 AC-7 · 1010 안내 한 줄·2탭 범위 전이가 소스에서 사라졌다', () => {
  it.each(CASES)(
    '$file 에 제거 대상 이름이 없고, 긍정 앵커는 있다',
    ({ file, forbidden, anchor }) => {
      const source = read(file);

      // 긍정 짝 — 파일을 실제로 읽었다(빈 문자열·오경로 공허 통과 차단).
      expect(source).toContain(anchor);
      // 부정 — 하나라도 남으면 그 이름을 보여 준다.
      expect(forbidden.filter((needle) => source.includes(needle))).toEqual([]);
    }
  );
});
