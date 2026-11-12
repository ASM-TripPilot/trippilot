import type { DayWindow } from '@/features/create-trip';
import type {
  CompanionType,
  EditTripRequest,
  Trip,
} from '@/shared/api/index.schemas';

import { fitDestinationNights, nightsBetween } from './periodRules';

/** 사용자가 이 화면에서 바꾼 칸 — 없는 키는 "안 바꿈". */
export interface TripEdits {
  title?: string;
  party?: number;
  companionType?: CompanionType;
  /** 일과 시트 [적용] 결과(`HH:mm`, 정한 값만 키가 있다). 시트를 안 건드렸으면 키 자체가 없다. */
  dayWindow?: DayWindow;
  /** 기간 시트 [적용] 결과. 있으면 날짜가 이 값이고 박수 합이 새 일수에 맞춰진다(같은 일수 이동이면 목적지 그대로). */
  period?: { startDate: string; endDate: string };
  /** 커버 시트 [적용] 결과 — `null` 은 "첫 여행지 자동"을 고른 것. 없으면(`undefined`) 안 건드림이라 GET 의 현재 키를 싣는다. */
  coverKey?: string | null;
  /** 일수 변경 확정 — 서버가 이 여행의 일정을 버린다. 평소 저장엔 키 자체가 없다. */
  discardItinerary?: true;
}

/**
 * `GET /trips/{id}` 여행 + 바꾼 칸 → `PATCH /trips/{id}` 본문. 서버 PATCH 는 받은 본문으로 통째 교체하므로 안 바꾼 칸도
 * GET 값을 그대로 싣는다(기간·예산·목적지는 `edits.period` 를 안 주면 안 바뀐다). 취향 스냅샷은 본문 칸이 아니라 싣지 않는다.
 * 이름은 트림하지 않는다(서버도 안 한다). `coverKey` 는 `??` 로 접지 않는다 — null("자동")이 옛 키로 덮인다.
 */
export function toEditTripRequest(
  trip: Trip,
  edits: TripEdits
): EditTripRequest {
  const period = edits.period ?? {
    startDate: trip.startDate,
    endDate: trip.endDate,
  };
  const coverKey =
    edits.coverKey === undefined ? trip.coverKey : edits.coverKey;
  return {
    title: edits.title ?? trip.title,
    startDate: period.startDate,
    endDate: period.endDate,
    party: edits.party ?? trip.party,
    companionType: edits.companionType ?? trip.companionType,
    budgetTotal: trip.budgetTotal,
    destinations:
      edits.period === undefined
        ? trip.destinations
        : fitDestinationNights(
            trip.destinations,
            nightsBetween(trip.startDate, trip.endDate),
            nightsBetween(period.startDate, period.endDate)
          ),
    ...(coverKey === undefined ? {} : { coverKey }),
    ...(edits.discardItinerary ? { discardItinerary: true } : {}),
    // 시트를 안 열었으면 GET 원문(`HH:mm:ss`·null) 그대로, 열었으면 시트가 정한 값만 — 위저드 생성 요청과 같은 규약.
    ...(edits.dayWindow === undefined
      ? {
          dayStartAt: trip.dayStartAt,
          firstDayStartAt: trip.firstDayStartAt,
          lastDayEndAt: trip.lastDayEndAt,
        }
      : edits.dayWindow),
  };
}
