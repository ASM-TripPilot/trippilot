import fc from 'fast-check';

import type { TripDestination } from '@/shared/api/index.schemas';

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
 *     배정이 하나도 없어도 카드는 밤 수만큼 뜬다(전부 "숙소 미정").
 *  2. **날짜 라벨**은 `startDate`부터 하루씩 더해 `"M/D(요일)"`로 만든다(예 `6/10(수)`).
 *  3. **숙소명**은 `sections`(toBaseSections 출력)를 **날짜로 조인**해 채운다 — 그 밤 날짜를 덮는
 *     배정이 있으면 그 이름, 없으면 `undefined`(→ 화면 "숙소 미정"). 날짜 조인이라 배정 공백에도
 *     밤과 숙소가 어긋나지 않는다.
 *
 * TRIP-1010(D7)로 **밤 수의 기준이 바뀌었다**: 종료일(`endDate`)이 있으면 카드 수 = 여행 기간
 * (`endDate − startDate`)이다. 박수 합(Σnights)으로 다 못 덮은 밤은 **seq가 가장 큰 여행지**로 채운다.
 * 종료일이 없거나 읽을 수 없으면 옛 규칙(카드 수 = Σnights)으로 돌아간다(01b Q4). 옛 PBT
 * "행 수 = Σnights"는 이 결정과 정면으로 반대라 재작성했다 — 폴백 경로의 성질로만 남는다.
 *
 * 출력 필드는 `{ nightNumber, dateLabel, region, stayName? }` **정확히 이 넷**(INV-3 — 소요시간·거리 없음).
 *
 * 커버하지 않는 것: 원 `toBaseSections`·`toNightlyBases`의 행위(각자 `baseSections.test.ts`·
 * `baseSections.nightly.test.ts`가 잠금 — D1 "원형 불변"). Σnights > 기간(1/4가 막는 상태)의 카드
 * 수는 계약 밖이라 재지 않는다.
 *
 * 3동작: 준비(destinations·startDate·endDate·BaseSection 픽스처) → 실행(nightlyBaseCards 1회) → 단언.
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
  /** 입력 배열 — seq 와 무관한 순서로 섞여 있다(★2: "마지막"은 배열 끝이 아니라 seq 최대). */
  destinations: TripDestination[];
  startDate: string;
  /** startDate + (Σnights + 남는 밤). 기간을 먼저 정하고 날짜를 거꾸로 만든다(★3). */
  endDate: string;
  /** 기간 기준 기대 밤 목록(구현과 독립적으로 짠 오라클). */
  expectedByPeriod: ExpectedNight[];
  /** 종료일 생략(폴백) 기준 기대 밤 목록 — Σnights 개. */
  expectedBySum: ExpectedNight[];
}

interface ExpectedNight {
  nightNumber: number;
  dateLabel: string;
  region: string;
}

/**
 * 정수 파라미터로 기대 밤 목록을 먼저 짜고, 그걸 날짜 문자열로 바꿔 입력을 만든다.
 * `order` 는 destSpecs 인덱스의 순열 — 입력 배열을 그 순서로 섞는다(seq 는 원 인덱스 + 1).
 */
function buildCardsInput(
  startEpoch: number,
  destSpecs: number[],
  extraNights: number,
  order: number[]
): GeneratedCards {
  // seq 순서(= destSpecs 순서)로 펼친 지역 타임라인.
  const regionsBySeq: string[] = [];
  destSpecs.forEach((nights, i) => {
    for (let k = 0; k < nights; k += 1) regionsBySeq.push(`지역${i}`);
  });
  const sum = regionsBySeq.length;
  const lastRegion = `지역${destSpecs.length - 1}`;
  const period = sum + extraNights;

  const night = (index: number, region: string): ExpectedNight => ({
    nightNumber: index + 1,
    dateLabel: expectedDateLabel(startEpoch + index),
    region,
  });

  const expectedBySum = regionsBySeq.map((region, i) => night(i, region));
  const expectedByPeriod = Array.from({ length: period }, (_, i) =>
    night(i, i < sum ? regionsBySeq[i] : lastRegion)
  );

  return {
    destinations: order.map((i) =>
      destination(i + 1, `지역${i}`, destSpecs[i])
    ),
    startDate: toDateString(startEpoch),
    endDate: toDateString(startEpoch + period),
    expectedByPeriod,
    expectedBySum,
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
    // 박수 합으로 못 덮은 밤 수(0 = 합 = 기간).
    extraNights: fc.integer({ min: 0, max: 6 }),
  })
  .chain(({ startEpoch, destSpecs, extraNights }) => {
    const indices = destSpecs.map((_, i) => i);
    return fc
      .shuffledSubarray(indices, {
        minLength: indices.length,
        maxLength: indices.length,
      })
      .map((order) =>
        buildCardsInput(startEpoch, destSpecs, extraNights, order)
      );
  });

/** 카드 한 장을 필드 하나씩 비교한다 — 객체 통째 `toEqual` 은 `stayName: undefined` 누수를
 * 못 잡는다(★4). 키 집합은 화이트리스트로 따로 본다. */
function expectNight(card: NightlyBaseCard, expected: ExpectedNight): void {
  expect(card.nightNumber).toBe(expected.nightNumber);
  expect(card.dateLabel).toBe(expected.dateLabel);
  expect(card.region).toBe(expected.region);
  expect(card.stayName).toBeUndefined();
  Object.keys(card).forEach((key) => expect(ALLOWED_KEYS).toContain(key));
}

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

  it('목적지가 없으면 종료일이 있어도 빈 배열이다 (AC-6 · 딥링크 경로)', () => {
    expect(
      nightlyBaseCards({
        destinations: [],
        startDate: '2026-06-10',
        endDate: '2026-06-13',
        sections: [],
      })
    ).toHaveLength(0);
  });
});

