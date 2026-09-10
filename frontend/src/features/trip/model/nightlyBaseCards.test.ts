import fc from 'fast-check';

import type { TripDestination } from '@/shared/api/generated/schemas';

import {
  nightlyBaseCards,
  type BaseSection,
  type NightlyBaseCard,
} from './baseSections';

/**
 * TRIP-672 · S8 g02 — `nightlyBaseCards`: 신 default 얼굴이 그릴 **박별(1박=1행) 거점 카드**를
 * 순수 계산으로 만든다(D1).
 *
 * 무엇을 보장하나 — 화면·배선이 알 필요 없는 세 파생을 이 함수 하나가 소유한다:
 *  1. **밤 목록·지역**은 `destinations`(seq 순서로 nights만큼 펼침)에서 온다 → 트립 전체 밤(옵션 A).
 *     배정이 하나도 없어도 카드는 Σnights 장이 뜬다(전부 "숙소 미정").
 *  2. **날짜 라벨**은 `startDate`부터 하루씩 더해 `"M/D(요일)"`로 만든다(예 `6/10(수)`).
 *  3. **숙소명**은 `sections`(toBaseSections 출력)를 **날짜로 조인**해 채운다 — 그 밤 날짜를 덮는
 *     배정이 있으면 그 이름, 없으면 `undefined`(→ 화면 "숙소 미정"). 날짜 조인이라 배정 공백에도
 *     밤과 숙소가 어긋나지 않는다.
 *
 * 출력 필드는 `{ nightNumber, dateLabel, region, stayName? }` **정확히 이 넷**(INV-3 — 소요시간·거리 없음).
 *
 * 커버하지 않는 것: 원 `toBaseSections`·`toNightlyBases`의 행위(각자 `baseSections.test.ts`·
 * `baseSections.nightly.test.ts`가 잠금 — D1 "원형 불변"). 이 파일은 새 export만 다룬다.
 *
 * 3동작: 준비(destinations·startDate·BaseSection 픽스처) → 실행(nightlyBaseCards 1회) → 단언(카드 배열).
 */

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** 한글 요일 한 글자. new Date 의 UTC 요일(0=일…6=토)과 인덱스가 짝이다. */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** BaseSection 픽스처(7필드 전부 — 계약이 바뀌면 여기서 컴파일이 깨진다). */
function section(over: Partial<BaseSection> = {}): BaseSection {
  return {
    baseAssignmentId: 'A1',
    savedStayId: 'S1',
    stayName: '해운대 오션 호텔',
    dateFrom: '2026-06-10',
    dateTo: '2026-06-12',
    nights: 2,
    nightLabel: '1–2박',
    ...over,
  };
}

function destination(
  seq: number,
  region: string,
  nights: number
): TripDestination {
  return { seq, region, nights };
}

// ── PBT 오라클 (구현과 다른 경로 — 오라클 독립) ──────────────────────────────────

