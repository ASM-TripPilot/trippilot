import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { buildDraftPins } from '@/features/itinerary/model/draftView';
import {
  useItineraryEditStore,
  type EditorDaysItem,
  type EditorSlot,
} from '@/features/itinerary/model/itineraryEditStore';
import {
  buildPlanDayTabs,
  resolvePlanState,
} from '@/features/itinerary/model/planState';
import { deriveVisitProgress } from '@/features/execution/model/visitProgress';
import { reorderKeepingLocked } from '@/features/planb/model/reorderKeepingLocked';
import {
  buildSlotKey,
  parseSlotKey,
} from '@/entities/itinerary-slot/lib/slotKey';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import {
  AlertCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { TimeSheet } from '@/widgets/time-sheet/ui/TimeSheet';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
  useGetTripsTripIdItinerary,
  useGetTripsTripIdVisitsDaysDay,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

import { EditorView } from './EditorView';

/**
 * h24 일정 편집 배선(TRIP-302 슬라이스1~3) — **TRIP-797 묶음 C 로 소비 화면을 옛
 * `ItineraryEditScreen`(features) → 순수 뷰 `EditorView`(같은 pages 슬라이스) 로 재조립**한다. 배선
 * 계약(무엇이 서버로 나가고 무엇이 화면에 뜨나)은 그대로고, "누가 그리나"만 h12 통일 편집기로 바뀐다.
 *
 * features 화면은 widgets(`MapSheetShell`)를 상향 참조 못 하므로 셸 조립은 pages 층 순수 뷰가 진다
 * (h07/h08 DraftPage·h14/h16 ItineraryPlanPage 선례). 이 페이지는 그 뷰가 요구하는 값(center·pins·
 * days·slots·활성 일자·콜백)을 채워 넣고, EditorView 가 순수 뷰라 못 가진 세 조각 — 저장 오류 안내·
 * 미지정 제외 안내·시각조정 시트 — 을 **형제로** 렌더한다(02a-C ★C5).
 *
 * 이 파일이 지는 책임 — EditorView 는 이 중 어느 것도 모른다:
 *  1. **조회는 시드 소스일 뿐, 진실은 편집 스토어다** — 뷰는 스토어의 편집 드래프트를 그리므로 삭제·
 *     재정렬·시각조정이 로컬로 즉시 반영된다. 조회 캐시는 안 건드린다.
 *  2. **시드는 데이터가 처음 도착할 때 1회** — 이후 편집 리렌더에도 조회 데이터 참조가 그대로라
 *     재시드하지 않는다(편집이 되돌려지지 않는다).
 *  3. **저장은 편집 스토어 전체를 5필드로 조립해 PUT 한다** — 성공 응답은 `setQueryData` 로 조회
 *     캐시에 직접 써넣어(재조회 0) 시드 useEffect 를 다시 돌리고, 위반은 저장을 막지 않는다(BR-U3-13).
 *  4. **저장 실패는 침묵하지 않는다(INV-4)** — 409 는 재조회한 일정 상태(신호 B)로 "확정" vs "만드는
 *     중" 을 가르고, 그 밖(5xx·네트워크)은 원인 단정 없는 안내를 인라인으로 띄운다.
 *  5. **미지정 슬롯 제외를 알린다(INV-4)** — 서버 계약이 `startAt` non-nullable 이라
 *     `buildEditItineraryRequest` 가 미지정(startAt null) 슬롯을 요청에서 뺀다. 뺀 곳이 있으면 몇
 *     곳인지 담은 안내를 렌더한다(조용히 사라지지 않게, AC-6).
 *  6. **방문 완료 슬롯을 잠근다(AC-11)** — 그 날 방문 기록을 조회해 완료 poiId → slotKey 를 EditorView
 *     에 내리면 그 카드가 잠긴다(편집 어포던스 부재). pages 층 특권으로 execution feature 를 조합한다.
 */

// 저장 실패 인라인 문구(INV-4 침묵 금지). 409 두 사유는 재조회한 상태로 갈라 서로 다른 문구를 준다.
const SAVE_CONFIRMED_NOTE = '확정된 일정은 수정할 수 없어요';
const SAVE_GENERATING_NOTE =
  '일정을 만드는 중이에요. 잠시 후 다시 시도해 주세요';
const SAVE_ERROR_NOTE = '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요';

// 슬롯 좌표가 없을 때(계약 공백)의 안전 폴백 center — 지도는 목이라 값은 심판 대상이 아니다
// (DraftPage·ItineraryPlanPage 의 `{ lat: 0, lng: 0 }` 폴백 선례와 동형).
const FALLBACK_CENTER = { lat: 0, lng: 0 };

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
  inTrip,
}: {
  tripId: string;
  /** TRIP-753 · i07 라우트(`planb/manual`)가 리터럴 true 로 넘긴다 — 뷰의 i07 얼굴(카드 사이 + 숨김·안내 문구). */
  inTrip?: boolean;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 저장 시 미지정(startAt null) 슬롯이 요청에서 빠지면 그 개수를 담는 안내(INV-4). null = 안내 없음.
  const [unspecifiedNotice, setUnspecifiedNotice] = useState<string | null>(
    null
  );
  // 어느 슬롯의 시각조정 시트가 열렸나(null = 닫힘). 시트 개폐는 뷰가 아니라 여기가 쥔다(순수 뷰 유지,
  // h07 선례) — 조건부 마운트라 닫히면 시트가 트리에서 사라진다.
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

  // 활성 일자 — 방문 조회 훅(아래)이 조기 반환보다 위에서 이 값을 필요로 한다(LiveItineraryPage 선례).
  // 로딩 중엔 days=[] 라 '' 가 되어 방문 조회가 꺼진다.
  const activeDate = days[activeDayIndex]?.date ?? '';

  // 완료 슬롯 잠금 실연동(AC-11) — 그 날 방문 기록을 조회한다. 훅 규칙상 조기 반환 위에서 무조건
  // 선언하고, 활성 일자가 아직 없으면(로딩) enabled=false 로 꺼 둔다(LiveItineraryPage 패턴).
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, activeDate, {
    query: { enabled: activeDate !== '' },
  });

  function handleSave(): void {
    setSaveError(null);
    // 미지정(startAt null) 슬롯은 buildEditItineraryRequest 가 요청에서 뺀다 — 몇 곳이 빠지는지 미리
    // 세어 안내한다(INV-4 침묵 금지). 스토어 상태 타입은 서버(non-nullable)지만 런타임엔 null 이 흐른다
    // (미지정을 만드는 프로덕션 경로는 h13/TRIP-798 몫 — 지금은 테스트 픽스처가 트리거를 대신 심는다).
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
          // 신호 B — 409 는 상태코드만으론 "확정" vs "만드는 중" 을 못 가른다. 재조회한 일정 상태로 가른다.
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

  const activeSlots = state.days[activeDayIndex]?.slots ?? [];
  const pins = buildDraftPins(activeSlots);
  const center =
    pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : FALLBACK_CENTER;

  // 완료 poiId → slotKey(활성 일자). EditorView 가 이 배열로 per-slot 잠금을 판정한다(AC-11).
  const { completedPoiIds } = deriveVisitProgress(
    visits.data ?? { visits: [] }
  );
  const completedSlotKeys = completedPoiIds.map((poiId) =>
    buildSlotKey(activeDate, poiId)
  );

  // 편집 중인 슬롯의 **현재 드래프트 값**을 찾아 시트에 시드한다 — 시트가 열렸고 그 슬롯이 드래프트에
  // 실재할 때만 마운트한다(둘 중 하나라도 없으면 안 그린다).
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
        days={buildPlanDayTabs(state.days)}
        slots={activeSlots as EditorSlot[]}
        activeDayIndex={activeDayIndex}
        activeDate={activeDate}
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
        // 끌기 결과에서 완료·고정 행을 원래 자리로 되돌린 뒤 스토어에 넣는다(TRIP-753 AC-8). 규칙은 startAt 을
        // 읽지 않고 순서만 바꾼다 — EditorSlot[](미지정 null 허용)을 서버 슬롯 타입으로 좁혀도 런타임 안전하다.
        onReorder={(data) =>
          reorderSlots(
            activeDate,
            reorderKeepingLocked(
              activeSlots,
              data as ItineraryDaysItemSlotsItem[],
              completedPoiIds
            )
          )
        }
        onDeleteViaDrag={(poiId) => deleteSlot(activeDate, poiId)}
        completedSlotKeys={completedSlotKeys}
        inTrip={inTrip}
      />

      {/* 순수 뷰가 못 가진 인라인 안내 — 저장 오류·미지정 제외(둘 다 INV-4). 지도·시트 위에 얹는 배너
          (Figma 프레임 없는 발명 표면). testID 는 EditorView 가 아니라 페이지 소유다(02a-C ★C5). */}
      {saveError !== null || unspecifiedNotice !== null ? (
        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-[96px] items-center gap-xs px-lg"
        >
          {saveError !== null ? (
            <View
              testID="itinerary-edit-save-error"
              className="w-full rounded-card bg-primary-pale px-md py-sm"
            >
              <Text className="font-noto text-caption text-primary-text">
                {saveError}
              </Text>
            </View>
          ) : null}
          {unspecifiedNotice !== null ? (
            <View
              testID="itinerary-edit-unspecified-notice"
              className="w-full rounded-card bg-surface-strong px-md py-sm"
            >
              <Text className="font-noto text-caption text-ink">
                {unspecifiedNotice}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 시각조정 시트 — 열렸고 그 슬롯이 드래프트에 실재할 때만 마운트(조건부). 적용은 로컬 편집이라
          서버를 안 건드린다(INV-2) — 저장은 여전히 위 handleSave 의 PUT 경로 그대로다. */}
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
          testIDPrefix="itinerary-edit-time"
          labels={{ start: '시작', end: '종료' }}
        />
      ) : null}
    </View>
  );
}
