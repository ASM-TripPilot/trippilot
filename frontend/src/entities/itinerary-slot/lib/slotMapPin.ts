import type { MapPin, MapPinState } from '@/shared/map';

/**
 * TRIP-745 · 슬롯 진행상태 → 지도 핀상태 매핑(entities/itinerary-slot/lib).
 *
 * 이 파일의 존재 이유는 **어휘 축 차이**다. 어느 슬롯이 진행 중인가를 투영하는 일은
 * features/execution 이 하고(`SlotState = 'done'|'active'|'upcoming'`), 그 어휘를 shared/map 의
 * 핀 어휘(`'done'|'current'|'upcoming'`)로 바꾸고 좌표를 얹어 핀 배열로 조립하는 일은 여기가
 * 한다. entities 는 FSD 경계상 상위 층(features)을 import 하지 못해 execution 의 `SlotState` 를
 * 가져올 수 없으므로, 입력 진행상태 타입을 entities-로컬로 다시 선언한다(`SlotProgressState`).
 *
 * `MapPin`·`MapPinState` 는 값이 아니라 **타입만** 필요하므로 `import type` 으로 가져온다 —
 * 런타임에 `@/shared/map`(네이버 SDK 로 이어지는 무거운 모듈)을 끌어오지 않는다
 * (`buildMustVisitPins`·`buildDraftPins` 의 "MapPin 타입 전용 import" 관례 계승).
 */

/** 진행상태(execution 어휘) — `active` 자리가 핀 어휘에서는 `current` 다. */
export type SlotProgressState = 'done' | 'active' | 'upcoming';

/** 핀 하나를 조립하는 데 필요한 최소 입력 — 좌표(없을 수 있음)와 진행상태. */
export interface StatePinInput {
  lat: number | null | undefined;
  lng: number | null | undefined;
  progress: SlotProgressState;
}

/**
 * 진행상태 → 핀상태 어휘 변환. `active` 만 `current` 로 바뀌고 나머지 둘은 이름이 그대로다 —
 * 이 한 줄이 이 모듈의 핵심이다(색·모양은 shared/map 이 state 로 가른다).
 */
export function toMapPinState(progress: SlotProgressState): MapPinState {
  return progress === 'active' ? 'current' : progress;
}

/**
 * 좌표가 붙은 슬롯만 핀으로 조립하되, **번호(index+1)는 원래 자리를 유지한다**.
 *
 * 좌표가 없는 슬롯은 건너뛰지만 뒤 항목의 번호를 당기지 않아 살아남은 핀이 ①③⑤ 처럼 뛴다 —
 * 재번호하면 지도에서 ③ 을 눌러 카드 ③ 을 기대할 때 다른 장소가 나온다(`buildMustVisitPins`·
 * `buildDraftPins` 와 동일 규약). `flatMap` + 빈 배열이 그 "건너뛰되 index 는 보존"을 표현한다.
 */
export function buildStatePins(entries: readonly StatePinInput[]): MapPin[] {
  return entries.flatMap((entry, index) =>
    typeof entry.lat === 'number' && typeof entry.lng === 'number'
      ? [
          {
            number: index + 1,
            lat: entry.lat,
            lng: entry.lng,
            state: toMapPinState(entry.progress),
          },
        ]
      : []
  );
}
