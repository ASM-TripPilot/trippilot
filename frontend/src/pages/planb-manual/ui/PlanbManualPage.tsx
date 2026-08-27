import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

import type {
  EditItineraryRequest,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import {
  useGetTripsTripIdItinerary,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { ManualTimeSheet } from '@/shared/itinerary-edit';

import { ManualEditScreen } from '@/features/planb/ui/ManualEditScreen';

/**
 * TRIP-443 · planb-manual 배선(pages) — 라우트가 넘긴 `{tripId, variant}`를 받아 일정 GET으로 편집
 * days를 1회 시드하고, [저장]에서 편집 봉투를 `PUT /trips/{tripId}/itinerary`(편집 전체교체+재검증,
 * 비차단)로 쏜다. `variant`를 `ManualEditScreen`에 그대로 흘려 i15/i22 얼굴을 고른다(진입 신호 =
 * variant, isFallback/solveMode 아님 — 신호 겹침을 라우트 파라미터로 가름).
 *
 * MANUAL은 `isFallback=false`(실패 아닌 선택)라 정상 진입(variant 미지정=i15)엔 폴백/누락 배너가 없다.
 *
 * 편집은 로컬 draft 에 쌓는다 — 삭제·[시각 입력]이 GET 캐시를 안 건드리고(비파괴 얕은 복사), 저장은
 * 그 draft 를 통째 PUT 한다(INV-U3-02 배열 순서=슬롯 순서). 드래그 재정렬(`reorderKeepingFixed`)과
 * 복구 머지(`mergeValidationFlags`)의 순수 로직은 shared 에 갖춰 뒀으나 트리거 배선은 후속(Q4 정본
 * 공백·draggable 미배선) — 03 §트레이드오프.
 */

export interface PlanbManualPageProps {
  tripId: string;
  variant?: 'error' | 'normal';
}

/** 편집 draft days 를 PUT 봉투로 조립 — 서버가 받는 5필드만 픽(읽기전용 필드는 서버 소유라 안 보냄).
 * `buildEditItineraryRequest`(features/itinerary)와 동형이나 features 경계로 여기서 조립한다. */
function buildEditRequest(days: ItineraryDaysItem[]): EditItineraryRequest {
  return {
    days: days.map((day) => ({
      date: day.date,
      slots: day.slots.map((slot) => ({
        poiId: slot.poiId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        isFixed: slot.isFixed,
        endsNextDay: slot.endsNextDay,
      })),
    })),
  };
}

export function PlanbManualPage({
  tripId,
  variant,
}: PlanbManualPageProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const putItinerary = usePutTripsTripIdItinerary();

  // 편집 draft — GET 응답으로 딱 1회 시드(편집으로 리렌더돼도 재시드하지 않아 손편집이 유지된다).
  const [days, setDays] = useState<ItineraryDaysItem[]>([]);
  const seededRef = useRef(false);
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);

  const serverDays = itinerary.data?.days;
  useEffect(() => {
    if (!seededRef.current && serverDays !== undefined) {
      setDays(
        serverDays.map((day) => ({ date: day.date, slots: [...day.slots] }))
      );
      seededRef.current = true;
    }
  }, [serverDays]);

  // 활성 일자는 0 고정(다일자 전환은 후속 — 계약에 activeDayIndex 흐름이 없다).
  const activeDate = days[0]?.date ?? '';
  const editingSlot =
    editingSlotKey === null
      ? undefined
      : days
          .flatMap((day) =>
            day.slots.map((slot) => ({
              key: `${day.date}#${slot.poiId}`,
              slot,
            }))
          )
          .find((entry) => entry.key === editingSlotKey)?.slot;

  function handleSave(): void {
    putItinerary.mutate({ tripId, data: buildEditRequest(days) });
  }

  function handleDeleteSlot(poiId: string): void {
    setDays((prev) =>
      prev.map((day) =>
        day.date === activeDate
          ? { ...day, slots: day.slots.filter((slot) => slot.poiId !== poiId) }
          : day
      )
    );
  }

  function handleApplyTime(patch: {
    startAt: string;
    endAt: string;
    endsNextDay: boolean;
  }): void {
    setDays((prev) =>
      prev.map((day) => ({
        ...day,
        slots: day.slots.map((slot) =>
          `${day.date}#${slot.poiId}` === editingSlotKey
            ? { ...slot, ...patch }
            : slot
        ),
      }))
    );
    setEditingSlotKey(null);
  }

  return (
    <>
      <ManualEditScreen
        variant={variant}
        days={days}
        onBack={() => router.back()}
        onSave={handleSave}
        onDeleteSlot={handleDeleteSlot}
        onEditSlotTime={(slotKey) => setEditingSlotKey(slotKey)}
      />
      {editingSlot === undefined ? null : (
        <ManualTimeSheet
          startAt={editingSlot.startAt}
          endAt={editingSlot.endAt}
          onApply={handleApplyTime}
          onCancel={() => setEditingSlotKey(null)}
        />
      )}
    </>
  );
}
