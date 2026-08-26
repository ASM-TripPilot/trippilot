/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

import { StartReplanRequestOriginKind } from '@/shared/api/generated/schemas/startReplanRequestOriginKind';
import type { ReplanOrigin } from './replanOrigin';
import { buildManualOrigin, isEstimatedOrigin } from './replanOrigin';
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
    // 준비 — 광안리 인근 좌표(kakaoMapViewMock 관례 좌표).
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

/** ── M5 codegen 스키마 앵커 ─────────────────────────────────────────────
 * 생성물을 글자로 읽어 "additive 계약이 기대는 경계"(originKind required+nullable,
 * lat/lng optional)를 잠근다. `pnpm codegen` 재생성이 이 경계를 뒤집으면 jest 가 red. */

const SCHEMA_DIR = path.resolve('src/shared/api/generated/schemas');

/** 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 보지 않는다(리포 stripComments 관례). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readSchema(name: string): string {
  return stripComments(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
}

describe('🟢 M5 · AC-1 — codegen 스키마 경계 앵커', () => {
  it('탐지기 자가검사 — 주석은 걷히고 URL 슬래시는 살아남는다', () => {
    const sample = [
      '/** originKind 설명 주석 */',
      '// originKind?: number; 이건 주석',
      "const u = 'https://x/y';",
      'originKind: StartReplanRequestOriginKind;',
    ].join('\n');
    const stripped = stripComments(sample);
    // 주석 속 가짜 originKind?: 는 걷힌다(안 걷으면 아래 required 단언이 거짓 red).
    expect(stripped).not.toContain('이건 주석');
    // 코드의 URL·필드는 살아남는다.
    expect(stripped).toContain("const u = 'https://x/y';");
    expect(stripped).toContain('originKind: StartReplanRequestOriginKind;');
  });

  it('originKind 는 required(물음표 없음) + 타입은 nullable, MANUAL 값 존재', () => {
    const request = readSchema('startReplanRequest.ts');
    const originKind = readSchema('startReplanRequestOriginKind.ts');

    // required — 물음표 없는 선언이 있고, 물음표 붙은 선언은 없다.
    expect(request).toMatch(/originKind: StartReplanRequestOriginKind/);
    expect(request).not.toMatch(/originKind\?:/);
    // nullable — 값에 null 이 허용된다(건너뛰기 = 명시적 null 의 근거).
    expect(originKind).toMatch(/\|\s*null/);
    // MANUAL 이 enum 에 있다(buildManualOrigin 의 출력값).
    expect(originKind).toMatch(/MANUAL:\s*'MANUAL'/);
  });

  it('originLat·originLng 는 optional + nullable', () => {
    const request = readSchema('startReplanRequest.ts');
    expect(request).toMatch(/originLat\?: number \| null/);
    expect(request).toMatch(/originLng\?: number \| null/);
  });
});
