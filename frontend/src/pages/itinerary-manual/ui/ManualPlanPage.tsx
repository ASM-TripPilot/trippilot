import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import {
  buildDraftPins,
  formatCoPickDayHeader,
} from '@/features/itinerary/model/draftView';
import {
  useItineraryEditStore,
  type EditorDaysItem,
} from '@/features/itinerary/model/itineraryEditStore';
import { buildPlanDayTabs } from '@/features/itinerary/model/planState';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerary,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { EditorView } from '@/widgets/map-sheet-shell/ui/EditorView';
import { TimeSheet } from '@/widgets/time-sheet/ui/TimeSheet';

/**
 * h19 배선(TRIP-338) → TRIP-921 로 **h12 편집(`ItineraryEditPage`)과 같은 위젯 편집 뷰**
 * (`widgets/map-sheet-shell/ui/EditorView`)를 소비한다. 뷰가 드래그·⌄ 시각칩·"일정 저장하기"를 띄우므로
 * 그 표면을 전부 배선한다(배선 없이 뷰만 얹으면 누르거나 끌어도 아무 일 없는 표면이 된다, 01b Q3).
 *
 * 이 파일이 지는 책임:
 *  1. **마운트 시 MANUAL 생성 POST 를 정확히 1회** `{ generationMode:'MANUAL' }` 하나만 담아 쏜다(여분 키
 *     0, BR-U3-03). `firedRef` 가드가 필요한 이유: react-query 반환 객체가 렌더마다 새 객체라 effect 가
 *     재실행돼도 두 번 쏘지 않게 한다(GeneratingPage 선례).
 *  2. **기존 초안 보존** — GET `days.length>0`(정착)이면 재-POST 를 막아 직접 고르기 진입이 이미 만든
 *     슬롯을 빈 MANUAL 로 덮어쓰지 않는다. GET 로딩 중엔 보류(도착할 초안을 못 보고 쏘면 덮어씀 —
 *     서버가 재생성 POST 를 안 막으므로 이 보류가 유일한 방어선).
 *  3. **폴백 판정을 타지 않는다.** MANUAL 은 `solveMode=MINIMAL` 이지만 `isFallback=false`(실패가
 *     아니라 선택)라 폴백·실패 배너를 띄우지 않는다(AC-2).
 *  4. **편집은 편집 스토어 드래프트에서** — GET 도착 시 시드하고, 끌기 재정렬(고정 재고정은 스토어
 *     `reorderSlots`)·드롭 삭제·시각 시트 적용을 로컬로 반영한 뒤 저장 CTA 가 PUT 한다. MANUAL 초안엔
 *     방문 완료 개념이 없어 방문 조회를 하지 않는다.
 *  5. **저장 실패·미지정 제외를 침묵하지 않는다(INV-4)** — 실패는 원인 단정 없는 안내 1종(MANUAL
 *     초안에선 409 확정/생성중 갈래가 사실상 안 나온다), 미지정 슬롯이 빠지면 몇 곳인지 알린다.
 */

const SAVE_ERROR_NOTE = '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요';

// 슬롯 좌표가 없을 때(계약 공백)의 안전 폴백 center — 지도는 목이라 값은 심판 대상이 아니다
// (DraftPage·ItineraryPlanPage 폴백 선례와 동형).
const FALLBACK_CENTER = { lat: 0, lng: 0 };

