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
 *  - 페이지가 params·저장 훅을 실제로 문다(공허 통과 방지 짝). TRIP-940 부터는 `item` param 을
 *    읽지도 파싱하지도 않는다(G5 재작성 — 데이터 출처는 `GET /stays/{stayId}` 하나).
 *  - 진입 4곳의 상세 push 는 `stayId` 하나만 싣고, e04 의 `toStayItem` 합성은 고아로 지워졌다(G7·G8).
 *  - 전화 열기(`tel:`)는 배선 층 몫이라 화면은 Linking 을 모른다(G9).
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

/**
 * G5 재작성(TRIP-940 AC-10 · 01b D0) — 구 계약은 "페이지가 `item` param 을 `JSON.parse` 한다"를
 * **요구**했다(손에 든 카드 데이터가 유일한 출처). 데이터 출처가 서버 조회 `GET /stays/{stayId}`
 * 하나로 바뀌어 이 요구를 뒤집는다 — 이제 파싱이 **없어야** 한다.
 */
describe('G5 · 페이지 배선 — item param 폐기 (TRIP-940 AC-10 · D0)', () => {
  it('StayDetailPage 가 params·저장 훅은 물되, item param 선언과 JSON.parse 가 0건이다', () => {
    const source = readOne(PAGE_REL);

    // 긍정 짝 — 파일을 실제로 읽었다(빈/미완 파일 공허 통과 방지).
    expect(source).toContain('useLocalSearchParams');
    expect(source).toContain('useSavedStays');
    // 부정 — 목록 값을 placeholder 로도 쓰지 않는다(사용자 확정 D0).
    expect(source).not.toContain('JSON.parse');
    // 부정 — `useLocalSearchParams<{ …; item?: string }>` 형태의 item param 선언이 사라졌다.
    expect(source).not.toMatch(/\bitem\??\s*:\s*string\b/);
  });
});

/**
 * G6 재작성(TRIP-778 AC-10 · D2) — 781 의 "페이지가 SecureStore 플래그(`@/shared/storage/flag`)를 딥 경로로
 * 문다"는 계약이, 저장처를 서버 `/me/settings` 로 옮기며(BR-U6-33 계정 단위 · 01b 사용자 결정) 뒤집혔다.
 * 이제 페이지는 기기 저장소를 읽지도 쓰지도 않고, 로컬 저장 모듈·키 상수는 고아로 지워진다.
 */
describe('G6 · "다시 보지 않기"는 서버 설정을 문다 — 기기 저장소 0 (TRIP-778 AC-10 · D2)', () => {
  it('페이지는 /me/settings 생성 훅을 물고, flag 모듈·키 상수를 모른다', () => {
    const page = readOne(PAGE_REL);

    // 긍정 짝 — 서버 설정 조회·변경 훅을 실제로 문다(D1 codegen 이름, 02a §2-5).
    expect(page).toContain('useGetMeSettings');
    expect(page).toContain('usePatchMeSettings');
    // 부정 — 기기 저장소 경로·함수·키가 페이지에서 사라졌다.
    expect(page).not.toContain('@/shared/storage/flag');
    expect(page).not.toContain('readFlag');
    expect(page).not.toContain('writeFlag');
    expect(page).not.toContain('AFFILIATE_NOTICE_DISMISSED_KEY');
  });

  it('고아 정리 — shared/storage/flag.ts 가 없고, 키 상수도 config 에서 빠졌다(라벨 사전은 남는다)', () => {
    const config = readOne('features/stay/config/affiliateNotice.ts');

    // 긍정 짝 — config 파일은 실제로 읽혔다(시트가 쓰는 라벨 사전이 남아 있다).
    expect(config).toContain('otaConfirmLabel');
    expect(config).not.toContain('AFFILIATE_NOTICE_DISMISSED_KEY');
    expect(fs.existsSync(path.join(ROOT, 'shared/storage/flag.ts'))).toBe(
      false
    );
  });

  it('시트는 여전히 저장을 모른다 — 저장소도 서버 설정 훅도 import 하지 않는다', () => {
    const sheet = readOne(SHEET_REL);

    // 긍정 짝 — 시트 파일을 실제로 읽었다.
    expect(sheet).toContain('stay-ota-sheet');
    expect(sheet).not.toContain('@/shared/storage');
    expect(sheet).not.toContain('MeSettings');
  });
});

