import fc from 'fast-check';

import type { Place } from '@/shared/api/generated/schemas';

import type { SavedPlacesFailureReason } from './savedPlaces';
import {
  COORD_BLOCKED_NOTICE,
  hasUsableCoords,
  SAVE_FAILURE_NOTICE,
} from './placeSaveGuard';

/**
 * AC-14 · AC-G6 · 01b Seed Q12 — 담기 전 방어(좌표)와 담기 실패 안내(4갈래 전수).
 *
 * 무엇을 보장하나:
 *  - `hasUsableCoords` 가 임의의 실수 조합에서 "유한하고 위도 ±90 · 경도 ±180 안"만 통과시킨다
 *    (BR-U1-02 · INV-U1-02). **이 함수는 현재 서버 계약에서 발동하지 않는다** — `Place.lat`·
 *    `lng` 가 required 이고 nullable 이 아니라 좌표 없는 응답이 존재할 수 없다. 그래서 US-EXPL-04
 *    예외 AC 는 "계약상 발생 불가"로 남고, 이 파일이 그 방어 코드의 유일한 심판이다. 순수 함수로
 *    분리한 이유가 정확히 이것이다 — 계약이 만들 수 없는 입력을 **정직하게** 만들 수 있다.
 *  - `SAVE_FAILURE_NOTICE` 가 `SavedPlacesFailureReason` 4갈래 **전부**에 사용자에게 보이는
 *    응답을 갖는다(INV-4 침묵 실패 금지). `Record<SavedPlacesFailureReason, …>` 라서 갈래가
 *    늘면 tsc 가 먼저 깨지고, 이 파일이 그 뒤를 잠근다.
 *  - 404 안내가 **계약이 구분해 주지 않는 원인을 단정하지 않는다**(INV-1). 계약은 "POI 없음"과
 *    "비-ACTIVE"를 한 코드로 준다.
 */

/** 계약(`openapi.yaml` Place)의 required 필드를 전부 채운 정상 응답 1건. */
const CONTRACT_PLACE: Place = {
  poiId: 'p1',
  nameKo: '감천문화마을',
  category: '명소',
  lat: 35.1587,
  lng: 129.1604,
  region: '사하구',
  openingHours: null,
  imageUrl: null,
  tags: [],
  savedCount: 12,
  dataStatus: 'ACTIVE',
};

describe('hasUsableCoords — 예제 (01b Seed Q12 · BR-U1-02)', () => {
  // 계약이 만들 수 없는 값(null·undefined·NaN)을 캐스팅 없이 넣기 위해 파라미터 타입이
  // `number | null | undefined` 로 넓다. 그 넓힘 자체가 "계약 밖 입력"의 표시다.
  const CASES: {
    name: string;
    lat: number | null | undefined;
    lng: number | null | undefined;
    expected: boolean;
  }[] = [
    { name: '정상 좌표', lat: 35.1587, lng: 129.1604, expected: true },
    { name: '경계 포함 — 북동 끝', lat: 90, lng: 180, expected: true },
    { name: '경계 포함 — 남서 끝', lat: -90, lng: -180, expected: true },
    { name: '적도·본초자오선', lat: 0, lng: 0, expected: true },
    { name: '위도 범위 밖(양)', lat: 90.0001, lng: 0, expected: false },
    { name: '위도 범위 밖(음)', lat: -91, lng: 0, expected: false },
    { name: '경도 범위 밖(양)', lat: 0, lng: 180.0001, expected: false },
    { name: '경도 범위 밖(음)', lat: 0, lng: -181, expected: false },
    { name: 'lat 이 null', lat: null, lng: 129.1604, expected: false },
    { name: 'lng 이 null', lat: 35.1587, lng: null, expected: false },
    {
      name: '둘 다 undefined',
      lat: undefined,
      lng: undefined,
      expected: false,
    },
    { name: 'NaN', lat: Number.NaN, lng: 0, expected: false },
    { name: '무한대', lat: 0, lng: Number.POSITIVE_INFINITY, expected: false },
  ];

  it.each(CASES)('$name → $expected', ({ lat, lng, expected }) => {
    expect(hasUsableCoords({ lat, lng })).toBe(expected);
  });

  it('계약이 실제로 주는 Place 는 막히지 않는다', () => {
    // 방어가 정상 경로를 죽이면 담기 자체가 안 된다 — 이 단언이 그 사고를 막는다.
    expect(hasUsableCoords(CONTRACT_PLACE)).toBe(true);
  });
});

