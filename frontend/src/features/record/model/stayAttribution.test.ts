import fc from 'fast-check';

import type {
  BaseAssignment,
  RegisterRoute,
  SavedStay,
  VisitCheck,
} from '@/shared/api/generated/schemas';

import { deriveStayAttribution, type DayAttribution } from './stayAttribution';

/**
 * TRIP-569 · US-REC-05 · BR-U5-25·26·27 — stayAttribution: 방문 기록을 등록 숙소·날짜에
 * 귀속하되 **저장하지 않고 조회 시점에 파생**한다.
 *
 * 무엇을 보장하나:
 *  - 그날을 덮는 base 가 있으면 그 방문들을 기준 숙소·날짜에 묶는다(AC-1).
 *  - 날짜마다 base 가 다르면 날짜별 기준 숙소로 구분한다(AC-2, 이동 숙박).
 *  - 어떤 base 도 안 덮는 날은 숙소 없이 날짜만으로 묶는다(AC-3, 당일치기·이동일).
 *  - 즉석 방문(slotKey==null)은 arrivedAt 날짜로 묶인다(AC-4).
 *  - 귀속은 저장되지 않는다 — 같은 visits 에 bases 만 바꿔 재파생하면 귀속이 따라 바뀐다(AC-5).
 *    반환 타입에 "저장된 귀속" 자리가 없다(구조봉쇄, visitStatus 의 status-필드-없음 동형).
 *  - 날짜 경계는 dateFrom 포함·dateTo 배제이고(AC-6), arrivedAt 에서 날짜를 뽑을 때 기기
 *    타임존으로 파싱하지 않아(new Date 금지) 자정 근처 방문이 안 밀린다.
 *
 * 순수 함수라 화면·서버·시계 없이 검증한다. 오라클(커버리지·epoch)은 이 파일이 **자체
 * 재구현**해 모델과 같은 버그를 공유하지 않는다.
 *
 * 3동작: 준비(팩토리로 visits·bases·savedStays 조립) → 실행(deriveStayAttribution 1회)
 *        → 단언(날짜별 그룹·baseStay).
 */

// ── 오라클(모델과 독립) ─────────────────────────────────────────────────────────
const MS_PER_DAY = 86_400_000;
/** 'YYYY-MM-DD' → 에포크 일수(UTC, 기기 TZ 무관). 모델 private 유틸을 import 하지 않는다. */
function epochDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}
/** base 가 날짜 D 를 덮나 — dateFrom ≤ D < dateTo(dateTo 배제). */
function covers(base: BaseAssignment, date: string): boolean {
  const d = epochDay(date);
  return epochDay(base.dateFrom) <= d && d < epochDay(base.dateTo);
}
function groupFor(groups: DayAttribution[], date: string): DayAttribution {
  const g = groups.find((x) => x.date === date);
  if (!g) throw new Error(`no group for ${date}`);
  return g;
}