// ── TRIP-940 · item param 폐기 — 진입 4곳 · 고아 정리 · 전화 열기 자리 ──────────────

/** 상세 라우트로 가는 객체형 push 의 `params: { … }` 본문을 모두 뽑는다. */
const DETAIL_PUSH =
  /pathname:\s*['"]\/stays\/\[stayId\]['"]\s*,\s*params:\s*\{([^}]*)\}/g;

function detailPushParams(source: string): string[] {
  return [...source.matchAll(DETAIL_PUSH)].map((match) => match[1].trim());
}

const ENTRY_RELS = [
  'app/(tabs)/explore.tsx',
  'pages/stay-saved/ui/SavedStayPage.tsx',
  'pages/destination-detail/ui/DestinationDetailPage.tsx',
  'pages/stay-search/ui/StaySearchPage.tsx',
];

describe('G7 · 진입 4곳은 stayId 만 싣는다 (TRIP-940 AC-10)', () => {
  it('자가검사 — 탐지기가 주석 제거 뒤에도 item 을 실은 push 와 stayId 만 실은 push 를 가른다', () => {
    const sample = stripComments(
      [
        '// router.push({ pathname: "/stays/[stayId]", params: { note } });',
        "router.push({ pathname: '/stays/[stayId]', params: { stayId: card.key, item: JSON.stringify(item) } });",
        "router.push({\n  pathname: '/stays/[stayId]',\n  params: { stayId },\n});",
      ].join('\n')
    );

    // 주석 속 push 는 걷히고(1번), 코드 속 두 push 는 둘 다 살아남아 잡힌다.
    expect(detailPushParams(sample)).toEqual([
      'stayId: card.key, item: JSON.stringify(item)',
      'stayId',
    ]);
  });

  it.each(ENTRY_RELS)(
    '%s 의 상세 push 는 전부 params 에 stayId 하나뿐이다',
    (rel) => {
      const blocks = detailPushParams(readOne(rel));

      // 긍정 짝 — 이 파일에 상세 push 가 실제로 있다(형태가 바뀌어 탐지기가 헛도는 것 차단).
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      // 단언 — 키가 stayId 하나(단축 `stayId` 또는 `stayId: 식`). item·JSON 동봉 금지.
      blocks.forEach((block) => {
        expect({ rel, block }).toEqual({
          rel,
          block: expect.stringMatching(/^stayId(\s*:\s*[^,]+)?,?$/),
        });
      });
    }
  );
});

describe('G8 · 고아 정리 — SavedStayPage 의 toStayItem 합성 (TRIP-940 AC-10)', () => {
  it('SavedStayPage.tsx 에 toStayItem 이 없다(상세가 더는 item 을 받지 않는다)', () => {
    const source = readOne('pages/stay-saved/ui/SavedStayPage.tsx');

    // 긍정 짝 — 파일을 실제로 읽었다.
    expect(source).toContain('/stays/[stayId]');
    expect(source).not.toContain('toStayItem');
  });
});

describe('G9 · 전화 열기는 배선 층 몫 (TRIP-940 AC-3 · FSD 경계)', () => {
  it('StayDetailScreen.tsx 는 Linking·tel: 을 모르고 콜백만 올린다', () => {
    const source = readOne(SCREEN_REL);

    // 긍정 짝 — 화면 파일을 실제로 읽었고, 전화 줄이 있다.
    expect(source).toContain('stay-detail-phone');
    expect(source).not.toContain('Linking');
    expect(source).not.toContain('tel:');
  });
});
