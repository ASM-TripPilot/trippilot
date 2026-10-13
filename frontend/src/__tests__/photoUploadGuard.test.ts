/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * 사진·공유 카드가 **서버로 올라가는 경로 부재** 소스 가드 — 옛 `recordPhotoBinaryGuard`(TRIP-566)와
 * `shareCardStructure`(TRIP-574)를 한 파일로 합쳤다(TRIP-1350). 두 파일이 같은 헬퍼(stripComments·소스 열거·
 * 금칙어 탐지)를 각자 복사해 쓰고 있었고, 금칙어 목록만 달랐다. 탐지기 자가검사 it 은 지웠다 — 두 스캔 모두 같은
 * it 안의 긍정 앵커(모집단·`AddPhotoRequest`·`buildShareCard` 실참조·어댑터 ≥1)가 탐지기 고장을 공허 통과로 두지 않는다.
 *
 * ── 사진 (TRIP-566 · AC-1 · INV-U5-03 · BR-U5-11/16) ─────────────────────────────
 *  - `features/record` + `shared/photo` 등 사진 첨부 경로 어디에도 사진 바이너리/스토리지 업로드 심볼이 없다
 *    (storage_key·storageKey·multipart·FormData·base64·uploadForCommunity 호출부) — 서버로 가는 것은
 *    로컬 자산ID·기기ID·촬영시각·EXIF(동의 시)·연결 방문 **메타만**(AddPhotoRequest 가 계약으로 봉쇄).
 *  - TRIP-1070 — 허브 [사진] 배선이 사는 `pages/live/live-itinerary` 도 같은 금칙어로 훑는다.
 *  - 네이티브 사진 모듈 단일 입구(옛 G3)는 TRIP-1145 로 eslint `no-restricted-imports` 로 옮겼다.
 *  - BR-U5-16(uploadForCommunity U7 미개통)의 호출부 금지는 기계 강제가 없어 이 스캔이 유일한 그물.
 *  - 바이너리 스캔 범위는 사진 첨부 경로가 사는 곳으로 한정 — generated/trips/trips.ts 주석에 storage_key 가 실재하나
 *    그 밖이라 사정거리 밖(src 전체로 넓히면 거짓 red). TRIP-1155 로 첨부·방문 파일이 흩어져 SCAN_DIRS 에 더했다.
 *
 * ── 공유 카드 (TRIP-574 · j06 · BR-U5-46) ────────────────────────────────────────
 *  - 서버 이미지 생성·서버 저장 심볼 0(`/ai/v1`·file-system·업로드·base64 계열) + 온디바이스 앵커(`buildShareCard`·
 *    `isShareCaptureArmed`·`saveShareCardImage` 실참조). **TRIP-1071**: 캡처 3종(view-shot·media-library·sharing)은
 *    금칙에서 빠졌다 — 온디바이스 캡처는 BR-U5-46 안이다. 캡처 어댑터는 "패키지를 정적 import 하는 파일"로 찾아 스캔에 더한다.
 *  - 캡처 패키지 정적 import 경계(옛 G5)는 TRIP-1145 로 eslint 로 옮겼다.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');
// 라우트는 src 밖 루트 app/ 에 있다(TRIP-1161) — 캡처 어댑터 탐색 모집단에 함께 넣는다. 경로는 ROOT 기준(`../app/…`).
const ROUTES = path.resolve('app');

type Forbidden = { label: string; re: RegExp }[];

/** 사진 바이너리 업로드 금칙어. 라벨은 실패 메시지에 뜬다. `base64: false` 같은 옵션도 적지 않는다(기본값). */
const PHOTO_FORBIDDEN: Forbidden = [
  { label: 'storage_key', re: /storage_key/i },
  { label: 'storageKey', re: /storageKey/ },
  { label: 'multipart', re: /multipart/i },
  { label: 'FormData', re: /FormData/ },
  { label: 'base64', re: /base64/i },
  { label: 'uploadForCommunity(호출부)', re: /uploadForCommunity/ },
];

