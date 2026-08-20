import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-398 · i05 현재 장소 상세 — 순수 도출. 슬롯 POI 합성 필드에서 화면 표시용 뷰를 만든다.
 *
 * 무엇을 보장하나:
 *  - 결측 필드는 빈칸이 아니라 "미확인"(BR-U4-40, `mapPeek.ts` 선례 `nameKo ?? '미확인'`).
 *  - '여유'(slack)는 **두 확정 시각의 차**(다음 고정 슬롯 startAt − 현재 슬롯 endAt)의 부호로
 *    정성 라벨을 정한다(BR-U4-24). wall-clock 을 안 쓰므로 순수 결정론 — 소요시간 단위(분/시간)를
 *    절대 산출하지 않는다(INV-3).
 *  - 매칭 슬롯이 없으면 null(D8) → 페이지가 "장소를 찾을 수 없어요" 얼굴로 접는다.
 *
 * ★ 시각 산술 규율(liveTimeStructure 가드): 슬롯 시각 식별자(`startAt`/`endAt`)에 **인접한** 산술
 * 연산자·`new Date`·날짜 라이브러리를 못 쓴다. "HH:mm:ss"를 `.split(':')`로 쪼개 **다른 이름의
 * 분(minute) 변수**(`toMinutes`)로 옮긴 뒤 그 변수끼리 함수 호출 사이에서 뺀다.
 */

const MISSING = '미확인';

export interface PlaceDetailView {
  name: string;
  category: string | null;
  tags: string[];
  imageUrl: string | null;
  openingHours: string;
  /** openingHours == null → 값 자리를 `-unknown-openhours` testID 로 바꾸는 스위치(AC-2). */
  openingHoursMissing: boolean;
  /** openingHoursKnown===false 일 때만 "확인 필요"(D4). 그 외(true·null)는 null. */
  hoursCaption: string | null;
  /** 계약 공백이라 항상 "미확인"(D3). */
  location: string;
  slackLabel: string;
  /** 계획값(BR-U4-34) — startAt "14:20:00" → "14:20 도착"(재추정 아닌 슬라이스). */
  arrival: string;
  lat: number | null;
  lng: number | null;
}

// "HH:mm:ss" → 분(minute). 슬롯 시각 식별자에 인접 산술을 붙이지 않으려는 우회(★1) — split 으로
// 쪼갠 뒤 다른 이름 변수로 옮긴다. Number 변환은 초를 버리고 시·분만 쓴다.
function toMinutes(clock: string): number {
  const [hh, mm] = clock.split(':');
  return Number(hh) * 60 + Number(mm);
}

export function resolveSlackLabel(
  currentEndAt: string,
  nextFixed: { startAt: string; nameKo: string | null } | null
): string {
  // 다음 고정 슬롯이 없으면 여유를 판정할 수 없다(BR-U4-40 균일).
  if (nextFixed === null) return MISSING;
  // 두 확정 시각의 차(BR-U4-24). 뺄셈은 minute 변수끼리 — 함수 호출 사이라 가드에 안 걸린다.
  const gap = toMinutes(nextFixed.startAt) - toMinutes(currentEndAt);
  const tone = gap > 0 ? '여유 있음' : '여유 없음';
  const nextName = nextFixed.nameKo ?? MISSING;
  return `${tone} · 다음 ${nextName}`;
}

export function buildPlaceDetailView(
  slots: readonly ItineraryDaysItemSlotsItem[],
  poiId: string
): PlaceDetailView | null {
  const index = slots.findIndex((slot) => slot.poiId === poiId);
  if (index === -1) return null;
  const slot = slots[index];

  // 다음 "고정(isFixed)" 슬롯 — 비고정은 건너뛴다(AC-4).
  const nextFixedSlot = slots.slice(index + 1).find((next) => next.isFixed);
  const slackLabel = resolveSlackLabel(
    slot.endAt,
    nextFixedSlot === undefined
      ? null
      : { startAt: nextFixedSlot.startAt, nameKo: nextFixedSlot.nameKo ?? null }
  );

  const openingHoursMissing =
    slot.openingHours === null || slot.openingHours === undefined;

  return {
    name: slot.nameKo ?? MISSING,
    category: slot.category ?? null,
    tags: slot.tags,
    imageUrl: slot.imageUrl ?? null,
    openingHours: slot.openingHours ?? MISSING,
    openingHoursMissing,
    hoursCaption: slot.openingHoursKnown === false ? '확인 필요' : null,
    location: MISSING,
    slackLabel,
    arrival: `${slot.startAt.slice(0, 5)} 도착`,
    lat: slot.lat ?? null,
    lng: slot.lng ?? null,
  };
}
