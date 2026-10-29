import fc from 'fast-check';

import type { MapCenter, MapPin, MapPinKind } from './MapView';
import { buildPathLines } from './pathLines';

/**
 * TRIP-1652 (W6) — 경로선 규칙 순수 함수 `buildPathLines`. 네이티브 `MapView` 와 웹 컨트롤러가 같이 쓰는 한 곳.
 * AC-1(연결선 좌표)·AC-2(끄기·핀 부족)·AC-3(실제 경로 세그먼트·계획선 흐림)·AC-12(규칙 보존).
 *
 * 초심자용 — 이 함수는 핀 목록과 옵션을 받아 "무엇을 어떤 좌표로 그릴지"만 돌려준다(지도 호출 없음).
 *   준비=핀·옵션 → 실행=buildPathLines → 단언=돌려준 좌표 열·개수·플래그. 입력은 {lat,lng} 순서다.
 * PBT(fast-check): 예시 몇 개가 못 잡는 "아무 데나 끼어든 비연결 핀이 선을 바꾸는가"를 임의 입력으로 본다.
 */

const pin = (number: number, lat: number, kind?: MapPinKind): MapPin => ({
  number,
  lat,
  lng: 126 + number / 100,
  ...(kind === undefined ? {} : { kind }),
});
const at = (p: MapPin): MapCenter => ({ lat: p.lat, lng: p.lng });

describe('buildPathLines — 연결선(plan)', () => {
  it('PL1 visited·무-kind 핀만 배열 순서대로 잇고 planned·stay·candidate 는 선 밖이다', () => {
    const pins = Object.freeze([
      pin(1, 33.1, 'visited'),
      pin(2, 33.2, 'planned'),
      pin(3, 33.3),
      pin(4, 33.4, 'stay'),
      pin(5, 33.5, 'candidate'),
      pin(6, 33.6, 'visited'),
    ]);

    const lines = buildPathLines({ pins });

    expect(lines.plan).toEqual([at(pins[0]), at(pins[2]), at(pins[5])]);
    // 입력을 건드리지 않았다(frozen 이라 건드렸다면 던졌겠지만, 길이도 한 번 더 본다).
    expect(pins).toHaveLength(6);
  });

  it('PL2 connectPins:false 면 선이 없다 — 미전달은 켜짐', () => {
    const pins = [pin(1, 33.1), pin(2, 33.2)];

    expect(buildPathLines({ pins, connectPins: false }).plan).toBeNull();
    expect(buildPathLines({ pins, connectPins: true }).plan).toHaveLength(2);
    expect(buildPathLines({ pins }).plan).toHaveLength(2);
  });

  it('PL3 연결 대상 핀이 2개 미만이면 선이 없다(전체 핀이 많아도)', () => {
    expect(buildPathLines({ pins: [pin(1, 33.1)] }).plan).toBeNull();
    expect(buildPathLines({ pins: [] }).plan).toBeNull();
    expect(buildPathLines({}).plan).toBeNull();
    // 핀은 3개지만 잇는 핀은 visited 하나뿐.
    const mixed = [
      pin(1, 33.1, 'visited'),
      pin(2, 33.2, 'planned'),
      pin(3, 33.3, 'stay'),
    ];
    expect(buildPathLines({ pins: mixed }).plan).toBeNull();
  });
});