/**
 * 서버 이미지 생성·서버 저장 금칙어. TRIP-1071: 캡처 3종은 온디바이스 캡처라 BR-U5-46 안이다 → 금칙에서 뺐다.
 * file-system 은 쓸 일이 없어 남긴다(view-shot `result:'tmpfile'` 이 file:// 경로를 준다). base64 도 남아
 * `result:'base64'` 는 막힌다.
 */
const SHARE_FORBIDDEN: Forbidden = [
  { label: 'expo-file-system', re: /expo-file-system/ },
  { label: '/ai/v1(서버 카드 생성)', re: /\/ai\/v1/ },
  { label: 'uploadForCommunity', re: /uploadForCommunity/ },
  { label: 'storage_key', re: /storage_key/i },
  { label: 'storageKey', re: /storageKey/ },
  { label: 'multipart', re: /multipart/i },
  { label: 'FormData', re: /FormData/ },
  { label: 'base64', re: /base64/i },
];

const firstForbidden = (list: Forbidden, source: string): string | null => {
  const hit = list.find(({ re }) => re.test(source));
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

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('🔴 G2 · 사진 바이너리 업로드 심볼 0 + 메타 실참조 (TRIP-566)', () => {
  /** 바이너리 스캔 대상 — 사진 첨부 경로가 사는 곳만(shared 전체 아님, generated 주석 오탐 회피). */
  const SCAN_DIRS = [
    'features/record',
    'shared/photo',
    'pages/live/live-itinerary',
    'pages/record/trip-records',
    'pages/record/records-calendar',
    'features/check-visit',
    'features/attach-visit-media',
  ];

  /** 사진이 기기를 떠나는 경로의 핵심 파일 — 폴더 밖으로 옮겨지면 스캔이 조용히 줄어든다(편입 앵커). */
  const UPLOAD_PATH_FILES = [
    'features/attach-visit-media/model/photoAttach.ts',
    'pages/record/trip-records/model/useVisitAttachments.ts',
    'shared/photo/index.ts',
    'pages/live/live-itinerary/ui/LiveItineraryPage.tsx',
  ];

  it('사진 첨부 경로 그래프에 바이너리 금칙 6종 0건 + AddPhotoRequest 실참조', () => {
    const sources = SCAN_DIRS.flatMap((dirRel) =>
      listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
        file: relOf(full),
        source: stripComments(fs.readFileSync(full, 'utf8')),
      }))
    );
    // 사정거리 앵커 — 스캔 폴더가 전부 실재한다(오타·이동으로 빈 목록이 되면 red).
    expect(
      SCAN_DIRS.filter((dir) => !fs.existsSync(path.join(ROOT, dir)))
    ).toEqual([]);

    // 긍정 앵커 — 모집단이 비어있지 않다.
    expect(sources.length).toBeGreaterThan(0);
    // 편입 앵커 — 업로드 경로 핵심 파일이 스캔 모집단에 있다(폴더 밖 이동 시 red).
    const scanned = sources.map(({ file }) => file);
    expect(UPLOAD_PATH_FILES.filter((rel) => !scanned.includes(rel))).toEqual(
      []
    );

    // 부정 — 금칙어를 문 파일 0건.
    const offenders = sources
      .filter(({ source }) => firstForbidden(PHOTO_FORBIDDEN, source) !== null)
      .map(({ file, source }) => ({
        file,
        token: firstForbidden(PHOTO_FORBIDDEN, source),
      }));
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 그래프가 메타 계약 AddPhotoRequest 를 실제로 문다(업로드 아님의 증거).
    const joined = sources.map((s) => s.source).join('\n');
    expect(joined).toContain('AddPhotoRequest');
  });
});

