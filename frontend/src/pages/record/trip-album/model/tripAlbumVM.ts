import {
  formatDateRangeWithDow,
  formatDayLabel,
  tripDayNumber,
} from '@/entities/trip';
import type { TripRecordDay, VisitPhoto } from '@/shared/api/index.schemas';

/**
 * TRIP-1798 · 여행 앨범 VM — 서버 기록 + 방문별 사진 메타 + 기기 앨범 주소를 "일차 → 장소 → 사진" 묶음으로 조립하는 순수 규칙.
 * 시계·네트워크를 읽지 않는다(조회는 `useTripAlbum`, 그리기는 `TripAlbumScreen`).
 *
 * 규칙: 이 기기 사진만 그린다(다른 기기는 장수만 센다, 기기 id 를 모르면 아무것도 안 그린다) · 앨범에서 못 푼 사진(null)은 세고 숨긴다
 * (아직 모름(undefined)은 세지도 그리지도 않는다) · 그릴 사진이 0장인 장소·일차는 숨긴다 · 건너뜀 방문도 사진이 있으면 포함 ·
 * 장소 이름은 일정 슬롯 → 즉석 이름 → `{그날 N}번째 장소`(지어내지 않는다).
 * ponytail: 이름 규칙은 `features/reflection` magazineVM 의 비공개 `nameOf` 와 같은 3줄 사본이다 — 한쪽을 고치면 다른 쪽도 고친다.
 */

export interface TripAlbumInput {
  days: TripRecordDay[];
  photosByVisit: Record<string, VisitPhoto[] | undefined>;
  installId: string | null;
  uriByAssetId: Record<string, string | null | undefined>;
  startDate: string | undefined;
  spontaneousNames: Record<string, string>;
}

interface TripAlbumPlace {
  visitCheckId: string;
  name: string;
  countLabel: string;
  photos: { visitPhotoMetaId: string; uri: string }[];
}

interface TripAlbumDay {
  dayNumber: number;
  title: string;
  places: TripAlbumPlace[];
}

export interface TripAlbumVM {
  days: TripAlbumDay[];
  visiblePhotoCount: number;
  otherDeviceCount: number;
  unresolvedCount: number;
}

const hasOwn = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);
const filled = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';

export function buildTripAlbumVM(input: TripAlbumInput): TripAlbumVM {
  const { installId, photosByVisit, uriByAssetId, startDate } = input;

  // 전 일차 planned 를 펼친 poiId → 이름 표 — 먼저 나온 슬롯이 이긴다.
  const slotNames = new Map<string, string>();
  for (const day of input.days)
    for (const slot of day.planned)
      if (filled(slot.nameKo) && !slotNames.has(slot.poiId))
        slotNames.set(slot.poiId, slot.nameKo);
  const nameOf = (poiId: string): string | undefined => {
    const fromSlot = slotNames.get(poiId);
    if (fromSlot !== undefined) return fromSlot;
    const own = hasOwn(input.spontaneousNames, poiId)
      ? input.spontaneousNames[poiId]
      : undefined;
    return filled(own) ? own : undefined;
  };

  let otherDeviceCount = 0;
  let unresolvedCount = 0;
  let visiblePhotoCount = 0;

  const days: TripAlbumDay[] = [];
  input.days.forEach((day, dayIndex) => {
    const places: TripAlbumPlace[] = [];
    day.actual.forEach((visit, visitIndex) => {
      const all = photosByVisit[visit.visitCheckId] ?? [];
      if (installId === null) return; // 남의 사진을 내 것으로 그리는 것보다 낫다
      const mine = all.filter((p) => p.deviceId === installId);
      otherDeviceCount += all.length - mine.length;

      const photos: TripAlbumPlace['photos'] = [];
      for (const p of [...mine].sort((a, b) => a.sortOrder - b.sortOrder)) {
        const uri = hasOwn(uriByAssetId, p.localAssetId)
          ? uriByAssetId[p.localAssetId]
          : undefined;
        if (uri === null) unresolvedCount += 1;
        else if (uri !== undefined)
          photos.push({ visitPhotoMetaId: p.visitPhotoMetaId, uri });
      }
      if (photos.length === 0) return;
      visiblePhotoCount += photos.length;
      places.push({
        visitCheckId: visit.visitCheckId,
        name: nameOf(visit.poiId) ?? `${visitIndex + 1}번째 장소`,
        countLabel: `${photos.length}장`,
        photos,
      });
    });
    if (places.length === 0) return;
    const dayNumber =
      startDate === undefined
        ? dayIndex + 1
        : tripDayNumber(startDate, day.date);
    days.push({
      dayNumber,
      title:
        startDate === undefined
          ? formatDayLabel(dayNumber)
          : `${formatDayLabel(dayNumber)} · ${formatDateRangeWithDow(day.date, day.date)}`,
      places,
    });
  });

  return { days, visiblePhotoCount, otherDeviceCount, unresolvedCount };
}
