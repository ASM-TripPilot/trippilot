/**
 * @jest-environment node
 */
// TRIP-807 · AC-5·6·7 + 타입(AC-1) — 소비처가 entities/stay 로 전환됐고 로컬 중복 구현이 사라졌음을
// 소스 스캔으로 잠근다. 806 entities/place 동형.
//
// ⚠️ 회귀(보이는 testID·글자 바이트 보존)의 1차 그물은 **무수정 소비처 테스트**다(02a ★8) — 이 스캔은
//    "전환됐다"의 보조 그물이다. 긍정(=entities import)은 전 소비처에 강제하고, 부정(=로컬 정의 제거)은
//    지문이 확실한 곳만(과하게 특정하면 implementer 설계를 박제 = 게이밍, 02a §7). 완전한 orphan 제거는
//    `structure --check`(qa 명령 점검, AC-11)가 겸한다.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`소비처 파일이 없다: ${rel}`);
  }
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사', () => {
  it('주석 속 import 는 걷히고 코드 import·URL 은 살아남는다', () => {
    const sample = [
      "// import { StaySearchCard } from '@/entities/stay/ui/StaySearchCard';",
      "import { SavedStayCard } from '@/entities/stay/ui/SavedStayCard';",
      "const u = 'https://x/a//b';",
    ].join('\n');
    const s = stripComments(sample);
    // 주석 줄 import 는 걷히고, 코드 줄만 남는다.
    expect(s).not.toContain('StaySearchCard');
    expect(s).toContain('@/entities/stay/ui/SavedStayCard');
    expect(/https?:\/\//.test(s)).toBe(true);
  });
});

/**
 * 소비처 전환 표 — [파일, 긍정(전부 포함해야 함), 부정(포함하면 안 됨)?].
 * 긍정: entities/stay 를 참조한다(전환의 직접 증거). 부정: 로컬 중복의 확실한 지문(제거돼야 함).
 * `must` 는 배열 — 한 파일이 ui·lib·model 여럿을 물면 전부 존재를 요구한다(★3 — save/글리프 testID 는
 * 소비처가 명시 문자열로 조립·주입하므로 선재 소스 앵커도 그 리터럴로 함께 잠긴다).
 */
type Row = { file: string; must: string[]; mustNot?: string[]; why: string };

const ROWS: Row[] = [
  {
    file: 'features/stay/ui/StaySearchScreen.tsx',
    must: ['@/entities/stay/ui', '@/entities/stay/lib'],
    mustNot: ['function StayCard('],
    why: 'e02 검색 카드 + formatPrice 소비(로컬 StayCard 제거)',
  },
  {
    file: 'features/stay/ui/SavedStayListScreen.tsx',
    must: ['@/entities/stay/ui', '@/entities/stay/model'],
    mustNot: ['function SavedStayCard(', 'export interface SavedStayCardVM'],
    why: 'e04 degrade 카드 + SavedStayCardVM 이관(재수출로 기존 import 보존)',
  },
  {
    file: 'features/explore/ui/ExploreLandingScreen.tsx',
    must: ['@/entities/stay/ui', '@/entities/stay/model'],
    mustNot: ['function StayCard(', 'export interface StayCardVM'],
    why: 'd01 검색 레인 카드 + StayCardVM 이관(★11 — export 잔존은 진짜 이동 아님)',
  },
  {
    file: 'features/explore/ui/DestinationDetailScreen.tsx',
    must: ['@/entities/stay/ui'],
    mustNot: ['function StayCard('],
    why: 'd05 레인 카드 소비(StayCardVM 은 ./ExploreLandingScreen 재수출 경유, ★11)',
  },
  {
    file: 'features/trip/ui/StaySelectSheet.tsx',
    must: ['@/entities/stay/ui'],
    mustNot: ['function CandidateCard('],
    why: 'g02 후보 카드를 entities degrade 카드로 위임(★16 — 시트 크롬·trip-base-staysheet-cand 는 무수정 테스트가 별도로 잼)',
  },
  {
    file: 'features/stay/ui/StayDetailScreen.tsx',
    must: ['@/entities/stay/lib'],
    why: 'e03 formatPrice 를 entities 로 흡수(shim 재수출로 무수정 green)',
  },
  {
    file: 'features/stay/ui/OtaChoiceSheet.tsx',
    must: ['@/entities/stay/lib'],
    why: 'formatPrice 소비 전환',
  },
  {
    file: 'app/(tabs)/explore.tsx',
    must: ['@/entities/stay/lib'],
    why: 'd01 라우트 formatPrice 조립(★15 — src/app 이라 6-b 발동)',
  },
  {
    file: 'pages/destination-detail/ui/DestinationDetailPage.tsx',
    must: ['@/entities/stay/lib'],
    why: 'd05 페이지 priceText 조립(formatPrice)',
  },
  {
    file: 'features/explore/ui/SavedPlaceListScreen.tsx',
    must: ['@/entities/stay/model'],
    mustNot: ['export interface StayRowVM'],
    why: 'd02 StayRowVM(SavedStayCardVM 과 동일 shape) → entities 타입 재수출(타입만, 화면 재구성 없음)',
  },
];

describe('🔴 소비처가 entities/stay 를 소비한다(긍정) + 확실한 중복 지문 제거(부정)', () => {
  it.each(ROWS)('$file — $why', ({ file, must, mustNot }) => {
    const source = read(file);

    // 긍정 — 전환의 직접 증거(전부 존재).
    for (const marker of must) {
      expect(source).toContain(marker);
    }

    // 부정 — 지문이 확실한 로컬 중복만.
    for (const marker of mustNot ?? []) {
      expect(source).not.toContain(marker);
    }
  });
});

describe('🔴 삭제된 formatPrice shim 은 되살아나지 않는다 (파일 부재)', () => {
  // TRIP-810 — formatPrice 본체는 807 에 entities/stay/lib 로 이관됐고 옛 자리는 재수출 shim 이었다.
  // 810 이 그 shim 파일을 삭제한다(소비처·테스트는 @/entities/stay/lib 로 재조준). shim 이 되살아나면 red.
  it('features/stay/model/formatPrice.ts 는 삭제됐다', () => {
    expect(
      fs.existsSync(path.join(ROOT, 'features/stay/model/formatPrice.ts'))
    ).toBe(false);
  });
});