describe('TRIP-1010 · 카드 수 = 여행 기간, 남은 밤은 마지막 여행지 (D7 · AC-3·4·5)', () => {
  it('서울 1박인데 기간이 2박(9/26–9/28)이면 카드는 2장이고 둘 다 서울이다 (QA #032 재현)', () => {
    // 준비 — 박수(1)가 기간(2)보다 적다. 옛 규칙이면 카드 1장 → 9/27 밤이 사라진다.
    const destinations = [destination(1, '서울특별시', 1)];

    // 실행
    const cards = nightlyBaseCards({
      destinations,
      startDate: '2026-09-26',
      endDate: '2026-09-28',
      sections: [],
    });

    // 단언 — 2장, 날짜는 실제 달력(토·일), 채운 밤도 서울.
    expect(cards).toHaveLength(2);
    expect(cards[0].nightNumber).toBe(1);
    expect(cards[0].dateLabel).toBe('9/26(토)');
    expect(cards[0].region).toBe('서울특별시');
    expect(cards[1].nightNumber).toBe(2);
    expect(cards[1].dateLabel).toBe('9/27(일)');
    expect(cards[1].region).toBe('서울특별시');
  });

  it('부산1·경주1 인데 기간이 3박이면 지역은 부산·경주·경주다 (남은 밤 = 마지막 여행지)', () => {
    const cards = nightlyBaseCards({
      destinations: [destination(1, '부산', 1), destination(2, '경주', 1)],
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      sections: [],
    });

    expect(cards.map((card) => card.region)).toEqual(['부산', '경주', '경주']);
  });

  it('"마지막 여행지"는 배열의 끝이 아니라 seq 가 가장 큰 곳이다', () => {
    // 준비 — 배열 순서를 뒤집어 넣는다: 배열 끝은 부산(seq1), seq 최대는 경주(seq2).
    const cards = nightlyBaseCards({
      destinations: [destination(2, '경주', 1), destination(1, '부산', 1)],
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      sections: [],
    });

    expect(cards.map((card) => card.region)).toEqual(['부산', '경주', '경주']);
  });

  it('채운 밤도 날짜 조인으로 숙소명이 붙는다 (지정한 숙소가 그 밤을 덮으면)', () => {
    // 준비 — 서울 1박, 기간 2박. 배정은 채운 밤(6/11) 하나만 덮는다.
    const cards = nightlyBaseCards({
      destinations: [destination(1, '서울특별시', 1)],
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      sections: [
        section({
          stayName: '종로 한옥 스테이',
          dateFrom: '2026-06-11',
          dateTo: '2026-06-12',
          nights: 1,
        }),
      ],
    });

    expect(cards).toHaveLength(2);
    expect(cards[0].stayName).toBeUndefined();
    expect(cards[1].stayName).toBe('종로 한옥 스테이');
  });

  it.each([
    ['없음(undefined)', undefined],
    ['빈 문자열', ''],
    ['판독 불가', 'not-a-date'],
  ])(
    '종료일이 %s 이면 옛 규칙(카드 수 = 박수 합)으로 돌아간다 — 카드가 통째로 사라지지 않는다 (Q4)',
    (_label, endDate) => {
      // 준비 — 부산2·경주1(Σ=3). 판독 불가 날짜가 NaN 이 되면 반복이 0번 돌아 카드가 전부 사라진다(★5).
      const cards = nightlyBaseCards({
        destinations: [destination(1, '부산', 2), destination(2, '경주', 1)],
        startDate: '2026-06-10',
        endDate,
        sections: [],
      });

      expect(cards).toHaveLength(3);
      expect(cards[2].region).toBe('경주');
    }
  );

  it('PBT · 카드 수 = 기간 · 앞 Σnights 장은 seq 순 펼침 · 나머지는 마지막 여행지 · 통번호 1..기간 · 키 4개', () => {
    fc.assert(
      fc.property(
        cardsInputArb,
        ({ destinations, startDate, endDate, expectedByPeriod }) => {
          // 실행 — 배정 없음(sections=[])이라 stayName 은 전부 없다.
          const cards = nightlyBaseCards({
            destinations,
            startDate,
            endDate,
            sections: [],
          });

          // ① 카드 수 = 기간(박). 오라클은 Σ + 남는 밤으로 기간을 먼저 정했다(★3).
          expect(cards).toHaveLength(expectedByPeriod.length);
          // ②③④⑤ 카드마다 번호·날짜 라벨·지역·키 화이트리스트를 하나씩 본다(★4).
          cards.forEach((card, i) => expectNight(card, expectedByPeriod[i]));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('PBT · 종료일을 안 주면 카드 수 = 박수 합(폴백) · seq 순 펼침 · 통번호 1..Σ', () => {
    fc.assert(
      fc.property(
        cardsInputArb,
        ({ destinations, startDate, expectedBySum }) => {
          const cards = nightlyBaseCards({
            destinations,
            startDate,
            sections: [],
          });

          expect(cards).toHaveLength(expectedBySum.length);
          cards.forEach((card, i) => expectNight(card, expectedBySum[i]));
        }
      ),
      { numRuns: 300 }
    );
  });
});