/** 에포크 일수 → 'YYYY-MM-DD'. `toISOString`은 항상 UTC라 실행 머신 타임존이 표본을 안 민다. */
function toDateString(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * 기대 날짜 라벨을 **`new Date().getUTCDay()`**로 짠다 — 리포의 `dayOfWeek`를 재사용하지 않는다.
 * 오라클과 구현이 같은 요일 계산기를 공유하면 그 버그를 서로 못 잡는다(★9).
 */
function expectedDateLabel(epochDay: number): string {
  const d = new Date(epochDay * MS_PER_DAY);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}

interface GeneratedCards {
  destinations: TripDestination[];
  startDate: string;
  /** 구현과 독립적으로 짠 기대 카드(배정 없음 → stayName 전부 없음). */
  expected: NightlyBaseCard[];
  /** Σnights — 태스크 명시 불변식의 기대 행 수. */
  count: number;
}

/** 정수 파라미터로 기대 배열을 먼저 짜고 그걸 날짜 문자열로 바꿔 입력을 만든다. */
function buildCardsInput(
  startEpoch: number,
  destSpecs: number[]
): GeneratedCards {
  const destinations = destSpecs.map((nights, i) =>
    destination(i + 1, `지역${i}`, nights)
  );
  const expected: NightlyBaseCard[] = [];
  let running = 0;
  destinations.forEach((dest) => {
    for (let k = 0; k < dest.nights; k += 1) {
      expected.push({
        nightNumber: running + 1,
        dateLabel: expectedDateLabel(startEpoch + running),
        region: dest.region,
      });
      running += 1;
    }
  });
  return {
    destinations,
    startDate: toDateString(startEpoch),
    expected,
    count: running,
  };
}

const cardsInputArb = fc
  .record({
    startEpoch: fc.integer({ min: 20_400, max: 20_800 }),
    // 각 목적지의 nights(≥1) — 목록 길이가 곧 목적지 수. 구간별 region 이 갈리게 최소 1개.
    destSpecs: fc.array(fc.integer({ min: 1, max: 4 }), {
      minLength: 1,
      maxLength: 5,
    }),
  })
  .map(({ startEpoch, destSpecs }) => buildCardsInput(startEpoch, destSpecs));

/** 카드 필드 화이트리스트 — duration·거리 등 계약 밖 키가 새 나오면 잡는다(INV-3). */
const ALLOWED_KEYS = ['dateLabel', 'nightNumber', 'region', 'stayName'];

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('nightlyBaseCards — 박별 거점 카드 파생 (TRIP-672 · D1)', () => {
  it('단일 2박 목적지 + 그 2박을 덮는 배정 → 두 카드에 날짜·지역·숙소명이 채워진다', () => {
    // 준비 — 부산 2박, 6/10 체크인 배정(해운대).
    const destinations = [destination(1, '부산', 2)];
    const sections = [
      section({ dateFrom: '2026-06-10', dateTo: '2026-06-12', nights: 2 }),
    ];

    // 실행
    const cards = nightlyBaseCards({
      destinations,
      startDate: '2026-06-10',
      sections,
    });

    // 단언 — nightNumber 1·2, 요일은 실측값(수·목), region=부산, 숙소명 조인.
    expect(cards).toEqual([
      {
        nightNumber: 1,
        dateLabel: '6/10(수)',
        region: '부산',
        stayName: '해운대 오션 호텔',
      },
      {
        nightNumber: 2,
        dateLabel: '6/11(목)',
        region: '부산',
        stayName: '해운대 오션 호텔',
      },
    ]);
  });

  it('다구간 + 마지막 밤이 미배정이면 그 카드만 stayName 이 없다 (날짜 조인)', () => {
    // 준비 — 부산 2박 + 경주 1박(=3밤). 배정은 앞 2박만 덮는다.
    const destinations = [destination(1, '부산', 2), destination(2, '경주', 1)];
    const sections = [
      section({ dateFrom: '2026-06-10', dateTo: '2026-06-12', nights: 2 }),
    ];

    // 실행
    const cards = nightlyBaseCards({
      destinations,
      startDate: '2026-06-10',
      sections,
    });

    // 단언 — 3행: 부산 2박은 숙소명, 경주 1박(6/12)은 미배정.
    expect(cards).toEqual([
      {
        nightNumber: 1,
        dateLabel: '6/10(수)',
        region: '부산',
        stayName: '해운대 오션 호텔',
      },
      {
        nightNumber: 2,
        dateLabel: '6/11(목)',
        region: '부산',
        stayName: '해운대 오션 호텔',
      },
      // stayName 키가 아예 없다(미배정) — toEqual 은 생략 키와 undefined 를 같게 본다.
      { nightNumber: 3, dateLabel: '6/12(금)', region: '경주' },
    ]);
    // 미배정 밤은 undefined 여야 한다(화면이 "숙소 미정"으로 그리는 근거).
    expect(cards[2].stayName).toBeUndefined();
  });

  it('배정이 하나도 없어도 밤 수만큼 카드가 뜨고 전부 미배정이다 (옵션 A)', () => {
    // 준비 — 목적지는 있고 배정은 0.
    const destinations = [destination(1, '부산', 2), destination(2, '경주', 1)];

    // 실행
    const cards = nightlyBaseCards({
      destinations,
      startDate: '2026-06-10',
      sections: [],
    });

    // 단언 — 3행 전부 지역만 있고 숙소명은 없다.
    expect(cards).toHaveLength(3);
    cards.forEach((card) => expect(card.stayName).toBeUndefined());
    expect(cards.map((c) => c.region)).toEqual(['부산', '부산', '경주']);
  });

  it('dateLabel 요일이 실제 달력값이다 — 6/13 은 토요일 (손베낌 아님, 실측)', () => {
    const cards = nightlyBaseCards({
      destinations: [destination(1, '부산', 1)],
      startDate: '2026-06-13',
      sections: [],
    });

    expect(cards[0].dateLabel).toBe('6/13(토)');
  });

  it('각 카드의 키가 화이트리스트 안이다 — duration·거리 필드가 새 나오지 않는다 (INV-3)', () => {
    // 배정 있는 밤과 미배정 밤을 한 번에 태워 두 갈래를 함께 본다.
    const cards = nightlyBaseCards({
      destinations: [destination(1, '부산', 2)],
      startDate: '2026-06-10',
      sections: [
        section({ dateFrom: '2026-06-10', dateTo: '2026-06-11', nights: 1 }),
      ],
    });

    cards.forEach((card) => {
      // 필수 3필드는 반드시 있다.
      expect(card).toHaveProperty('nightNumber');
      expect(card).toHaveProperty('dateLabel');
      expect(card).toHaveProperty('region');
      // 계약 밖 키(duration·distance 등)가 없다.
      Object.keys(card).forEach((key) => expect(ALLOWED_KEYS).toContain(key));
    });
  });

  it('목적지가 없으면 빈 배열이다', () => {
    expect(
      nightlyBaseCards({
        destinations: [],
        startDate: '2026-06-10',
        sections: [],
      })
    ).toHaveLength(0);
  });

  it('행 수 = Σnights · 날짜 오름차순 · 구간별 region · 통번호 1..N (PBT)', () => {
    fc.assert(
      fc.property(
        cardsInputArb,
        ({ destinations, startDate, expected, count }) => {
          // 실행 — 배정 없음(sections=[])이라 stayName 은 전부 없다.
          const cards = nightlyBaseCards({
            destinations,
            startDate,
            sections: [],
          });

          // L1 — 행수·라벨·지역·통번호를 한꺼번에 잠근다(기대는 new Date 로 짠 독립 오라클).
          //      dateLabel 이 startDate+i 로 정확히 증가하므로 "날짜 오름차순"도 이 등식이 담보한다.
          expect(cards).toEqual(expected);

          // L2 — 태스크 명시 불변식 ①: 행 수 = Σnights.
          expect(cards).toHaveLength(count);

          // L3 — 통번호는 방출 순서대로 1..N.
          cards.forEach((card, i) => expect(card.nightNumber).toBe(i + 1));

          // L4 — 미배정(sections=[])이므로 stayName 은 전부 undefined.
          cards.forEach((card) => expect(card.stayName).toBeUndefined());
        }
      ),
      { numRuns: 300 }
    );
  });
});
