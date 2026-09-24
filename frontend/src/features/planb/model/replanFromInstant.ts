/**
 * TRIP-752 · 재계획 기준 시각(`fromInstant`, 서버 ISO 순간)을 여행지 시각(Asia/Seoul = UTC+9)의
 * 날짜·시로 읽는다. i05 캡션 `{hour}시 이후 다시 짜는 중`과 "어느 날 일정을 보여 줄까"가 여기서 나온다.
 *
 * 기기 시간대를 읽지 않는다 — 순간에 9시간을 더한 뒤 UTC 필드로 읽는다(서버 `TRAVEL_ZONE` 과 같은 날짜).
 * 한국은 서머타임이 없어 고정 오프셋으로 충분하다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function readFromInstant(instant: string): {
  date: string;
  hour: number;
} {
  const kst = new Date(new Date(instant).getTime() + KST_OFFSET_MS);
  return {
    date: kst.toISOString().slice(0, 10),
    hour: kst.getUTCHours(),
  };
}
