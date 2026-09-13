/**
 * @jest-environment node
 */
// TRIP-808 · AC-6·7·8·9 + 타입(AC-1) — 소비처가 entities/trip 로 전환됐고 로컬 중복 구현이 사라졌음을
// 소스 스캔으로 잠근다. 806 place·807 stay 동형.
//
// ⚠️ 회귀(보이는 testID·글자 바이트 보존)의 1차 그물은 **무수정 소비처 테스트**다(02a ★9) — 이 스캔은
//    "전환됐다"의 보조 그물이다. 긍정(=entities import)은 전 소비처에 강제하고, 부정(=로컬 정의 제거)은
//    지문이 확실한 곳만(과하게 특정하면 implementer 설계를 박제 = 게이밍). 완전한 orphan 제거는
//    `structure --check`(qa 명령 점검, AC-12)가 겸한다.
//
// 이 티켓의 핵심은 "카드"가 아니라 "포맷터"다 — 기간 6벌·박수 3벌·요일 1벌이 여러 feature 에 흩어져
// 재구현돼 있어(출력이 서로 달라 병합 불가·바이트 보존 이관), 이관 후 옛 자리는 한 줄 재수출 shim 이 된다.
// 그래서 부정 지문은 `export function <함수>`(로컬 정의) 소멸이다 — 재수출(`export {..} from`)로 바뀌면
// 이 정규식이 안 걸려 "정말 이사했다"의 증거가 된다.
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
  it('주석 속 import·정의는 걷히고 코드·URL 은 살아남는다', () => {
    const sample = [
      "// import { TripCard } from '@/entities/trip/ui/TripCard';",
      "import { PastTripRow } from '@/entities/trip/ui/PastTripRow';",
      '// export function formatTripRange() {}',
      'export function nightsLabel() {}',
      "const u = 'https://x/a//b';",
    ].join('\n');
    const s = stripComments(sample);
    // 주석 줄 import·정의는 걷히고, 코드 줄만 남는다.
    expect(s).not.toContain('TripCard');
    expect(s).not.toContain('export function formatTripRange');
    expect(s).toContain('@/entities/trip/ui/PastTripRow');
    expect(s).toContain('export function nightsLabel');
    expect(/https?:\/\//.test(s)).toBe(true);
  });
});

/**
 * 소비처 전환 표 — [파일, 긍정(전부 포함해야 함), 부정(포함하면 안 됨)?].
 * 긍정: entities/trip 를 참조한다(전환의 직접 증거). 부정: 로컬 중복의 확실한 지문(제거돼야 함 —
 * 이관은 재수출 shim 이라 `export function X` 로컬 정의가 사라진다).
 */
type Row = { file: string; must: string[]; mustNot?: string[]; why: string };

const ROWS: Row[] = [
  {
    file: 'features/itinerary/ui/MyTripCard.tsx',
    must: ['@/entities/trip/ui', '@/entities/trip/model'],
    mustNot: ['export interface MyTripCardVM'],
    why: 'h06 카드를 entities TripCard 로 위임 + MyTripCardVM·MyTripBadge 타입 재수출(로컬 interface 제거)',
  },
  {
    file: 'features/record/model/recordsCalendar.ts',
    must: ['@/entities/trip/lib', '@/entities/trip/model'],
    mustNot: [
      'export interface PastTripCardVM',
      'export function formatTripDateRange',
      'export function nightsLabel',
    ],
    why: 'formatTripDateRange·nightsLabel 이관(shim 재수출) + PastTripCardVM 타입 재수출. buildPastTripCards 는 존치(호출자)',
  },
  {
    file: 'features/record/ui/PastTripList.tsx',
    must: ['@/entities/trip/ui'],
    why: 'j07 행을 entities PastTripRow 로 위임 + chevron trailing 주입(record-calendar-past-trip 리터럴은 여기 잔존 → recordsCalendarStructure G3 무재조준)',
  },
  {
    file: 'features/trip/model/baseScreen.ts',
    must: ['@/entities/trip/lib'],
    mustNot: [
      'export function formatSectionRange',
      'export function formatTripRange',
    ],
    why: 'formatSectionRange·formatTripRange 이관(shim). unresolvedDaysView·monthDay 는 존치',
  },
  {
    file: 'features/itinerary/model/planState.ts',
    must: ['@/entities/trip/lib'],
    mustNot: [
      'export function formatNightsLabel',
      'export function formatConfirmedDateRange',
    ],
    why: 'formatNightsLabel·formatConfirmedDateRange 이관(shim). resolvePlanState·resolveItineraryDestination 등은 존치',
  },
  {
    file: 'features/trip/model/tripWizardStep1.ts',
    must: ['@/entities/trip/lib'],
    mustNot: ['export function formatDateRange', 'export function dayOfWeek'],
    why: 'formatDateRange·dayOfWeek 이관(shim). presetRange·deriveEndDate·fromEpochDay(위저드 업무규칙)는 존치 — presetRange 가 이관된 dayOfWeek 를 import 해 씀',
  },
  {
    file: 'features/trip/model/tripSummary.ts',
    must: ['@/entities/trip/lib'],
    mustNot: ['function formatDateRangeWithDow'],
    why: 'formatDateRangeWithDow 를 entities 로 export 승격·이관. summaryPeriod 는 존치하되 entities 에서 import(출력 무변경)',
  },
  {
    file: 'app/(tabs)/index.tsx',
    must: ['@/entities/trip/lib'],
    why: '홈 라우트 formatTripMeta 조립이 formatTripRange·formatNightsLabel 을 entities 에서 직접 import(★ src/app 이라 6-b 발동, 01b 결정 #3). 이 스캔은 파일을 읽기만 한다(렌더·수정 아님)',
  },
];

describe('🔴 소비처가 entities/trip 를 소비한다(긍정) + 확실한 중복 지문 제거(부정)', () => {
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
