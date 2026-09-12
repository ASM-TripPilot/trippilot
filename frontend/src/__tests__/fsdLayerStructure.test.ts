/**
 * @jest-environment node
 */
// FSD 층 구조를 fs 로 훑어 굳힌다: (AC-4a) src 직계 디렉토리 허용목록, (AC-4b) 슬라이스
// 세그먼트 허용목록(옛 칸 부활 금지), (AC-5) shared 층이 상위 층을 import 하지 않음.
// `fsdStructure.test.ts`(auth/onboarding/home 3슬라이스 완전일치)의 A/B 졸업 원장을
// 흔들지 않도록 별 파일로 둔다 — 여기서 전 슬라이스·shared 층 전체로 일반화한다.
//
// 리포 확립 규약: "없어야 한다"(부정)는 "있어야 한다"(긍정 짝)와 같은 it 안에 둔다 —
// 빈 디렉토리·빈 모집단에서 부정이 공허 통과하는 것을 긍정 짝이 먼저 막는다.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const FEATURES_DIR = path.join(ROOT, 'features');
const PAGES_DIR = path.join(ROOT, 'pages');
const SHARED_DIR = path.join(ROOT, 'shared');

// src 직계 허용목록(11) — widgets·entities 는 아직 빈 층(D2)이라 포함하되 실존은 강제하지 않는다.
const SRC_ALLOWLIST = [
  '__tests__',
  'app',
  'app-shell',
  'assets',
  'entities',
  'features',
  'mocks',
  'pages',
  'shared',
  'test-support',
  'widgets',
];

// 슬라이스 세그먼트 허용목록(4) — 옛 칸(screens·components·containers·hooks·store) 부활 금지.
const SEGMENT_ALLOWLIST = ['config', 'lib', 'model', 'ui'];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가
 * 소실된다). 줄 주석에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** — `'https://…'`
 * 의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 디렉토리 바로 아래(재귀 없음)의 하위 디렉토리 이름만 정렬해 반환한다(없으면 빈 배열). */
function listDirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** 디렉토리를 재귀로 훑어 프로덕션 소스 파일 절대경로만 모은다(generated·테스트 파일 제외). */
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

function readAll(files: string[]): { file: string; source: string }[] {
  return files.map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 AC-5 단언이 의미를 갖는다', () => {
  it('주석 속 상위층 참조는 걷히고, 코드의 @/shared·URL·진짜 위반은 살아남는다', () => {
    const sample = [
      '/** layer-widgets.md: @/features/x 는 shared 가 못 본다. */',
      "// import '@/pages/foo';",
      "import { api } from '@/shared/api';",
      "const doc = 'https://figma.com/x';",
      "const bad = '@/features/home/model/x';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석 속 금칙어는 걷힌다 — 안 걷으면 층 문서를 인용한 주석이 거짓 offender 를 만든다.
    expect(/@\/pages\//.test(stripped)).toBe(false);
    expect(stripped).not.toContain('layer-widgets.md');

    // 코드의 자기참조·URL·진짜 위반은 살아남는다(콜론 뒤 `//` 는 주석이 아니다).
    expect(stripped).toContain('@/shared/api');
    expect(/https?:\/\//.test(stripped)).toBe(true);
    expect(/@\/features\//.test(stripped)).toBe(true);
  });
});

describe('AC-4(a) · src 직계 디렉토리는 허용목록의 부분집합이다', () => {
  it('정체불명 디렉토리 0 (부정) + 실재 9개 대표 존재 (긍정 짝)', () => {
    const actual = listDirNames(ROOT);

    // 긍정 짝 — 빈 src 에서 부정이 공허 통과하는 것을 막는다. widgets·entities 는 빈 층이라 제외.
    [
      '__tests__',
      'app',
      'app-shell',
      'assets',
      'features',
      'mocks',
      'pages',
      'shared',
      'test-support',
    ].forEach((dir) => expect(actual).toContain(dir));

    // 부정 — 허용목록(11) 밖 디렉토리 0.
    const unknown = actual.filter((dir) => !SRC_ALLOWLIST.includes(dir));
    expect(unknown).toEqual([]);
  });
});

describe('AC-4(b) · features/pages 각 슬라이스 세그먼트는 {ui,model,lib,config} 뿐이다', () => {
  it('옛 칸 부활 0 (부정) + 슬라이스 수 앵커 (긍정 짝)', () => {
    const featureSlices = listDirNames(FEATURES_DIR);
    const pageSlices = listDirNames(PAGES_DIR);

    // 긍정 짝 — 모집단이 비면 부정이 공허 통과한다.
    expect(featureSlices.length).toBeGreaterThanOrEqual(13);
    expect(featureSlices).toEqual(
      expect.arrayContaining(['auth', 'home', 'onboarding'])
    );
    expect(pageSlices.length).toBeGreaterThanOrEqual(1);

    // 부정 — 각 슬라이스의 직계 하위 디렉토리가 세그먼트 허용목록 밖이면 offender.
    const scan: [layer: string, slice: string][] = [
      ...featureSlices.map((slice) => ['features', slice] as [string, string]),
      ...pageSlices.map((slice) => ['pages', slice] as [string, string]),
    ];
    const offenders = scan.flatMap(([layer, slice]) =>
      listDirNames(path.join(ROOT, layer, slice))
        .filter((segment) => !SEGMENT_ALLOWLIST.includes(segment))
        .map((segment) => `${layer}/${slice}: ${segment}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe('AC-5 · shared 층은 상위 층(features·entities·widgets·pages·app)을 import 하지 않는다', () => {
  it('상위층 참조 0 (부정) + shared 모집단·자기참조 존재 (긍정 짝)', () => {
    const sources = readAll(listSourceFiles(SHARED_DIR));

    // 긍정 짝 — 모집단이 채워졌고, shared 가 @/shared 는 정당히 참조한다(공허 통과 방지).
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.some(({ source }) => source.includes('@/shared/'))).toBe(
      true
    );

    // 부정 — 상위 층 import 0. `@/app-shell`(하이픈)과 `@/app/`(슬래시)을 구분한다.
    const UPWARD = [
      { name: '@/features/', hit: (s: string) => s.includes('@/features/') },
      { name: '@/entities/', hit: (s: string) => s.includes('@/entities/') },
      { name: '@/widgets/', hit: (s: string) => s.includes('@/widgets/') },
      { name: '@/pages/', hit: (s: string) => s.includes('@/pages/') },
      { name: '@/app-shell', hit: (s: string) => s.includes('@/app-shell') },
      { name: '@/app/', hit: (s: string) => /@\/app\//.test(s) },
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      UPWARD.filter((rule) => rule.hit(source)).map(
        (rule) => `${file}: ${rule.name}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
