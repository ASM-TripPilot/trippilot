import type { MapPin } from '@/shared/map';

import { buildStatePins, toMapPinState } from './slotMapPin';
import type { SlotProgressState } from './slotMapPin';

/**
 * TRIP-745 · AC-5 — 슬롯 진행상태 → 핀상태 매핑(entities/itinerary-slot/lib).
 *
 * 무엇을 보장하나: 슬롯의 진행상태(execution 어휘 `'done'|'active'|'upcoming'`)를 shared/map 의
 * 핀 어휘(`'done'|'current'|'upcoming'`)로 바꾸고, 좌표가 붙은 슬롯만 `MapPin{number,lat,lng,state}`
 * 로 조립한다. 이 매핑의 **존재 이유**가 `active`→`current` 어휘 축 차이다 — 투영(어느 슬롯이 진행
 * 중인가)은 features/execution 이 하고, 이름변환·핀조립은 entities 가 한다(FSD 경계상 entities 는
 * execution 의 `SlotState` 를 import 못 해 입력 타입을 entities-로컬로 다시 선언한다).
 *
 * 3동작: 준비(진행상태+좌표) → 실행(toMapPinState/buildStatePins) → 단언(어휘·번호·좌표·건너뜀).
 *
 * 경계(features import 0)와 INV-3 는 `entitiesItinerarySlotStructure.test.ts`(G2·G3)가 이 신규
 * 파일을 재귀 스캔에 자동 편입해 잠근다 — 여기서 복제하지 않는다(02a §1).
 */

describe('toMapPinState — 진행상태 어휘를 핀 어휘로 변환 (AC-5)', () => {
  it.each([
    ['done', 'done'],
    ['active', 'current'],
    ['upcoming', 'upcoming'],
  ] as [SlotProgressState, MapPin['state']][])(
    '진행상태 %s → 핀상태 %s',
    (progress, expected) => {
      // 준비=표의 한 행 · 실행=toMapPinState · 단언=변환 결과.
      // active→current 가 이 함수의 핵심 — 나머지 둘은 이름이 그대로다.
      expect(toMapPinState(progress)).toBe(expected);
    }
  );
});

describe('buildStatePins — 좌표 붙은 슬롯만 번호 유지하며 핀 조립 (AC-5)', () => {
  it('전부 좌표 있으면 번호 1..n + 상태 변환된 핀을 순서대로 낸다', () => {
    // 준비 — 진행상태 3종을 섞는다(active 가 current 로 바뀌는지 조립 경로에서도 확인).
    const entries = [
      { lat: 33.51, lng: 126.52, progress: 'active' as const },
      { lat: 33.515, lng: 126.526, progress: 'done' as const },
      { lat: 33.52, lng: 126.53, progress: 'upcoming' as const },
    ];

    // 실행
    const pins = buildStatePins(entries);

    // 단언 — 번호·좌표·state 변환을 한 번에 완전일치(toEqual 은 순서·필드 민감).
    expect(pins).toEqual([
      { number: 1, lat: 33.51, lng: 126.52, state: 'current' },
      { number: 2, lat: 33.515, lng: 126.526, state: 'done' },
      { number: 3, lat: 33.52, lng: 126.53, state: 'upcoming' },
    ]);
  });

  it('좌표 없는 슬롯은 건너뛰되 뒤 항목 번호를 당기지 않는다 (①③ 유지)', () => {
    // 준비 — 가운데(lat null)·넷째(lng undefined)가 좌표 결측. 번호는 배열 index+1 규약이라
    // 남은 핀은 ①③⑤ 로 뛴다(재번호하면 지도 ③ 을 눌러 카드 ③ 을 기대할 때 다른 장소가 나온다,
    // buildDraftPins 규약 계승).
    const entries = [
      { lat: 33.51, lng: 126.52, progress: 'active' as const }, // index 0 → 1
      { lat: null, lng: 126.53, progress: 'done' as const }, // 건너뜀
      { lat: 33.53, lng: 126.54, progress: 'upcoming' as const }, // index 2 → 3
      { lat: 33.54, lng: undefined, progress: 'done' as const }, // 건너뜀
      { lat: 33.55, lng: 126.56, progress: 'active' as const }, // index 4 → 5
    ];

    // 실행
    const pins = buildStatePins(entries);

    // 단언 — 좌표 결측은 빠지고, 살아남은 핀의 번호는 원래 index+1(재번호 뮤턴트 차단).
    expect(pins.map((pin) => pin.number)).toEqual([1, 3, 5]);
    expect(pins).toEqual([
      { number: 1, lat: 33.51, lng: 126.52, state: 'current' },
      { number: 3, lat: 33.53, lng: 126.54, state: 'upcoming' },
      { number: 5, lat: 33.55, lng: 126.56, state: 'current' },
    ]);
  });

  it('빈 입력이면 빈 배열이다', () => {
    expect(buildStatePins([])).toEqual([]);
  });

  it('모든 슬롯의 좌표가 결측이면 빈 배열이다', () => {
    const entries = [
      { lat: null, lng: null, progress: 'done' as const },
      { lat: undefined, lng: undefined, progress: 'active' as const },
    ];
    expect(buildStatePins(entries)).toEqual([]);
  });
});
