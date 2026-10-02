import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { resolveEditorMapCenter } from '../model/editorMapCenter';
import {
  buildDraftPins,
  formatCoPickDayHeader,
} from '@/features/itinerary/model/draftView';
import {
  useItineraryEditStore,
  type EditorDaysItem,
} from '@/features/itinerary/model/itineraryEditStore';
import { buildPlanDayTabs } from '@/features/itinerary/model/planState';
import { SaveConflictDialog } from '@/features/itinerary/ui/SaveConflictDialog';
import { useTripWizardStore } from '@/features/create-trip/model/tripWizardStore';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import { useTripBases } from '@/features/trip/model/useTripBases';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerary,
  usePostTripsTripIdItineraryConfirm,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { isNotFound } from '@/shared/api/isNotFound';
import { showToast } from '@/shared/ui/Toast';
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
 *  6. **CTA 는 저장하고 확정한다(TRIP-1038 B)** — PUT 성공 뒤에만 확정 POST, 성공하면 h16 으로 replace.
 *     확정 부수효과(캐시 쓰기·위저드 비우기·409 재조회)는 `ItineraryPlanPage.handleConfirm` 의 복제다
 *     (pages 끼리 import 금지) — 한쪽만 고치면 갈라진다.
 *  7. **`startFresh`(TRIP-1038 C)** — 초안의 비우기 확인을 거쳐 오면 가드 a 를 건너뛰고 비운다. 비우는
 *     동안(POST~새 조회 도착) 옛 슬롯을 그리지 않는다 — 그 틈에 저장하면 옛 일정이 확정된다.
 *  8. **위반 있는 저장은 확정 전에 멈춘다(TRIP-1095)** — PUT 응답 전 일자에 위반이 있으면 확정 대신
 *     요약 게이트(`SaveConflictDialog`)를 띄운다. 저장 토스트는 PUT 시점 그대로 1회. [그대로 확정]은 위
 *     확정 경로, [고치기]는 게이트를 닫고 잠금을 푼다. 게이트가 떠 있는 동안은 잠금을 유지한다.
 */

const SAVE_ERROR_NOTE = '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요';
const SAVED_TOAST = '일정을 저장했어요';
const CONFIRMED_TOAST = '일정이 확정됐어요';
/** 409 세 원인·404 를 가르지 못해 원인을 단정하지 않는다(ItineraryPlanPage `CONFIRM_ERROR_NOTE` 와 같은 문구). */
const CONFIRM_ERROR_NOTE =
  '일정을 확정하지 못했어요. 잠시 후 다시 시도해 주세요';
/** 비우기 실패 3경로(조회 모름·POST 실패·재조회 실패) 공통 — 서버가 비웠는지 화면이 모를 수 있어 단정하지 않는다. */
const FRESH_ERROR_NOTE =
  '빈 일정으로 시작하지 못했어요. 일정 탭에서 다시 열어 주세요';

