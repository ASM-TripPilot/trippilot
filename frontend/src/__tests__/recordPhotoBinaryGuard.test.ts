/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-566 · AC-1 · INV-U5-03 · BR-U5-11/16 — 사진 **바이너리 업로드 경로 부재** 소스 가드.
 *
 * 무엇을 보장하나:
 *  - `features/record` + `shared/photo` 그래프 어디에도 사진 바이너리/스토리지 업로드 심볼이 없다
 *    (storage_key·storageKey·multipart·FormData·base64·uploadForCommunity 호출부) — 서버로 가는 것은
 *    로컬 자산ID·기기ID·촬영시각·EXIF(동의 시)·연결 방문 **메타만**(AddPhotoRequest 가 계약으로 봉쇄).
 *  - TRIP-1070 — 허브 [사진] 배선이 사는 `pages/live-itinerary` 도 같은 금칙어로 훑는다(사정거리 확장 —
 *    배선이 페이지에 생기면 features/record 스캔 밖이 된다).
 *  - 네이티브 사진 모듈 단일 입구(옛 G3)는 TRIP-1145 로 eslint `no-restricted-imports` 로 옮겼다.
 *  - 긍정 짝 — `AddPhotoRequest`(메타만) 실참조.
 *
 * 왜 소스 스캔인가: "코드가 새 업로드 경로를 짓지 않게" 를 잠그는 것은 실행이 아니라 그래프 부재 확인이다.
 * BR-U5-16(uploadForCommunity U7 미개통)의 호출부 금지는 기계 강제가 없어 이 스캔이 유일한 그물.
 *
 * ★ 조합 실검증(전처리×탐지기, 강제) — stripComments 가 주석 속 금칙어는 걷되 URL(`://`)은 살려두고,
 *   탐지기가 그 살아남은 것에 오검출/미검출을 안 내는지 **실제 문자열로 1회 태운다**(G0, 문제로그
 *   [[stripComments 가 URL 슬래시 오인]] 계열). 바이너리 스캔 범위는 features/record+shared/photo+
 *   pages/live-itinerary 로 한정 — generated/trips/trips.ts 주석에 storage_key 가 실재하나 그 밖이라
 *   사정거리 밖(src 전체로 넓히면 거짓 red). TRIP-1155로 첨부·방문 파일이 pages/trip-records·pages/records-calendar·
 *   features/check-visit·features/attach-visit-media로 흩어져 SCAN_DIRS에 더했다.
 */

const ROOT = path.resolve('src');

/** 바이너리 스캔 대상 — 사진 첨부 경로가 사는 곳만(shared 전체 아님, generated 주석 오탐 회피). */
const SCAN_DIRS = [
  'features/record',
  'shared/photo',
  'pages/live-itinerary',
  'pages/trip-records',
  'pages/records-calendar',
  'features/check-visit',
  'features/attach-visit-media',
];

/** 사진이 기기를 떠나는 경로의 핵심 파일 — 폴더 밖으로 옮겨지면 스캔이 조용히 줄어든다(편입 앵커). */
const UPLOAD_PATH_FILES = [
  'features/attach-visit-media/model/photoAttach.ts',
  'pages/trip-records/model/useVisitAttachments.ts',
  'shared/photo/index.ts',
  'pages/live-itinerary/ui/LiveItineraryPage.tsx',
];

/** 사진 바이너리 업로드 금칙어. 라벨은 실패 메시지에 뜬다. `base64: false` 같은 옵션도 적지 않는다(기본값). */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'storage_key', re: /storage_key/i },
  { label: 'storageKey', re: /storageKey/ },
  { label: 'multipart', re: /multipart/i },
  { label: 'FormData', re: /FormData/ },
  { label: 'base64', re: /base64/i },
  { label: 'uploadForCommunity(호출부)', re: /uploadForCommunity/ },
];

const firstForbidden = (source: string): string | null => {
  const hit = FORBIDDEN.find(({ re }) => re.test(source));
  return hit ? hit.label : null;
};

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

function scanGraph(): { file: string; source: string }[] {
  return SCAN_DIRS.flatMap((dirRel) =>
    listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
      file: relOf(full),
      source: stripComments(fs.readFileSync(full, 'utf8')),
    }))
  );
}

describe('G0 · 탐지기 자가검사 — stripComments × 금칙어 탐지 조합', () => {
  it('주석 속 금칙어는 걷히고, URL 은 살아남고, 코드 속 금칙어는 검출된다', () => {
    const sample = [
      '// storage_key·FormData·multipart 는 금지(수호 주석).',
      "const u = 'https://cdn.example.com/x';",
      "const legit = 'localAssetId';",
      "const bad = 'storageKey';",
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다(부정 단언을 거짓 red 로 만들지 않는다).
    expect(firstForbidden(stripped.split('\n')[0] ?? '')).toBeNull();
    // ② URL(://)은 콜론 예외로 살아남는다(전처리가 지우지 않는다).
    expect(stripped).toContain("const u = 'https://cdn.example.com/x';");
    // ③ 코드 속 금칙어는 살아남고 탐지된다(전처리가 다 지우면 G2 부정 단언이 공허).
    expect(stripped).toContain("const bad = 'storageKey';");
    expect(firstForbidden("const bad = 'storageKey';")).toBe('storageKey');
    // ④ 정상 메타 심볼은 오검출되지 않는다.
    expect(firstForbidden("const legit = 'localAssetId';")).toBeNull();
  });
});

describe('🔴 G2 · 바이너리 업로드 심볼 0 + 메타 실참조', () => {
  it('features/record+shared/photo+pages/live-itinerary 에 바이너리 금칙 6종 0건 + AddPhotoRequest 실참조', () => {
    const sources = scanGraph();
    // 사정거리 앵커 — 스캔 폴더가 전부 실재한다(오타·이동으로 빈 목록이 되면 red).
    expect(
      SCAN_DIRS.filter((dir) => !fs.existsSync(path.join(ROOT, dir)))
    ).toEqual([]);

    // 긍정 앵커 — 모집단이 비어있지 않다(구현 후 shared/photo 편입).
    expect(sources.length).toBeGreaterThan(0);
    // 편입 앵커 — 업로드 경로 핵심 파일이 스캔 모집단에 있다(폴더 밖 이동 시 red).
    const scanned = sources.map(({ file }) => file);
    expect(UPLOAD_PATH_FILES.filter((rel) => !scanned.includes(rel))).toEqual(
      []
    );

    // 부정 — 금칙어를 문 파일 0건.
    const offenders = sources
      .filter(({ source }) => firstForbidden(source) !== null)
      .map(({ file, source }) => ({ file, token: firstForbidden(source) }));
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 그래프가 메타 계약 AddPhotoRequest 를 실제로 문다(업로드 아님의 증거).
    const joined = sources.map((s) => s.source).join('\n');
    expect(joined).toContain('AddPhotoRequest');
  });
});