describe('buildPathLines — 실제 경로(segments)·계획선 흐림', () => {
  const SEG_A: MapCenter[] = [
    { lat: 37.57, lng: 126.98 },
    { lat: 37.571, lng: 126.981 },
  ];
  const SEG_B: MapCenter[] = [
    { lat: 37.578, lng: 126.988 },
    { lat: 37.58, lng: 126.99 },
    { lat: 37.581, lng: 126.991 },
  ];

  it('PL4 점이 2개 이상인 세그먼트만, 서로 잇지 않고 순서·내용 그대로 돌려주며 계획선은 흐려진다', () => {
    const lines = buildPathLines({
      pins: [pin(1, 33.1), pin(2, 33.2)],
      actualRoute: [SEG_A, [{ lat: 1, lng: 1 }], SEG_B],
    });

    expect(lines.segments).toEqual([SEG_A, SEG_B]);
    expect(lines.planDimmed).toBe(true);
    // 계획선 좌표 자체는 그대로 있다(흐리게만 그린다).
    expect(lines.plan).toHaveLength(2);
  });

  it('PL5 미전달·빈 배열·전부 점 1개짜리면 세그먼트 0, 계획선은 흐려지지 않는다', () => {
    const pins = [pin(1, 33.1), pin(2, 33.2)];
    for (const actualRoute of [
      undefined,
      [],
      [[{ lat: 1, lng: 1 }]],
      [[], []],
    ]) {
      const lines = buildPathLines({ pins, actualRoute });
      expect(lines.segments).toEqual([]);
      expect(lines.planDimmed).toBe(false);
    }
  });

  it('PL6 연결선을 끄거나 핀이 모자라도 실제 경로는 그대로 돌려준다', () => {
    const off = buildPathLines({
      pins: [pin(1, 33.1), pin(2, 33.2)],
      connectPins: false,
      actualRoute: [SEG_A],
    });
    const few = buildPathLines({ pins: [pin(1, 33.1)], actualRoute: [SEG_B] });

    expect(off.plan).toBeNull();
    expect(off.segments).toEqual([SEG_A]);
    expect(few.plan).toBeNull();
    expect(few.segments).toEqual([SEG_B]);
  });
});

describe('buildPathLines — 성질(PBT)', () => {
  const kindArb = fc.constantFrom<MapPinKind | undefined>(
    undefined,
    'visited',
    'planned',
    'stay',
    'candidate'
  );
  const pinArb = fc
    .record({
      lat: fc.double({ min: 33, max: 39, noNaN: true }),
      lng: fc.double({ min: 124, max: 132, noNaN: true }),
      kind: kindArb,
    })
    .map(({ lat, lng, kind }) => ({
      number: 0,
      lat,
      lng,
      ...(kind === undefined ? {} : { kind }),
    }));
  const pinsArb = fc.array(pinArb, { maxLength: 10 });
  const isLinked = (p: MapPin) => p.kind === undefined || p.kind === 'visited';
  const segArb = fc.array(
    fc.record({
      lat: fc.double({ min: 33, max: 39, noNaN: true }),
      lng: fc.double({ min: 124, max: 132, noNaN: true }),
    }),
    { maxLength: 4 }
  );

  it('P1 연결선은 "연결 대상 핀의 좌표 열"이거나, 대상이 2개 미만·끔이면 null 이다', () => {
    fc.assert(
      fc.property(
        pinsArb,
        fc.option(fc.boolean(), { nil: undefined }),
        (pins, connectPins) => {
          const linked = pins.filter(isLinked).map(at);
          const { plan } = buildPathLines({ pins, connectPins });
          const expectNull = connectPins === false || linked.length < 2;
          return expectNull ? plan === null : isSame(plan, linked);
        }
      )
    );
  });

  it('P2 planned·stay·candidate 핀을 아무 자리에 끼워도 연결선은 같다', () => {
    const extraArb = fc.array(
      fc.record({
        at: fc.nat({ max: 10 }),
        kind: fc.constantFrom<MapPinKind>('planned', 'stay', 'candidate'),
        lat: fc.double({ min: 33, max: 39, noNaN: true }),
      }),
      { maxLength: 5 }
    );
    fc.assert(
      fc.property(pinsArb, extraArb, (pins, extras) => {
        const withExtras = [...pins];
        extras.forEach((e, i) => {
          withExtras.splice(Math.min(e.at, withExtras.length), 0, {
            number: 100 + i,
            lat: e.lat,
            lng: 130,
            kind: e.kind,
          });
        });
        const before = buildPathLines({ pins }).plan;
        const after = buildPathLines({ pins: withExtras }).plan;
        return isSame(before, after);
      })
    );
  });

  it('P3 세그먼트는 "점 ≥2 인 입력 세그먼트"를 순서대로 그대로이고, 계획선 흐림은 그것이 있을 때만이다', () => {
    fc.assert(
      fc.property(
        fc.array(segArb, { maxLength: 5 }),
        pinsArb,
        fc.boolean(),
        (actualRoute, pins, connectPins) => {
          const { segments, planDimmed } = buildPathLines({
            pins,
            connectPins,
            actualRoute,
          });
          const expected = actualRoute.filter((seg) => seg.length >= 2);
          return (
            JSON.stringify(segments) === JSON.stringify(expected) &&
            planDimmed === expected.length > 0
          );
        }
      )
    );
  });
});

function isSame(a: MapCenter[] | null, b: MapCenter[] | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