describe('🔴 G2 · 공유 카드 서버 이미지 생성·저장 심볼 0 + 온디바이스 앵커 (TRIP-574 AC-5 · TRIP-1071 캡처 3종 허용)', () => {
  /** 서버 이미지 생성 0 스캔 그래프(온디바이스 조립·캡처). 캡처 어댑터는 이 스캔이 성질로 더한다. */
  const SHARE_SCAN_FILES = [
    'features/reflection/model/shareCard.ts',
    'features/share-trip-card/model/shareCapture.ts',
    'pages/record/share-card/ui/ShareCardScreen.tsx',
    'pages/record/share-card/ui/ShareCardPreview.tsx',
    'pages/record/share-card/ui/FormatSegment.tsx',
    'pages/record/share-card/ui/ShareCardPage.tsx',
  ];
  const CAPTURE_REL = 'features/share-trip-card/model/shareCapture.ts';

  /** TRIP-1071 캡처 3종 — import 순간 네이티브 모듈을 강제 조회한다(재빌드 전 빌드에서 크래시). */
  const CAPTURE_PACKAGES = [
    'react-native-view-shot',
    'expo-media-library',
    'expo-sharing',
  ] as const;

  const TEST_ONLY_DIRS = ['__tests__', '__mocks__', 'test-support', 'mocks'];

  const escapeRe = (text: string) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** 정적 형태의 import(정적 from·type·side-effect import·require, 하위 경로 포함). 동적 import 는 제외. */
  function hasStaticImportOf(source: string, moduleId: string): boolean {
    const id = `${escapeRe(moduleId)}(?:/[^'"]*)?`;
    return (
      new RegExp(`\\bfrom\\s*['"]${id}['"]`).test(source) ||
      new RegExp(`\\bimport\\s+['"]${id}['"]`).test(source) ||
      new RegExp(`\\brequire\\(\\s*['"]${id}['"]\\s*\\)`).test(source)
    );
  }

  /** 캡처 패키지를 정적으로 끌어오는 프로덕션 파일 = 어댑터(`src/**`·라우트 `app/**`, 테스트 전용 디렉토리 제외). */
  function captureAdapters(): { file: string; source: string }[] {
    // shared/photo 는 제외 — TRIP-1070 사진 첨부 입구가 expo-media-library 를 호출 시점 require 로 문다(앨범
    // 읽기, 캡처 아님). 그쪽 부팅 안전(정적 import 0)은 eslint no-restricted-imports 가 잠근다.
    return [ROOT, ROUTES]
      .flatMap(listSourceFiles)
      .map((full) => path.relative(ROOT, full))
      .filter(
        (rel) =>
          !rel.split(path.sep).some((seg) => TEST_ONLY_DIRS.includes(seg))
      )
      .map((rel) => ({ file: rel, source: readOne(rel) }))
      .filter(
        ({ file, source }) =>
          !file.split(path.sep).join('/').startsWith('shared/photo/') &&
          CAPTURE_PACKAGES.some((pkg) => hasStaticImportOf(source, pkg))
      );
  }

  it('shareCard 그래프(+캡처 모듈·어댑터)에 금칙 8종 0건 + buildShareCard·isShareCaptureArmed·saveShareCardImage 실참조', () => {
    // 스캔 목록 = 고정 목록 + 캡처 어댑터(이름이 아니라 "패키지를 정적 import 하는 파일"로 편입 — 02a ★8).
    const adapterFiles = captureAdapters().map(({ file }) => file);
    const scanFiles = [...new Set([...SHARE_SCAN_FILES, ...adapterFiles])];
    const sources = scanFiles.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 앵커 — 고정 목록의 파일이 그 자리에 있다(옮겨지면 readOne 이 '' 를 돌려 아래 부정이 공허하게 통과한다).
    expect(
      SHARE_SCAN_FILES.filter((rel) => !fs.existsSync(path.join(ROOT, rel)))
    ).toEqual([]);

    // 부정 — 금칙어를 문 파일 0건.
    const offenders = sources
      .filter(({ source }) => firstForbidden(SHARE_FORBIDDEN, source) !== null)
      .map(({ file, source }) => ({
        file,
        token: firstForbidden(SHARE_FORBIDDEN, source),
      }));
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 그래프가 온디바이스 조립·캡처를 실참조(빈 파일이면 red).
    const joined = sources.map((s) => s.source).join('\n');
    expect(joined).toContain('buildShareCard');
    expect(readOne(CAPTURE_REL)).toContain('isShareCaptureArmed');
    expect(readOne(CAPTURE_REL)).toContain('saveShareCardImage');
    // 어댑터도 스캔에 들어왔다(0개면 캡처 코드가 G2 사각에 있다).
    expect(adapterFiles.length).toBeGreaterThan(0);
  });
});
