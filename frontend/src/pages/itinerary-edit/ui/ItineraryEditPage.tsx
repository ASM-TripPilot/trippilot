import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import {
  buildPlanDayTabs,
  resolvePlanState,
} from '@/features/itinerary/model/planState';
import { parseSlotKey } from '@/features/itinerary/model/slotKey';
import {
  AlertCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { ItineraryEditScreen } from '@/features/itinerary/ui/ItineraryEditScreen';
import { SlotTimeSheet } from '@/features/itinerary/ui/SlotTimeSheet';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
  useGetTripsTripIdItinerary,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * h24 일정 편집 배선(TRIP-302 슬라이스1~2) — GET 조회를 **편집 드래프트 스토어에 1회 시드**하고,
 * 삭제·재정렬 콜백을 스토어 액션에 얹으며, `[저장하기]` 를 전체 교체 PUT 에 배선한다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **조회는 시드 소스일 뿐, 진실은 편집 스토어다** — 화면은 스토어의 편집 드래프트를 그리므로
 *     삭제·재정렬이 로컬로 즉시 반영된다. 조회 캐시는 건드리지 않는다(엣지5 mutation 0).
 *  2. **시드는 데이터가 처음 도착할 때 1회** — 이후 리렌더(편집으로 인한)에도 조회 데이터 참조가
 *     그대로라 재시드하지 않는다. 그래서 편집이 되돌려지지 않는다.
 *  3. **저장은 편집 스토어 전체를 5필드로 조립해 PUT 한다(슬라이스2)** — 성공 응답은 `setQueryData`
 *     로 조회 캐시에 직접 써넣어(재조회 0) 시드 useEffect 를 다시 돌리고, 그 재-시드가 서버 재검증
 *     위반 배지를 지속시킨다. 위반은 저장을 막지 않는다(비차단, BR-U3-13).
 *  4. **저장 실패는 침묵하지 않는다(INV-4)** — 409 는 재조회한 일정 상태(신호 B)로 "확정" vs "생성 중"
 *     을 가르고, 그 밖(5xx·네트워크)은 원인 단정 없는 안내를 인라인으로 띄운다.
 *  5. **404 는 별도 얼굴** — "편집할 일정이 아직 없다"(`isNotFound`)를 `resolvePlanState` 우선순위로
 *     갈라 침묵 실패를 피한다(INV-4).
 */

// 저장 실패 인라인 문구(INV-4 침묵 금지). 409 두 사유는 재조회한 상태로 갈라 서로 다른 문구를 준다.
const SAVE_CONFIRMED_NOTE = '확정된 일정은 수정할 수 없어요';
const SAVE_GENERATING_NOTE =
  '일정을 만드는 중이에요. 잠시 후 다시 시도해 주세요';
const SAVE_ERROR_NOTE = '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요';

function EditFace({
  testID,
  icon,
  title,
  description,
}: {
  testID: string;
  icon: ReactElement;
  title: string;
  description: string;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID={testID}
          icon={icon}
          title={title}
          description={description}
          actions={[]}
        />
      </View>
    </SafeAreaView>
  );
}

export function ItineraryEditPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 어느 슬롯의 시각조정 시트가 열렸나(null = 닫힘). 시트 개폐는 화면이 아니라 여기가 쥔다
  // (화면 순수성 유지, h07 선례) — 조건부 마운트라 닫히면 시트가 트리에서 사라진다.
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);

  const itinerary = useGetTripsTripIdItinerary(tripId);
  // TError=unknown 으로 열어 onError 의 error 를 axios 판정(isAlreadyRegistered)에 그대로 태운다(h11 선례).
  const save = usePutTripsTripIdItinerary<unknown>();

  const seed = useItineraryEditStore((s) => s.seed);
  const deleteSlot = useItineraryEditStore((s) => s.deleteSlot);
  const reorderSlots = useItineraryEditStore((s) => s.reorderSlots);
  const adjustSlotTime = useItineraryEditStore((s) => s.adjustSlotTime);
  const days = useItineraryEditStore((s) => s.days);

  useEffect(() => {
    const loaded = itinerary.data?.days;
    if (loaded !== undefined) seed(loaded);
  }, [itinerary.data, seed]);

  function handleSave(): void {
    setSaveError(null);
    save.mutate(
      { tripId, data: buildEditItineraryRequest(days) },
      {
        onSuccess: (data) => {
          // 최신 Itinerary(서버 재검증 결과)를 조회 캐시에 직접 써넣는다 — 재조회 0회. 시드 useEffect 가
          // itinerary.data 참조 변화로 다시 돌아 스토어를 재-시드하고, 새 hasViolation 배지가 지속된다.
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          );
        },
        onError: (error) => {
          // 409 외(5xx·네트워크)는 상태로 못 가르니 원인 단정 없는 안내만(INV-4 · 404·409만 태우면 5xx 소실).
          if (!isAlreadyRegistered(error)) {
            setSaveError(SAVE_ERROR_NOTE);
            return;
          }
          // 신호 B — 409 는 상태코드만으론 "확정" vs "생성 중" 을 못 가른다. 재조회한 일정 상태로 가른다.
          void queryClient
            .fetchQuery(getGetTripsTripIdItineraryQueryOptions(tripId))
            .then((latest) => {
              if (latest.generationState === 'PARTIAL') {
                setSaveError(SAVE_GENERATING_NOTE);
              } else if (latest.status === 'CONFIRMED') {
                setSaveError(SAVE_CONFIRMED_NOTE);
              } else {
                setSaveError(SAVE_ERROR_NOTE);
              }
            })
            .catch(() => setSaveError(SAVE_ERROR_NOTE));
        },
      }
    );
  }

  const state = resolvePlanState({
    loading: itinerary.isPending,
    notFound: isNotFound(itinerary.error),
    failed: itinerary.isError,
    days,
  });

  if (state.kind === 'loading') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas" />
      </SafeAreaView>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <EditFace
        testID="itinerary-edit-notfound"
        icon={<InfoCircleGlyph size={32} tone="primaryText" />}
        title="아직 편집할 일정이 없어요"
        description="일정을 만들면 여기에서 수정할 수 있어요"
      />
    );
  }

  if (state.kind === 'failed') {
    return (
      <EditFace
        testID="itinerary-edit-failed"
        icon={<AlertCircleGlyph size={32} tone="primaryText" />}
        title="일정을 불러오지 못했어요"
        description="네트워크를 확인하고 다시 시도해주세요"
      />
    );
  }

  const activeDate = state.days[activeDayIndex]?.date ?? '';

  // 편집 중인 슬롯의 **현재 드래프트 값**을 찾아 시트에 시드한다 — 시트가 열렸고 그 슬롯이
  // 드래프트에 실재할 때만 마운트한다(둘 중 하나라도 없으면 안 그린다).
  const editing = editingSlotKey === null ? null : parseSlotKey(editingSlotKey);
  const editingSlot =
    editing !== null && editing.kind === 'ok'
      ? days
          .find((day) => day.date === editing.date)
          ?.slots.find((slot) => slot.poiId === editing.poiId)
      : undefined;

  return (
    <>
      <ItineraryEditScreen
        days={buildPlanDayTabs(state.days)}
        slots={state.days[activeDayIndex]?.slots ?? []}
        activeDayIndex={activeDayIndex}
        onSelectDay={setActiveDayIndex}
        onBack={() => router.back()}
        onDeleteSlot={(poiId) => deleteSlot(activeDate, poiId)}
        onReorder={(data) => reorderSlots(activeDate, data)}
        onEditSlotTime={setEditingSlotKey}
        onSave={handleSave}
        saveError={saveError}
      />
      {editing !== null &&
      editing.kind === 'ok' &&
      editingSlot !== undefined ? (
        <SlotTimeSheet
          startAt={editingSlot.startAt}
          endAt={editingSlot.endAt}
          onApply={(patch) => {
            adjustSlotTime(editing.date, editing.poiId, patch);
            setEditingSlotKey(null);
          }}
          onCancel={() => setEditingSlotKey(null)}
        />
      ) : null}
    </>
  );
}