describe('hasUsableCoords — 성질(PBT · 01b Seed Q12)', () => {
  it('임의의 실수 조합에서 true 는 "유한 + 범위 안"과 동치다', () => {
    // fc.double() 은 기본값으로 NaN 과 ±Infinity 도 만든다(실측) — 별도 arbitrary 가 필요 없다.
    fc.assert(
      fc.property(fc.double(), fc.double(), (lat, lng) => {
        const result = hasUsableCoords({ lat, lng });

        expect(typeof result).toBe('boolean');
        if (result) {
          expect(Number.isFinite(lat)).toBe(true);
          expect(Number.isFinite(lng)).toBe(true);
          expect(Math.abs(lat)).toBeLessThanOrEqual(90);
          expect(Math.abs(lng)).toBeLessThanOrEqual(180);
        }
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — 항상 false 를 돌려주는 구현도 위 성질은 전부 만족한다(전제가
    // 거짓이면 함의는 참). 범위 안 좌표는 **실제로** 통과해야 한다.
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          expect(hasUsableCoords({ lat, lng })).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('SAVE_FAILURE_NOTICE — 실패 4갈래 전수 (AC-14 · INV-4)', () => {
  const REASONS: SavedPlacesFailureReason[] = [
    'network',
    'not-found',
    'saved-id-unknown',
    'unauthenticated',
  ];

  it('4갈래가 빠짐없이 있고, 갈래마다 다른 문구와 정해진 액션을 갖는다', () => {
    // 갈래가 늘거나 줄면 여기서 red 다(타입 전수 강제의 런타임 짝).
    expect(Object.keys(SAVE_FAILURE_NOTICE).sort()).toEqual(REASONS);

    // 표 전체를 리터럴로 고정한다 — 게이트①에서 사람이 문구를 그대로 읽을 수 있어야 한다.
    expect(SAVE_FAILURE_NOTICE).toEqual({
      unauthenticated: {
        message: '로그인하면 마음에 든 장소를 담을 수 있어요',
        action: 'login',
      },
      'saved-id-unknown': {
        message: '담기 처리 중이에요. 잠시 후 다시 시도해 주세요',
        action: null,
      },
      'not-found': {
        message: '지금은 담을 수 없는 장소예요',
        action: null,
      },
      network: {
        message: '연결이 불안정해 담지 못했어요',
        action: 'retry',
      },
    });

    // 한 문구를 4갈래에 재사용하면 "사유를 표시한다"가 이름만 남는다.
    const messages = REASONS.map(
      (reason) => SAVE_FAILURE_NOTICE[reason].message
    );
    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(4);
  });

  it('404 안내가 계약이 구분해 주지 않는 원인을 단정하지 않는다 (AC-G6 · INV-1)', () => {
    const { message } = SAVE_FAILURE_NOTICE['not-found'];

    // 긍정 짝 — 문구가 실재한다(빈 문자열이면 아래 부정 단언이 공허하다).
    expect(message).toBe('지금은 담을 수 없는 장소예요');

    // 부정 — 서버는 404 하나로 "POI 없음"과 "비-ACTIVE"를 준다. 무엇 때문인지 지어내면 INV-1
    // 위반이고, 사용자는 사실이 아닐 수 있는 이유를 믿게 된다.
    expect(message).not.toMatch(/폐업|삭제|사라진|없어진|비공개|차단/);
  });
});

describe('COORD_BLOCKED_NOTICE — 좌표 방어 안내 (01b Seed Q12)', () => {
  it('사유를 표시하고 재시도를 권하지 않는다', () => {
    // 좌표가 없는 것은 다시 눌러도 달라지지 않는다 — 재시도 버튼을 달면 no-op 컨트롤이 된다
    // (01b Seed 관통 원칙).
    expect(COORD_BLOCKED_NOTICE).toEqual({
      message: '위치를 확인할 수 없어 담을 수 없어요',
      action: null,
    });
  });
});