export function ManualPlanPage({
  tripId,
  startFresh = false,
}: {
  tripId: string;
  startFresh?: boolean;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const generate = usePostTripsTripIdItinerary();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const save = usePutTripsTripIdItinerary<unknown>();
  // 캐시 쓰기·위저드 비우기는 훅 옵션에 둔다 — 호출별 콜백과 달리 확정 대기 중 화면을 떠나도 불린다
  // (traps-itinerary GeneratingPage). 이동(replace)은 화면에 딸린 일이라 호출별 콜백에 둔다.
  const confirm = usePostTripsTripIdItineraryConfirm<unknown>({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(
          getGetTripsTripIdItineraryQueryKey(tripId),
          data
        );
        useTripWizardStore.getState().reset();
      },
    },
  });
  // 저장+확정 2왕복 잠금 — isPending 은 다음 렌더에야 참이라 같은 틱 연타·PUT~확정 틈을 못 막는다.
  const inFlightRef = useRef(false);
  // 위반 요약 게이트(null = 닫힘)와 그 버튼 연타 잠금 — 같은 틱 두 누름은 state 로 못 막는다.
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  const gateRef = useRef(false);
  // 비우기 POST 뒤 새 조회까지 끝났나(startFresh 전용). 그 전엔 캐시의 옛 일정을 그리지 않는다.
  const [freshDone, setFreshDone] = useState(false);
  // 비우기가 실패했나(startFresh 전용) — 켜지면 옛 슬롯을 계속 숨기고 저장·장소 추가를 막고 알린다.
  const [freshFailed, setFreshFailed] = useState(false);
  // 핀이 없는 날 지도 중심을 거점 숙소로 잡는 재료(TRIP-1022 결정 1) — 거점엔 좌표가 없어 등록 숙소와 잇는다.
  const bases = useTripBases(tripId);
  const savedStays = useSavedStays();
  const firedRef = useRef(false);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
    if (startFresh) {
      // 조회가 404 도 성공도 아니면 확정 여부를 모른다 — 서버는 확정 일정 재생성을 막지 않아 쏘면
      // 되돌릴 수 없다(DraftPage handleRetry 의 404 규칙과 같은 판정 · 03b 경고-3).
      if (
        itinerary.data === undefined &&
        itinerary.isError &&
        !isNotFound(itinerary.error)
      ) {
        firedRef.current = true;
        setFreshFailed(true);
        return;
      }
      // 가드 a 는 건너뛰되 확정 일정은 비우지 않는다(확정 해제 API 없음 · 01 맹점 ⑨).
      if (itinerary.data?.status === 'CONFIRMED') return;
    } else if (hasExisting) {
      return;
    }
    firedRef.current = true;
    generate.mutate(
      { tripId, data: { generationMode: 'MANUAL' } },
      {
        onSuccess: () => {
          // 조회가 404 로 정착해 있으면 방금 만든 일정(전 일자 빈 슬롯)을 모른다 — 다시 조회해 헤더
          // 날짜·일차 칩을 띄운다(TRIP-1022 #075). 응답을 캐시에 박지 않는 이유: 계약(openapi POST 201)은
          // "day1 만 담긴 PARTIAL" 이라 적고, MANUAL 이 전 일자를 준다는 사실은 서버 구현에만 있다.
          // 비우기 끝 = 새 일정이 **실제로** 캐시에 들어온 것(재조회 성공). 재조회가 실패해도 프로미스는
          // 풀리고 캐시엔 옛 일정 data 가 남는다 — "시도가 끝났다"에 묶으면 옛 일정이 되살아난다(03b 경고-1).
          const queryKey = getGetTripsTripIdItineraryQueryKey(tripId);
          void queryClient.invalidateQueries({ queryKey }).then(() => {
            if (queryClient.getQueryState(queryKey)?.status === 'success') {
              setFreshDone(true);
            } else {
              setFreshFailed(true);
            }
          });
        },
        // 여행 중 409 등 — 서버엔 옛 일정이 그대로다. 비-fresh 는 현행대로 침묵(표시는 startFresh 만).
        onError: () => setFreshFailed(true),
      }
    );
  }, [
    generate,
    tripId,
    itinerary.isPending,
    itinerary.isError,
    itinerary.error,
    itinerary.data,
    hasExisting,
    startFresh,
    queryClient,
  ]);

  // 조회는 시드 소스 — 데이터가 (다시) 도착할 때만 스토어를 채운다(편집 중 재렌더로 되돌려지지 않는다).
  useEffect(() => {
    const loaded = itinerary.data?.days;
    if (loaded !== undefined) seed(loaded);
  }, [itinerary.data, seed]);

  function handleSave(): void {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSaveError(null);
    setConfirmError(null);
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
        // 토스트는 확정이 실패해도 "저장은 됐다"를 알린다(01 Q3). 확정은 PUT 성공 뒤에만.
        onSuccess: (data) => {
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          );
          showToast({ message: SAVED_TOAST, testID: 'itinerary-manual-saved' });
          const violations = data.days
            .flatMap((day) => day.slots)
            .filter((slot) => slot.hasViolation).length;
          if (violations > 0) {
            // 확정하지 않고 멈춘다 — 잠금은 게이트 버튼이 푼다(떠 있는 동안 저장 재누름 차단).
            gateRef.current = true;
            setConflictCount(violations);
            return;
          }
          runConfirm();
        },
        onError: () => {
          inFlightRef.current = false;
          setSaveError(SAVE_ERROR_NOTE);
        },
      }
    );
  }

  function runConfirm(): void {
    confirm.mutate(
      { tripId },
      {
        // 확정 토스트는 떠나기 전에 — h16 은 이미 확정된 캐시로 열려 재진입과 구별이 안 된다(TRIP-1047).
        onSuccess: () => {
          showToast({
            message: CONFIRMED_TOAST,
            testID: 'itinerary-confirmed-toast',
          });
          router.replace({
            pathname: '/trips/[tripId]/itinerary',
            params: { tripId },
          });
        },
        onError: (error) => {
          inFlightRef.current = false;
          setConfirmError(CONFIRM_ERROR_NOTE);
          // 409 만 재조회 — 서버 진실이 이미 확정일 수 있다. 500 은 상태가 안 바뀌었다(ItineraryPlanPage 선례).
          if (isAlreadyRegistered(error)) {
            void queryClient.invalidateQueries({
              queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
            });
          }
        },
      }
    );
  }

  function handleConflictConfirm(): void {
    if (!gateRef.current) return;
    gateRef.current = false;
    setConflictCount(null);
    runConfirm();
  }

  function handleConflictBack(): void {
    if (!gateRef.current) return;
    gateRef.current = false;
    setConflictCount(null);
    inFlightRef.current = false;
  }

  // 조회 전엔 빈 편집기(스토어 싱글턴의 이전 드래프트를 그리지 않는다). startFresh 로 비우는 중이면
  // 캐시의 옛 일정도 그리지 않는다 — 슬롯 0이라 CTA 도 비활성이 된다(C4). 확정 일정은 비우지 않으므로 그린다.
  // 비우기가 실패해도 숨김을 유지한다 — 옛 일정을 보이면 그걸 저장·확정해 되살릴 길이 열린다(03b 경고-1·2).
  const clearing =
    startFresh && !freshDone && itinerary.data?.status !== 'CONFIRMED';
  const loadedDays = itinerary.data === undefined || clearing ? [] : days;
  const freshError = startFresh && freshFailed;
  const activeDate = loadedDays[activeDayIndex]?.date ?? '';
  const activeSlots = loadedDays[activeDayIndex]?.slots ?? [];
  const pins = buildDraftPins(activeSlots);
  const center = resolveEditorMapCenter({
    pins,
    date: activeDate,
    bases: bases.data,
    stays: savedStays.data,
  });

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
        // ‹ 는 저장 여부와 무관하게 일정 탭으로(TRIP-1009 · 01b Q3) — 방식 선택 화면으로 되돌아가지 않는다.
        onBack={() => router.replace('/(tabs)/itinerary')}
        onPressTimeChip={setEditingSlotKey}
        // 비우는 중·비우기 실패엔 장소 추가로 보내지 않는다 — h13 은 캐시(옛 일정)로 PUT 을 만들어 옛 장소가
        // 전부 되살아난다(03b 경고-2). 뷰에 비활성 prop 이 없어 무반응으로 막고, 실패면 위 안내가 이유를 말한다.
        onPressAddPlace={() => {
          if (clearing) return;
          router.push({
            pathname: '/trips/[tripId]/itinerary/manual/add',
            params: { tripId },
          });
        }}
        onPressAddBetween={(precedingIndex) => {
          if (clearing) return;
          router.push({
            pathname: '/trips/[tripId]/itinerary/manual/add',
            params: {
              tripId,
              insertAfter: String(precedingIndex),
              // 활성 일자 — insertAfter 는 이 날 기준 index 다(TRIP-1115, PlaceAddPage 가 이 날에 담는다).
              date: activeDate,
            },
          });
        }}
        onSave={handleSave}
        saveLabel="저장하고 확정하기"
        // 규칙은 순서만 바꾼다 — 미지정 null 허용 슬롯을 서버 슬롯 타입으로 좁혀도 런타임 안전(편집 페이지 선례).
        onReorder={(data) =>
          reorderSlots(activeDate, data as ItineraryDaysItemSlotsItem[])
        }
        onDeleteViaDrag={(poiId) => deleteSlot(activeDate, poiId)}
      />

      {/* 뷰가 못 가진 인라인 안내 — 저장 실패·확정 실패·미지정 제외(모두 INV-4). 편집 페이지 배너와 같은 모양. */}
      {saveError !== null ||
      confirmError !== null ||
      unspecifiedNotice !== null ||
      freshError ? (
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
          {freshError ? (
            <View
              testID="itinerary-manual-fresh-error"
              className="w-full rounded-card bg-primary-pale px-md py-sm"
            >
              <Text className="font-noto text-caption text-primary-text">
                {FRESH_ERROR_NOTE}
              </Text>
            </View>
          ) : null}
          {confirmError !== null ? (
            <View
              testID="itinerary-manual-confirm-error"
              className="w-full rounded-card bg-primary-pale px-md py-sm"
            >
              <Text className="font-noto text-caption text-primary-text">
                {confirmError}
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

      {conflictCount !== null ? (
        <SaveConflictDialog
          count={conflictCount}
          confirmLabel="그대로 확정"
          onConfirm={handleConflictConfirm}
          onBack={handleConflictBack}
        />
      ) : null}
    </View>
  );
}
