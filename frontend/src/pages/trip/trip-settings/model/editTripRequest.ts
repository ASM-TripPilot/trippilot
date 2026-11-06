import type { DayWindow } from '@/features/create-trip';
import type {
  CompanionType,
  EditTripRequest,
  Trip,
} from '@/shared/api/index.schemas';

/** 사용자가 이 화면에서 바꾼 칸 — 없는 키는 "안 바꿈". */
export interface TripEdits {
  title?: string;
  party?: number;
  companionType?: CompanionType;
  /** 일과 시트 [적용] 결과(`HH:mm`, 정한 값만 키가 있다). 시트를 안 건드렸으면 키 자체가 없다. */
  dayWindow?: DayWindow;
}

/**
 * `GET /trips/{id}` 여행 + 바꾼 칸 → `PATCH /trips/{id}` 본문. 서버 PATCH 는 받은 본문으로 통째 교체하므로 안 바꾼 칸도
 * GET 값을 그대로 싣는다(기간·예산·목적지는 어떤 edits 로도 안 바뀐다). 취향 스냅샷은 본문 칸이 아니라 싣지 않는다.
 * 이름은 트림하지 않는다(서버도 안 한다).
 */
export function toEditTripRequest(
  trip: Trip,
  edits: TripEdits
): EditTripRequest {
  return {
    title: edits.title ?? trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    party: edits.party ?? trip.party,
    companionType: edits.companionType ?? trip.companionType,
    budgetTotal: trip.budgetTotal,
    destinations: trip.destinations,
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