// ── 팩토리 ─────────────────────────────────────────────────────────────────────
let seq = 0;
/** 계획 방문(slotKey = `${date}#poi`). override 로 slotKey/arrivedAt 등 교체. */
function visit(over: Partial<VisitCheck> = {}): VisitCheck {
  seq += 1;
  return {
    visitCheckId: `vc-${seq}`,
    slotKey: '2026-06-11#poi-1',
    poiId: 'poi-1',
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-06-11T09:00:00Z',
    ...over,
  };
}
/** 계획 방문 — 날짜만 지정(slotKey 를 그 날짜로 조립). */
function planned(date: string, over: Partial<VisitCheck> = {}): VisitCheck {
  return visit({ slotKey: `${date}#poi-1`, ...over });
}
/** 즉석 방문 — slotKey 없이 arrivedAt 만(BR-U5-27). */
function spontaneous(
  arrivedAt: string,
  over: Partial<VisitCheck> = {}
): VisitCheck {
  return visit({ slotKey: null, spontaneous: true, arrivedAt, ...over });
}
function base(
  savedStayId: string,
  dateFrom: string,
  dateTo: string,
  id = `ba-${savedStayId}`
): BaseAssignment {
  return { baseAssignmentId: id, savedStayId, dateFrom, dateTo };
}
function stay(savedStayId: string, name: string): SavedStay {
  return {
    savedStayId,
    name,
    coordConfirmed: true,
    registerRoute: 'MAP_SEARCH' as RegisterRoute,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

// ── AC-1 · 정상: 그날 base 있으면 숙소·날짜 귀속 ────────────────────────────────
describe('AC-1 · 그날 등록 숙소가 있으면 기준 숙소·날짜에 귀속해 묶는다', () => {
  it('06-11 방문 2개가 그날을 덮는 base(S1)·날짜로 묶이고 숙소명이 해소된다', () => {
    const visits = [
      planned('2026-06-11'),
      planned('2026-06-11', { poiId: 'poi-2' }),
    ];
    const bases = [base('S1', '2026-06-10', '2026-06-13')];

    const groups = deriveStayAttribution({
      visits,
      bases,
      savedStays: [stay('S1', '충무로 호텔')],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe('2026-06-11');
    expect(groups[0].baseStay?.savedStayId).toBe('S1');
    expect(groups[0].baseStay?.name).toBe('충무로 호텔');
    expect(groups[0].visits).toHaveLength(2);
  });

  it('숙소명을 못 찾아도(savedStays 생략) 귀속 자체는 살아남고 name 만 undefined', () => {
    const groups = deriveStayAttribution({
      visits: [planned('2026-06-11')],
      bases: [base('S1', '2026-06-10', '2026-06-13')],
    });

    expect(groups[0].baseStay).toBeDefined();
    expect(groups[0].baseStay?.savedStayId).toBe('S1');
    expect(groups[0].baseStay?.name).toBeUndefined();
  });
});

// ── AC-2 · 이동 숙박: 날짜별 기준 숙소 구분 ──────────────────────────────────────
describe('AC-2 · 날짜마다 base 가 다르면 날짜별 기준 숙소로 구분한다', () => {
  it('06-11→S1, 06-13→S2 로 갈린다(구간이 갈리는 이동 숙박)', () => {
    const groups = deriveStayAttribution({
      visits: [
        planned('2026-06-11'),
        planned('2026-06-13', { poiId: 'poi-9' }),
      ],
      bases: [
        base('S1', '2026-06-10', '2026-06-12'),
        base('S2', '2026-06-12', '2026-06-15'),
      ],
      savedStays: [stay('S1', '남포 호텔'), stay('S2', '해운대 호텔')],
    });

    expect(groups.map((g) => g.date)).toEqual(['2026-06-11', '2026-06-13']);
    expect(groupFor(groups, '2026-06-11').baseStay?.savedStayId).toBe('S1');
    expect(groupFor(groups, '2026-06-13').baseStay?.savedStayId).toBe('S2');
  });
});

// ── AC-3 · 숙소 없는 날: 날짜만 ─────────────────────────────────────────────────
describe('AC-3 · 어떤 base 도 그 날짜를 안 덮으면 숙소 없이 날짜만으로 묶는다', () => {
  it('06-20 당일치기 방문은 06-10..06-13 base 밖이라 baseStay 가 없다', () => {
    const groups = deriveStayAttribution({
      visits: [planned('2026-06-20')],
      bases: [base('S1', '2026-06-10', '2026-06-13')],
      savedStays: [stay('S1', '충무로 호텔')],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe('2026-06-20');
    expect(groups[0].baseStay).toBeUndefined();
    expect(groups[0].visits).toHaveLength(1);
  });
});

// ── AC-4 · 즉석 방문: arrivedAt 날짜로 묶음 ─────────────────────────────────────
describe('AC-4 · slotKey==null(즉석) 방문은 arrivedAt 날짜로 묶인다', () => {
  it('06-12 도착 즉석 방문이 06-12 그룹에 들어가고 그날 base 에 귀속된다', () => {
    const sp = spontaneous('2026-06-12T09:00:00Z');
    const groups = deriveStayAttribution({
      visits: [sp],
      bases: [base('S1', '2026-06-10', '2026-06-14')],
      savedStays: [stay('S1', '서면 호텔')],
    });

    const g = groupFor(groups, '2026-06-12');
    expect(g.visits.map((v) => v.visitCheckId)).toContain(sp.visitCheckId);
    expect(g.baseStay?.savedStayId).toBe('S1');
  });
});

// ── AC-5 · 미저장: bases 만 바꿔 재파생 → 귀속 변화 ──────────────────────────────
describe('AC-5 · 귀속은 저장되지 않는다 — bases 만 바꿔 재파생하면 따라 바뀐다', () => {
  it('같은 visits, base A/B/[] 세 벌로 재파생하면 baseStay 가 A→B→없음으로 따라간다', () => {
    const visits = [planned('2026-06-11')];

    const withA = deriveStayAttribution({
      visits,
      bases: [base('S1', '2026-06-10', '2026-06-13')],
    });
    const withB = deriveStayAttribution({
      visits,
      bases: [base('S2', '2026-06-10', '2026-06-13')],
    });
    const withNone = deriveStayAttribution({ visits, bases: [] });

    expect(withA[0].baseStay?.savedStayId).toBe('S1');
    expect(withB[0].baseStay?.savedStayId).toBe('S2');
    expect(withNone[0].baseStay).toBeUndefined();

    // 방문 자체는 세 번 다 동일 — "저장된 귀속" 자리가 없어 결과가 입력 bases 만의 함수다.
    const ids = (g: DayAttribution[]) => g[0].visits.map((v) => v.visitCheckId);
    expect(ids(withA)).toEqual(ids(withB));
    expect(ids(withB)).toEqual(ids(withNone));
  });

  it('PBT · 임의 bases 조합에서 귀속은 현재 bases 의 함수다(저장값 아님)', () => {
    const DATES = [
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ];
    const dateArb = fc.constantFrom(...DATES);

    // 계획/즉석 섞어 생성(둘 다 DATES 풀 안 날짜로 귀속되게).
    const visitArb = fc.oneof(
      dateArb.map((d) => planned(d)),
      dateArb.map((d) => spontaneous(`${d}T12:00:00Z`))
    );
    const basesArb = fc.array(
      fc.record({
        from: dateArb,
        to: dateArb,
        sid: fc.constantFrom('S1', 'S2', 'S3'),
      }),
      { maxLength: 4 }
    );

    fc.assert(
      fc.property(
        fc.array(visitArb, { minLength: 1, maxLength: 6 }),
        basesArb,
        (visits, rawBases) => {
          const bases = rawBases.map((b, i) =>
            base(b.sid, b.from, b.to, `ba-${i}`)
          );
          const groups = deriveStayAttribution({ visits, bases });

          for (const g of groups) {
            const covering = bases.filter((b) => covers(b, g.date));
            if (covering.length === 0) {
              expect(g.baseStay).toBeUndefined();
            } else {
              expect(g.baseStay).toBeDefined();
              // 겹침에 강건 — 택한 base 는 실제로 그 날짜를 덮는 것 중 하나여야 한다.
              expect(covering.map((b) => b.savedStayId)).toContain(
                g.baseStay?.savedStayId
              );
            }
          }

          // 숨은 기억 없음 — 같은 인자로 두 번 부르면 결과가 같다(순수·재파생 결정론).
          expect(deriveStayAttribution({ visits, bases })).toEqual(groups);
        }
      )
    );
  });
});

// ── AC-6 · 날짜 경계(dateFrom 포함·dateTo 배제) + 타임존 ─────────────────────────
describe('AC-6 · base 커버리지는 dateFrom 포함·dateTo 배제(체크아웃일은 안 잠)', () => {
  it('06-10(==dateFrom)·06-12(==dateTo-1) 은 덮이고 06-13(==dateTo) 은 안 덮인다', () => {
    const groups = deriveStayAttribution({
      visits: [
        planned('2026-06-10'),
        planned('2026-06-12', { poiId: 'poi-2' }),
        planned('2026-06-13', { poiId: 'poi-3' }),
      ],
      bases: [base('S1', '2026-06-10', '2026-06-13')],
      savedStays: [stay('S1', '충무로 호텔')],
    });

    expect(groupFor(groups, '2026-06-10').baseStay).toBeDefined();
    expect(groupFor(groups, '2026-06-12').baseStay).toBeDefined();
    // ★ 체크아웃일(D==dateTo)은 base 밖 → date-only.
    expect(groupFor(groups, '2026-06-13').baseStay).toBeUndefined();
  });
});

describe('AC-6 · 자정 근처 방문이 기기 타임존으로 밀리지 않는다(UTC epoch-day)', () => {
  it('00:30Z·23:30Z 즉석 방문이 둘 다 그 UTC 날짜(06-11) 그룹에 들어간다', () => {
    // new Date 로 파싱하면 동쪽 러너에선 23:30Z 가, 서쪽 러너에선 00:30Z 가 인접일로 샌다.
    const early = spontaneous('2026-06-11T00:30:00Z');
    const late = spontaneous('2026-06-11T23:30:00Z');

    const groups = deriveStayAttribution({ visits: [early, late], bases: [] });

    const g = groupFor(groups, '2026-06-11');
    const ids = g.visits.map((v) => v.visitCheckId);
    expect(ids).toContain(early.visitCheckId);
    expect(ids).toContain(late.visitCheckId);
  });
});
