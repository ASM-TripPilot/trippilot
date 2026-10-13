/**
 * @jest-environment node
 */
import { StartReplanRequestOriginKind } from '@/shared/api/index.schemas';
import type { ReplanOrigin } from './replanOrigin';
import {
  buildGpsOrigin,
  buildManualOrigin,
  isEstimatedOrigin,
} from './replanOrigin';
import { buildStartReplanRequest } from './replanRequest';

/**
 * TRIP-442 · AC-1·AC-2·AC-3 — 재계획 origin 순수 조립·판정 + codegen 계약 앵커.
 *
 * 무엇을 보장하나(초심자용): "GPS 를 못 써서 위치를 손으로 정할 때, 그 좌표가 어떤 서버 요청
 * 봉투가 되는가"를 지도·네이티브 없이 100% 결정론으로 잰다.
 *  - MANUAL 핀 좌표 → `originKind:'MANUAL'` + 좌표(M1·M2).
 *  - 위치 미입력(건너뛰기) → 기존과 **바이트 동일**한 `originKind:null` 봉투, lat/lng 키 없음(M3).
 *  - "(추정)" 표기는 GPS 만 빼고 전부 true — 세션 왕복 없이 originKind 로 즉시 판정(M4).
 *  - codegen 스키마가 originKind=required+nullable, lat/lng=optional 임을 앵커(M5).
 *
 * 3동작: 준비(폼/좌표/enum) → 실행(순수 함수) → 단언(봉투/불리언/스키마 소스).
 *
 * ★ 매처: `toEqual` 는 `{}` vs `{originKind:null}` 을 불일치로 본다(undefined ≠ null). 여기에
 *   키 집합 완전일치를 더해 "필수 키 존재 + 여분 0"을 이중으로 못 박는다(기존 replanRequest.test.ts 관례).
 */

/** MANUAL 조립·splice 가 낼 정확한 키 집합(정렬본). */
const MANUAL_ENVELOPE_KEYS = [
  'directives',
  'excludedPoiIds',
  'freeText',
  'originKind',
  'originLat',
  'originLng',
  'reasons',
  'scope',
  'triggerId',
];
/** origin 미제공 봉투의 정확한 키 집합(정렬본) — lat/lng 없음. */
const NO_ORIGIN_KEYS = [
  'directives',
  'excludedPoiIds',
  'freeText',
  'originKind',
  'reasons',
  'scope',
  'triggerId',
];

describe('🔴 M1 · AC-1 — buildManualOrigin: 핀 좌표 → MANUAL origin 조각', () => {
  it('좌표를 originKind:MANUAL + originLat/originLng 로 조립한다(정확히 3키)', () => {
    // 준비 — 광안리 인근 좌표(mapViewMock 관례 좌표).
    const coords = { lat: 35.1587, lng: 129.1604 };

    // 실행
    const origin = buildManualOrigin(coords);

    // 단언 — 완전일치 + 여분 키 0.
    expect(origin).toEqual({
      originKind: 'MANUAL',
      originLat: 35.1587,
      originLng: 129.1604,
    });
    expect(Object.keys(origin).sort()).toEqual([
      'originKind',
      'originLat',
      'originLng',
    ]);
  });
});

describe('🔴 M2 · AC-1 — buildStartReplanRequest: MANUAL origin 을 additive 로 싣는다', () => {
  it('origin 을 주면 originKind:MANUAL + 좌표가 봉투에 실린다(9키)', () => {
    // 준비 — 폼 4값 + 인라인 MANUAL origin(buildManualOrigin 을 안 거쳐 splice 만 독립 검증).
    const form = {
      scope: 'PARTIAL_SLOTS' as const,
      reasons: ['WEATHER'],
      directives: ['RELAX'],
      freeText: '광안리 야경',
    };
    const origin: ReplanOrigin = {
      originKind: 'MANUAL',
      originLat: 35.1587,
      originLng: 129.1604,
    };

    // 실행
    const result = buildStartReplanRequest(form, origin);

    // 단언 — 7키 + MANUAL(null 아님) + 좌표.
    expect(result).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: 'MANUAL',
      originLat: 35.1587,
      originLng: 129.1604,
      reasons: ['WEATHER'],
      directives: ['RELAX'],
      freeText: '광안리 야경',
      excludedPoiIds: [],
      triggerId: null,
    });
    expect(Object.keys(result).sort()).toEqual(MANUAL_ENVELOPE_KEYS);
  });
});