export function ManualPlanPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const generate = usePostTripsTripIdItinerary();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const save = usePutTripsTripIdItinerary<unknown>();
  const firedRef = useRef(false);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unspecifiedNotice, setUnspecifiedNotice] = useState<string | null>(
    null
  );
  // 열린 시각 시트의 slotKey(null = 닫힘) — 조건부 마운트.
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);

  const seed = useItineraryEditStore((s) => s.seed);
  const deleteSlot = useItineraryEditStore((s) => s.deleteSlot);
  const reorderSlots = useItineraryEditStore((s) => s.reorderSlots);
  const adjustSlotTime = useItineraryEditStore((s) => s.adjustSlotTime);
  const days = useItineraryEditStore((s) => s.days);

  // 직접 고르기 진입이 기존 초안을 빈 MANUAL 로 덮어쓰지 않게 한다(TRIP-601 가드 a · BR-U3-06). 판정 축은
  // `days.length>0` — slots 만 빈 정상 MANUAL 재진입도 보존해 재-POST 를 막는다.
  const hasExisting = (itinerary.data?.days.length ?? 0) > 0;

  useEffect(() => {
    if (firedRef.current) return;
    // GET 로딩 중엔 보류 — 도착할 기존 초안을 못 보고 쏘면 그대로 덮어쓴다(fail-safe, ItineraryMethodPage 선례).
    if (itinerary.isPending) return;
    if (hasExisting) return;
    firedRef.current = true;
    generate.mutate({ tripId, data: { generationMode: 'MANUAL' } });
  }, [generate, tripId, itinerary.isPending, hasExisting]);

  // 조회는 시드 소스 — 데이터가 (다시) 도착할 때만 스토어를 채운다(편집 중 재렌더로 되돌려지지 않는다).
  useEffect(() => {
    const loaded = itinerary.data?.days;
    if (loaded !== undefined) seed(loaded);
  }, [itinerary.data, seed]);

  function handleSave(): void {
    setSaveError(null);
    // 미지정(startAt null) 슬롯은 buildEditItineraryRequest 가 요청에서 뺀다 — 미리 세어 알린다(INV-4).
    const droppedCount = (days as EditorDaysItem[])
      .flatMap((day) => day.slots)
      .filter((slot) => slot.startAt === null).length;
    setUnspecifiedNotice(
      droppedCount > 0
        ? `시간대를 정하지 않은 ${droppedCount}곳은 저장에서 빠졌어요`
        : null
    );

    save.mutate(
      { tripId, data: buildEditItineraryRequest(days) },
      {
        // 서버 재검증 결과를 조회 캐시에 직접 써넣는다(재조회 0) — 시드 effect 가 다시 돈다.
        onSuccess: (data) =>
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          ),
        onError: () => setSaveError(SAVE_ERROR_NOTE),
      }
    );
  }

  // 조회 전엔 빈 편집기(스토어 싱글턴의 이전 드래프트를 그리지 않는다).
  const loadedDays = itinerary.data === undefined ? [] : days;
  const activeDate = loadedDays[activeDayIndex]?.date ?? '';
  const activeSlots = loadedDays[activeDayIndex]?.slots ?? [];
  const pins = buildDraftPins(activeSlots);
  const center =
    pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : FALLBACK_CENTER;

  const editing = editingSlotKey === null ? null : parseSlotKey(editingSlotKey);
  const editingSlot =
    editing !== null && editing.kind === 'ok'
      ? days
          .find((day) => day.date === editing.date)
          ?.slots.find((slot) => slot.poiId === editing.poiId)
      : undefined;

  return (
    <View className="flex-1">
      <EditorView
        center={center}
        pins={pins}
        days={buildPlanDayTabs(loadedDays)}
        slots={activeSlots}
        activeDayIndex={activeDayIndex}
        activeDate={activeDate}
        dateLabel={formatCoPickDayHeader(activeDate)}
        onSelectDay={setActiveDayIndex}
        onBack={() => router.back()}
        onPressTimeChip={setEditingSlotKey}
        onPressAddPlace={() =>
          router.push({
            pathname: '/trips/[tripId]/itinerary/manual/add',
            params: { tripId },
          })
        }
        onPressAddBetween={(precedingIndex) =>
          router.push({
            pathname: '/trips/[tripId]/itinerary/manual/add',
            params: { tripId, insertAfter: String(precedingIndex) },
          })
        }
        onSave={handleSave}
        // 규칙은 순서만 바꾼다 — 미지정 null 허용 슬롯을 서버 슬롯 타입으로 좁혀도 런타임 안전(편집 페이지 선례).
        onReorder={(data) =>
          reorderSlots(activeDate, data as ItineraryDaysItemSlotsItem[])
        }
        onDeleteViaDrag={(poiId) => deleteSlot(activeDate, poiId)}
      />

      {/* 뷰가 못 가진 인라인 안내 — 저장 실패·미지정 제외(둘 다 INV-4). 편집 페이지 배너와 같은 모양. */}
      {saveError !== null || unspecifiedNotice !== null ? (
        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-[96px] items-center gap-xs px-lg"
        >
          {saveError !== null ? (
            <View
              testID="itinerary-manual-save-error"
              className="w-full rounded-card bg-primary-pale px-md py-sm"
            >
              <Text className="font-noto text-caption text-primary-text">
                {saveError}
              </Text>
            </View>
          ) : null}
          {unspecifiedNotice !== null ? (
            <View
              testID="itinerary-manual-unspecified-notice"
              className="w-full rounded-card bg-surface-strong px-md py-sm"
            >
              <Text className="font-noto text-caption text-ink">
                {unspecifiedNotice}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 시각조정 시트 — 열렸고 그 슬롯이 드래프트에 실재할 때만 마운트. 적용은 로컬 편집(저장은 PUT). */}
      {editing !== null &&
      editing.kind === 'ok' &&
      editingSlot !== undefined ? (
        <TimeSheet
          startAt={editingSlot.startAt}
          endAt={editingSlot.endAt}
          onApply={(patch) => {
            adjustSlotTime(editing.date, editing.poiId, patch);
            setEditingSlotKey(null);
          }}
          onCancel={() => setEditingSlotKey(null)}
          testIDPrefix="itinerary-manual-time"
          labels={{ start: '시작', end: '종료' }}
        />
      ) : null}
    </View>
  );
}
