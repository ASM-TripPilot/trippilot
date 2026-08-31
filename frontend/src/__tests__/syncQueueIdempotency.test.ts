/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-568 · AC-1(구조가드)·AC-4 — 오프라인 큐·충돌 소스 층 가드.
 *
 * 무엇을 보장하나:
 *  - **G1 재생 경로 단일 출처(AC-1)**: 큐 재생 함수 `replayQueue` 가 `features/record/**` 에서 오직
 *    `syncQueue.ts` 한 파일에만 산다(다른 훅이 재생 루프를 복제하면 여기서 빨개진다). 그 재생이 409 를
 *    raw 로 뭉치지 않고 공용 분류기 `resolveVisitConflict` 로 가른다는 것을 syncQueue.ts 보유로 못박는다
 *    (맹점①). ⚠️ `resolveVisitConflict` **자체는 이미 `useAdjustVisitTimes.ts`(온라인 PATCH 409)가
 *    정당하게 쓰므로 단일 출처가 아니다** — 그래서 전역 단일출처가 아니라 syncQueue.ts 의 긍정 보유만 잰다.
 *  - **G2 기기 자산 미삭제(AC-4 · BR-U5-23a)**: 신설 소스에 기기 앨범 삭제 심볼(`deleteAsset`·
 *    `MediaLibrary`·`expo-media-library`·`removeAsset`)이 **0건**이다. 서버 메타만 선택 버전으로
 *    맞추고 버린 쪽 사진의 로컬 자산은 안 건드린다(기기 앨범은 사용자 소유). 지금 사진 자산 접근
 *    모듈이 리포에 없어 원리적으로 0이지만, 미래에 누가 붙이면 red 로 걸리는 트립와이어다.
 *
 * 왜 소스 스캔인가: "재생 경로가 한 파일에만 있다"·"삭제를 안 부른다"는 렌더/유닛으로 증명하기
 *   어렵다 — 부재(不在)는 스캔이 가장 확실한 그물.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·경로 보존 —
 *   다른 파일 주석의 "syncQueue.replayQueue" 산문 참조가 offender 로 오탐되지 않게 한다).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const RECORD_DIR_REL = 'features/record';
const SYNC_QUEUE_REL = 'features/record/model/syncQueue.ts';

/** 신설 4소스 + 각 파일의 존재 앵커 심볼(공허 통과 차단). */
const NEW_SOURCES: { rel: string; anchor: string }[] = [
  { rel: 'features/record/model/syncQueue.ts', anchor: 'replayQueue' },
  { rel: 'features/record/model/conflict.ts', anchor: 'isVisitConflict' },
  { rel: 'features/record/ui/SyncBadge.tsx', anchor: 'record-trip-sync-badge' },
  {
    rel: 'features/record/ui/ConflictSheet.tsx',
    anchor: 'record-conflict-apply',
  },
];

/** 재생·409분류의 단일 출처 감시 토큰. */
const REPLAY_TOKEN = 'replayQueue';
const CONFLICT_CLASSIFIER = 'resolveVisitConflict';

/** 기기 앨범 자산 삭제 심볼(부재 스캔 대상, BR-U5-23a). */
const ASSET_DELETE = /deleteAsset|MediaLibrary|expo-media-library|removeAsset/;

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

function scanDir(dirRel: string): { file: string; source: string }[] {
  return listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function filesContaining(dirRel: string, token: string): string[] {
  return scanDir(dirRel)
    .filter(({ source }) => source.includes(token))
    .map(({ file }) => file);
}

describe('G0 · 탐지기 자가검사 — stripComments × 탐지기 조합', () => {
  it('주석 속 참조·금칙어는 걷히고, 코드·URL 은 살아남으며, 자산삭제 정규식이 실제로 문다', () => {
    const sample = [
      '/**',
      ' * syncQueue.replayQueue 와 resolveVisitConflict 를 산문으로 적어도 걷힌다.',
      ' * 버린 사진의 MediaLibrary.deleteAsync 는 부르지 않는다(설계 근거 주석).',
      ' * 참조: https://figma.com/design/x',
      ' */',
      "const url = 'https://example.com/a'; // MediaLibrary",
      "import { resolveVisitConflict } from '@/shared/api/visitConflict';",
      'export function replayQueue() {}',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 산문 참조는 걷힌다 — 다른 파일 주석의 참조가 offender 로 오탐되지 않게.
    const firstDocLine = stripped.split('\n')[1] ?? '';
    expect(firstDocLine).not.toContain('replayQueue');
    expect(firstDocLine).not.toContain('resolveVisitConflict');
    // ② URL 의 // 는 주석으로 오인 안 됨(콜론 예외) — 그 줄이 살아남는다.
    expect(stripped).toContain("const url = 'https://example.com/a';");
    // ③ 코드에 실재하는 재생·분류 토큰은 살아남는다(전처리가 다 지우면 G1 이 공허).
    expect(stripped).toContain('resolveVisitConflict');
    expect(stripped).toContain('replayQueue');
    // ④ 자산삭제 정규식이 실제 심볼을 문다(공허 부재 단언 차단).
    expect(ASSET_DELETE.test('MediaLibrary.deleteAsync(id)')).toBe(true);
    expect(ASSET_DELETE.test('const files = readdirSync(dir);')).toBe(false);
  });
});

describe('🔴 G1 · AC-1 재생 경로 단일 출처 — syncQueue.ts 밖에 없다', () => {
  it('replayQueue 가 features/record 에서 오직 syncQueue.ts 에 있고, 그 재생이 공용 409 분류기를 문다', () => {
    // 긍정 앵커 — 모집단이 비어있지 않다(기존 record 파일들).
    expect(scanDir(RECORD_DIR_REL).length).toBeGreaterThan(0);

    // 단일 출처 — 재생 함수는 그 한 파일에만(재생 루프 복제 금지).
    expect(filesContaining(RECORD_DIR_REL, REPLAY_TOKEN)).toEqual([
      SYNC_QUEUE_REL,
    ]);

    // 긍정 짝(🔴 red-first) — syncQueue.ts 가 재생 함수 + 공용 409 분류기를 둘 다 문다.
    // (409 를 raw status 로 뭉치지 않고 resolveVisitConflict 로 가른다는 증거, 맹점①.)
    // resolveVisitConflict 자체는 useAdjustVisitTimes.ts 도 쓰므로 전역 단일출처로는 안 잰다.
    const syncQueue = readOne(SYNC_QUEUE_REL);
    expect(syncQueue).toContain(REPLAY_TOKEN);
    expect(syncQueue).toContain(CONFLICT_CLASSIFIER);
  });
});

describe('🔴 G2 · AC-4 기기 자산 삭제 부재 — 버린 로컬 사진을 안 지운다(BR-U5-23a)', () => {
  it('신설 4소스에 자산삭제 심볼 0건 + 각 파일 실재·앵커 심볼 보유', () => {
    const offenders = NEW_SOURCES.filter(({ rel }) =>
      ASSET_DELETE.test(readOne(rel))
    ).map(({ rel }) => rel);
    expect(offenders).toEqual([]);

    // 긍정 앵커 — 4파일이 실재하고 알려진 심볼을 문다(빈/부재 파일의 공허 통과 차단).
    for (const { rel, anchor } of NEW_SOURCES) {
      expect({ rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
        rel,
        exists: true,
      });
      expect(readOne(rel)).toContain(anchor);
    }
  });
});