describe('🟢 M3 · AC-1·AC-2 — additive 불변: origin 미제공은 기존과 바이트 동일', () => {
  it('origin 을 안 주면 originKind:null 7키 그대로, originLat/originLng 키 자체가 없다', () => {
    // 준비
    const form = {
      scope: 'PARTIAL_SLOTS' as const,
      reasons: [],
      directives: [],
      freeText: '',
    };

    // 실행 — 인자 생략과 명시적 undefined 두 형태.
    const omitted = buildStartReplanRequest(form);
    const explicitUndefined = buildStartReplanRequest(form, undefined);

    // 단언 — 기존 7키 봉투(freeText '' → null), 두 호출 동일.
    const expected = {
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: [],
      directives: [],
      freeText: null,
      excludedPoiIds: [],
      triggerId: null,
    };
    expect(omitted).toEqual(expected);
    expect(explicitUndefined).toEqual(omitted);
    expect(Object.keys(omitted).sort()).toEqual(NO_ORIGIN_KEYS);
    // optional 은 값 null 이 아니라 "키 부재"가 정본(codegen originLat?/originLng?).
    expect('originLat' in omitted).toBe(false);
    expect('originLng' in omitted).toBe(false);
  });
});

describe('🔴 M4 · AC-3 — isEstimatedOrigin: GPS 만 실측, 그 외 전부 추정', () => {
  it.each([
    [StartReplanRequestOriginKind.GPS, false],
    [StartReplanRequestOriginKind.MANUAL, true],
    [StartReplanRequestOriginKind.LAST_VISIT, true],
    [StartReplanRequestOriginKind.STAY_ANCHOR, true],
    [null, true],
  ] as const)('originKind=%s → 추정 여부 %s', (kind, expected) => {
    expect(isEstimatedOrigin(kind)).toBe(expected);
  });
});

describe('🔴 G1 · TRIP-979 AC-A1 — buildGpsOrigin: 측위 좌표 → GPS origin 조각', () => {
  // lat ≠ lng — 축이 뒤바뀌면 드러난다.
  const coords = { lat: 37.5512, lng: 126.9882 };

  it('좌표를 originKind:GPS + originLat/originLng 로 조립한다(정확히 3키 · MANUAL 과 같은 모양)', () => {
    const origin = buildGpsOrigin(coords);

    expect(origin).toStrictEqual({
      originKind: 'GPS',
      originLat: 37.5512,
      originLng: 126.9882,
    });
    // GPS 는 실측 — "(추정)" 을 붙이지 않는다(BR-U4-19 가정 표기).
    expect(isEstimatedOrigin(origin.originKind)).toBe(false);
  });

  it('빌더에 넘기면 originKind:GPS + 좌표가 봉투에 실린다(9키)', () => {
    const form = {
      scope: 'PARTIAL_SLOTS' as const,
      reasons: [],
      directives: [],
      freeText: '',
    };

    const result = buildStartReplanRequest(form, buildGpsOrigin(coords));

    expect(result).toStrictEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: 'GPS',
      originLat: 37.5512,
      originLng: 126.9882,
      reasons: [],
      directives: [],
      freeText: null,
      excludedPoiIds: [],
      triggerId: null,
    });
    expect(Object.keys(result).sort()).toEqual(MANUAL_ENVELOPE_KEYS);
  });
});
