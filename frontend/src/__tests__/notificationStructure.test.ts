/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-576 · l01 알림함 **소스 층 구조 가드** — 편입 앵커 · features/notification 경계 · d02 3층 책임.
 *
 * 왜 이 파일이 이 칸의 필수 산출인가: **features/notification 은 무심판이다**(repo-trap 실측) —
 * eslint `FEATURES` 배열에 notification 이 없고(zone 검사 밖), settings 와 달리 소스스캔 가드도 없다.
 * 이 칸이 다른 `features/*` 를 import 해도 lint·jest 아무도 안 잡는다. 이 파일이 그 **유일한 그물**이다.
 *
 * 무엇을 보장하나:
 *  - **G1 편입 앵커**: 신규 소스 11파일이 정본 경로에 실재한다.
 *  - **G2 features 경계**: `features/notification/**` 가 다른 feature(`@/features/<타feature>`) 를 직접
 *    import 하지 않는다(조합은 pages 전담). 긍정 짝 — 화면이 실제로 `@/shared/**` 를 소비한다.
 *  - **G3 d02 3층 책임**: 라우트→페이지→화면/훅 이 각자 몫만 진다(라우트는 조회를 모르고, 페이지가
 *    router·훅을 물고, 화면은 StateNotice 로 empty 를 그린다).
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·라우트 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/notification/model/notificationKind.ts',
  'features/notification/model/notificationAction.ts',
  'features/notification/model/groupByDay.ts',
  'features/notification/model/useNotificationInbox.ts',
  'features/notification/ui/NotificationInboxScreen.tsx',
  'features/notification/ui/NotificationRow.tsx',
  'shared/date/formatRelativeTime.ts',
  'shared/push/register.ts',
  'pages/notification-inbox/ui/NotificationInboxPage.tsx',
  'pages/notification-inbox/index.ts',
  'app/notifications.tsx',
];

const NOTIF_FEATURE_DIR_REL = 'features/notification';
const SCREEN_REL = 'features/notification/ui/NotificationInboxScreen.tsx';
const PAGE_REL = 'pages/notification-inbox/ui/NotificationInboxPage.tsx';
const ROUTE_REL = 'app/notifications.tsx';

/** 다른 feature 를 가리키는 import(자기 notification 은 상대경로라 여기 안 걸린다). */
const FEATURE_IMPORT = /@\/features\/([a-z][a-z-]*)/g;

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

describe('G1 · 편입 앵커 — 신규 11파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('G2 · features 경계 — notification 은 다른 feature 를 직접 import 하지 않는다', () => {
  it('features/notification/** 에 타 feature import 0건이고, 화면은 @/shared 를 문다', () => {
    const sources = scanDir(NOTIF_FEATURE_DIR_REL);

    // 긍정 앵커 — 모집단이 비어 있지 않고 이 칸의 화면이 그 안에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);

    // 부정 — 타 feature import 0건(자기 notification 은 상대경로라 대상 아님).
    const offenders = sources
      .filter(({ source }) =>
        [...source.matchAll(FEATURE_IMPORT)].some(
          (m) => m[1] !== 'notification'
        )
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 화면이 실제로 공용 UI 를 소비한다(구현 후 green).
    expect(readOne(SCREEN_REL)).toContain('@/shared/');
  });
});

describe('🔴 G3 · d02 3층 책임 — 라우트→페이지→화면/훅', () => {
  it('라우트는 페이지에 위임하고 조회를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);
    // 긍정 — 페이지로 위임.
    expect(route).toContain('@/pages/notification-inbox');
    // 부정 — 라우트가 feature·조회훅을 직접 물지 않는다(위임만).
    expect(route).not.toContain('@/features/notification');
    expect(route).not.toContain('useGetMeNotifications');
  });

  it('페이지가 화면·조회훅·router 를 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/notification');
    expect(page).toContain('useNotificationInbox');
    expect(page).toContain('router');
  });

  it('화면이 StateNotice 로 empty 를 그린다(순수 프레젠테이션)', () => {
    const screen = readOne(SCREEN_REL);
    expect(screen).toMatch(/export function NotificationInboxScreen\b/);
    expect(screen).toContain('@/shared/ui/StateNotice');
  });
});
