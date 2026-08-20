/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-457 AC-1 · AC-14(소스 절반) — e03 숙소 상세 스캐폴딩·라우트 얇은 래퍼·몰입 소스 가드.
 *
 * 무엇을 보장하나:
 *  - 신규 8파일이 정본 경로에 실재한다(AC-1 스캐폴딩 · 짝 앵커).
 *  - 라우트 `stays/[stayId].tsx` 는 얇은 래퍼다 — `@/pages/stay-detail` 을 참조하고 조회·마크업·
 *    파싱을 직접 만지지 않는다(AC-1, `stays/index.tsx` 선례 동형).
 *  - 배럴이 `StayDetailPage` 를 재수출한다.
 *  - `StayDetailScreen.tsx` 는 하단 탭바(`BottomTabBar`)를 렌더하지 않는다(AC-14 몰입, 소스 절반 —
 *    렌더 절반은 `StayDetailScreen.test.tsx` S6 가 잠근다).
 *  - 페이지가 params 파싱·저장 훅을 실제로 문다(공허 통과 방지 짝).
 *
 * INV-3(duration)·URL·zustand·raw hex·useState 등은 동결 가드가 자동 편입해 잠근다:
 *  - `pagesLayerStructure.test.ts`(src/pages 재귀) → StayDetailPage
 *  - `staySearchStructure.test.ts`(features/stay·app/stays 재귀) → 화면·시트·모델·라우트
 * 이 파일은 그 가드에 **없는** 것(스캐폴딩 존재·라우트 얇음·몰입 소스)만 잠근다.
 *
 * **전제** — 모든 it 은 주석을 걷어낸 소스를 스캔한다(`stripComments`, 콜론 예외 계승). 여기선
 * 정규식 탐지기가 아니라 substring 검사만 쓰므로 전처리×탐지기 상호소거 위험이 없다(★F-12) —
 * 그래도 G0 자가검사로 콜론 예외(URL 슬래시 보존)만 리포 관례대로 확인한다.
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/stays/[stayId].tsx';
const PAGE_REL = 'pages/stay-detail/ui/StayDetailPage.tsx';
const BARREL_REL = 'pages/stay-detail/index.ts';
const SCREEN_REL = 'features/stay/ui/StayDetailScreen.tsx';
const SHEET_REL = 'features/stay/ui/OtaChoiceSheet.tsx';
const PRICE_SHEET_REL = 'features/stay/ui/StayPriceSheet.tsx';
const OUTBOUND_REL = 'features/stay/model/stayOutbound.ts';
const PRICE_FILTER_REL = 'features/stay/model/priceRangeFilter.ts';

const NEW_FILES = [
  ROUTE_REL,
  PAGE_REL,
  BARREL_REL,
  SCREEN_REL,
  SHEET_REL,
  PRICE_SHEET_REL,
  OUTBOUND_REL,
  PRICE_FILTER_REL,
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 구현 전에도 assertion diff 로 남긴다(ENOENT 예외 회피). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사', () => {
  it('주석은 걷히고 코드의 URL(://)·라우트 리터럴은 살아남는다', () => {
    const sample = [
      '// import { BottomTabBar } from ...; 주석 속 금칙어',
      "const href = 'https://www.google.com/search?q=x';",
      'export default function StayDetailRoute() { return null; }',
    ].join('\n');
    const stripped = stripComments(sample);

    expect(stripped).not.toContain('주석 속 금칙어');
    expect(stripped).toContain("const href = 'https://www.google.com/search");
    expect(stripped).toContain('StayDetailRoute');
  });
});

describe('G1 · 스캐폴딩 존재 (AC-1)', () => {
  it('신규 8파일이 정본 경로에 실재한다', () => {
    NEW_FILES.forEach((rel) => {
      expect({
        file: rel,
        exists: fs.existsSync(path.join(ROOT, rel)),
      }).toEqual({ file: rel, exists: true });
    });
  });
});

describe('G2 · 라우트 얇은 래퍼 (AC-1)', () => {
  it('stays/[stayId].tsx 가 페이지 배럴만 꽂고 조회·마크업·파싱을 안 만진다', () => {
    const source = readOne(ROUTE_REL);

    // 긍정 짝 — 실제로 페이지를 꽂는다.
    expect(source).toContain('@/pages/stay-detail');
    // 부정 — 라우트는 얇다(파싱·조회·목록은 페이지 몫).
    expect(source).not.toContain('FlatList');
    expect(source).not.toContain('useState');
    expect(source).not.toContain('JSON.parse');
  });
});

describe('G3 · 배럴', () => {
  it('pages/stay-detail/index.ts 가 StayDetailPage 를 재수출한다', () => {
    expect(readOne(BARREL_REL)).toContain('StayDetailPage');
  });
});

describe('G4 · 몰입 화면 = 탭바 없음 (AC-14 소스 절반)', () => {
  it('StayDetailScreen.tsx 에 BottomTabBar 가 없고, stay-detail-root 는 있다', () => {
    const source = readOne(SCREEN_REL);

    // 긍정 짝 — 실제로 그 화면을 읽고 있다(빈/미완 파일 공허 통과 방지).
    expect(source).toContain('stay-detail-root');
    // 부정 — affiliate-sheet 프레임의 BottomTab 을 복제하지 않는다.
    expect(source).not.toContain('BottomTabBar');
  });
});

describe('G5 · 페이지 배선 존재', () => {
  it('StayDetailPage 가 params 파싱과 저장 훅을 실제로 문다', () => {
    const source = readOne(PAGE_REL);

    expect(source).toContain('useLocalSearchParams');
    expect(source).toContain('JSON.parse');
    expect(source).toContain('useSavedStays');
  });
});
