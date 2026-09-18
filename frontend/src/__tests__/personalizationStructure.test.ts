/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-612 · l05 개인화 3층 분할 소스 가드(AC-9 계층·라우트 무로직).
 *
 * 무엇을 보장하나:
 *  - 라우트(app)·pages(배럴·페이지)·features(화면·훅·순수) 6파일이 정본 경로에 실재한다.
 *  - 라우트는 **무로직 래퍼**다 — pages 배럴만 import 하고 useState·View·조회 훅을 밀반입하지 않는다.
 *  - pages 배럴이 PersonalizationPage 를 재수출하고, 페이지가 usePersonalization·PersonalizationScreen 을
 *    둘 다 배선한다(3층 접착 앵커 — 빈 파일 공허통과 차단).
 *
 * 왜 여기서 안 잠그는가(중복 회피):
 *  - **경계(다른 feature import 0)** 는 기존 `settingsBoundary.test.ts` 가 features/settings 재귀 스캔으로
 *    신규 3파일을 자동 편입해 잠근다(02a §5-E) — 여기서 재신설하지 않는다.
 *  - **INV-3(duration)·raw-hex** 는 `myStaysStructure.test.ts`(features/settings/ui 재귀)·
 *    `pagesLayerStructure.test.ts`(pages 재귀)가 자동 편입해 이중 방어 — 여기서 재스캔하지 않는다.
 *
 * (개념) `existsSync(p)`: 경로 p 가 존재하면 true. `readFileSync(p,'utf8')`: 파일을 문자열로 읽는다.
 */

const SRC = resolve(__dirname, '..');
const ROUTE = join(SRC, 'app', 'settings', 'personalization.tsx');
const BARREL = join(SRC, 'pages', 'settings-personalization', 'index.ts');
const PAGE = join(
  SRC,
  'pages',
  'settings-personalization',
  'ui',
  'PersonalizationPage.tsx'
);
const SCREEN = join(
  SRC,
  'features',
  'settings',
  'ui',
  'PersonalizationScreen.tsx'
);
const HOOK = join(
  SRC,
  'features',
  'settings',
  'model',
  'usePersonalization.ts'
);
const COPY = join(
  SRC,
  'features',
  'settings',
  'model',
  'personalizationCopy.ts'
);

describe('TRIP-612 · 개인화 3층 분할(AC-9)', () => {
  it('S1: 6파일이 정본 경로에 실재한다', () => {
    for (const p of [ROUTE, BARREL, PAGE, SCREEN, HOOK, COPY]) {
      expect(existsSync(p)).toBe(true);
    }
  });

  it('S2: 라우트는 무로직 래퍼 — pages 배럴만 import(긍정) + 로직 심볼 0(부정)', () => {
    const src = readFileSync(ROUTE, 'utf8');
    // 긍정: 배럴을 경유한다.
    expect(src).toContain('@/pages/settings-personalization');
    // 부정: 화면 로직·조회를 라우트에 밀반입하지 않는다.
    expect(src).not.toContain('useState');
    expect(src).not.toContain('useGetMePersonalization');
    expect(src).not.toMatch(/<View\b/);
  });

  it('S3: pages 배럴이 PersonalizationPage 를 재수출한다', () => {
    expect(readFileSync(BARREL, 'utf8')).toContain('PersonalizationPage');
  });

  it('S4: 페이지가 usePersonalization·PersonalizationScreen 을 둘 다 배선한다', () => {
    const src = readFileSync(PAGE, 'utf8');
    expect(src).toContain('usePersonalization');
    expect(src).toContain('PersonalizationScreen');
  });
});
