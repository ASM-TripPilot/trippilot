import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { InfoCircleGlyph, AlertCircleGlyph } from '@/shared/ui/glyphs';
import { goBackOr } from '@/shared/lib/goBackOr';
import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';

import { buildEditItineraryRequest } from '@/features/edit-itinerary';
import { buildDraftPins, formatCoPickDayHeader } from '@/features/itinerary';
import {
  useEditorDraft,
  type EditorDaysItem,
  type EditorSlot,
} from '@/features/edit-itinerary';
import { buildPlanDayTabs, resolvePlanState } from '@/features/itinerary';
import {
  deriveVisitProgress,
  slotDisplayCategory,
  slotDisplayName,
  suggestNextSlotTime,
} from '@/entities/itinerary-slot';
import { buildMoveDayOptions } from '../model/moveDayOptions';
import { reorderKeepingLocked } from '../model/reorderKeepingLocked';
import { buildSlotKey, findSlotIndex } from '@/entities/itinerary-slot';
import {
  PoiCategory,
  type ItineraryDaysItemSlotsItem,
} from '@/shared/api/index.schemas';
import { SaveConflictDialog } from '@/features/edit-itinerary';
import { TimeSheet } from '@/widgets/time-sheet';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
  useGetTripsTripIdItinerary,
  getPutTripsTripIdItineraryMutationOptions,
  getGetTripsTripIdVisitsDaysDayQueryKey,
  useGetTripsTripIdVisitsDaysDay,
  usePutTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { isAlreadyRegistered } from '@/shared/api';
import { isNotFound } from '@/shared/api';
import { StateNotice } from '@/shared/ui/StateNotice';
import { showToast } from '@/shared/ui/Toast';
import { EditorView } from '@/widgets/map-sheet-shell';
import { MoveDaySheet } from './MoveDaySheet';
import { RenameSlotSheet } from './RenameSlotSheet';

/**
 * h24 일정 편집 배선(TRIP-302 슬라이스1~3) — **TRIP-797 묶음 C 로 소비 화면을 옛
 * `ItineraryEditScreen`(features) → 순수 뷰 `EditorView` 로 재조립**한다. 배선 계약(무엇이 서버로
 * 나가고 무엇이 화면에 뜨나)은 그대로고, "누가 그리나"만 h12 통일 편집기로 바뀐다.
 *
 * TRIP-921 로 뷰가 widgets(`map-sheet-shell`)로 승격돼 직접 짜기(`ManualPlanPage`)와 같은 뷰를 쓴다.
 * 이 페이지는 그 뷰가 요구하는 값(center·pins·days·slots·활성 일자·헤더 날짜 문구·콜백)을 채워 넣고,
 * EditorView 가 순수 뷰라 못 가진 세 조각 — 저장 오류 안내·
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
 *  7. **저장 성공은 알리고 떠난다(TRIP-1089)** — 토스트(루트 ToastHost 라 떠나도 남는다) 뒤 이전 화면으로.
 *     단 응답에 위반이 있으면 머문다 — 배지가 보여야 하는데(BR-U3-13 지속 가시화) 복귀지 라이브 허브는
 *     위반을 안 그린다. 미지정 제외 안내는 떠나면 배너가 안 보이므로 성공 시 토스트 문구로 옮긴다.
 *  8. **위반 응답은 요약 게이트가 먼저다(TRIP-1095)** — 그때는 PUT 성공 시점에 토스트 없이
 *     `SaveConflictDialog` 만 띄운다. [그대로 저장] = 7 의 토스트 + 복귀, [고치기] = 7 의 토스트 + 머묾(잠금
 *     해제). 게이트가 떠 있는 동안은 잠금을 유지한다.
 */

// 저장 실패 인라인 문구(INV-4 침묵 금지). 409 두 사유는 재조회한 상태로 갈라 서로 다른 문구를 준다.
const SAVE_CONFIRMED_NOTE = '확정된 일정은 수정할 수 없어요';
const SAVE_GENERATING_NOTE =
  '일정을 만드는 중이에요. 잠시 후 다시 시도해 주세요';
const SAVE_ERROR_NOTE = '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요';
/** 그 날 방문 기록 조회가 404 아닌 실패(TRIP-1748) — 어느 곳을 다녀왔는지 몰라 저장을 막는다. */
const VISITS_ERROR_NOTE = '방문 기록을 불러오지 못해 저장할 수 없어요';
const SAVED_TOAST = '일정을 저장했어요';
// 일정 PUT 진행 중 판정 키 — 장소 추가 화면(스택 위, 편집기는 언마운트 안 됨)의 PUT 도 같은 키다.
const PUT_MUTATION_KEY =
  getPutTripsTripIdItineraryMutationOptions().mutationKey;

// 핀이 없을 때 지도 중심 — 서울 시청(LiveHubView 선례). {0,0} 은 기니만 바다(null-island)라 무의미하다.
const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };

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
  initialDate,
}: {
  tripId: string;
  /** TRIP-753 · i07 라우트(`planb/manual`)가 리터럴 true 로 넘긴다 — 뷰의 i07 얼굴(카드 사이 + 숨김·안내 문구). */
  inTrip?: boolean;
  /** TRIP-1233 · 진입 일자(YYYY-MM-DD, 라우트 `date`). 일정에 없거나 없으면 1일차로 연다. */
  initialDate?: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  // 사용자가 칩으로 고른 칸(null = 아직 안 고름 → 진입 일자 칸).
  const [selectedDayIndex, setActiveDayIndex] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 저장 시 미지정(startAt null) 슬롯이 요청에서 빠지면 그 개수를 담는 안내(INV-4). null = 안내 없음.
  const [unspecifiedNotice, setUnspecifiedNotice] = useState<string | null>(
    null
  );
  // 어느 슬롯의 시각조정 시트가 열렸나(null = 닫힘). 시트 개폐는 뷰가 아니라 여기가 쥔다(순수 뷰 유지,
  // h07 선례) — 조건부 마운트라 닫히면 시트가 트리에서 사라진다.
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  // TRIP-1793 · 「다른 날로 옮기기」 두 단계 — `moving` = 장소 시트(일차 고르기), 확정하면 `pendingMove` = 시각 시트(시각 고르기). 둘 다 조건부
  // 마운트라 어느 쪽을 닫아도 아무것도 안 옮겨진다(시각 없는 슬롯 0). 실제 이동은 시각 시트 [적용] 한 곳에서만 일어난다.
  const [moving, setMoving] = useState<{
    fromDate: string;
    poiId: string;
    ordinal: number;
  } | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    fromDate: string;
    poiId: string;
    ordinal: number;
    toDate: string;
  } | null>(null);
  // TRIP-1795 · 「이름·분류 고치기」 — 장소 시트의 행을 누르면 `moving` 을 비우고 이 시트가 **대신** 열린다(조건부 마운트, 둘이 동시에 안 보인다).
  // 닫으면 아무것도 안 바뀌고, 바뀌는 건 `적용`·`원래대로` 둘뿐이며 둘 다 편집 드래프트에만 반영한다(서버 호출 없음).
  const [renaming, setRenaming] = useState<{
    date: string;
    poiId: string;
    ordinal: number;
  } | null>(null);
  // 저장 연타 잠금 — isPending 은 다음 렌더에야 참이라 같은 틱 연타를 못 막는다(ManualPlanPage 선례).
  // 떠나는 성공에선 풀지 않는다(늦게 온 두 번째 응답이 back 을 한 번 더 부르지 않게).
  const inFlightRef = useRef(false);
  // 위반 요약 게이트(null = 닫힘) — 버튼을 누른 뒤 띄울 토스트 문구를 함께 든다. gateRef 는 그 버튼 연타
  // 잠금(같은 틱 두 누름은 state 로 못 막는다).
  const [conflict, setConflict] = useState<{
    count: number;
    toast: string;
  } | null>(null);
  const gateRef = useRef(false);

  const itinerary = useGetTripsTripIdItinerary(tripId);
  // TError=unknown 으로 열어 onError 의 error 를 axios 판정(isAlreadyRegistered)에 그대로 태운다(h11 선례).
  const save = usePutTripsTripIdItinerary<unknown>();

  const {
    seed,
    seedUnlessDirty,
    deleteSlot,
    deleteSlots,
    reorderSlots,
    adjustSlotTime,
    moveSlot,
    renameSlot,
    undo,
    canUndo,
    topUndoId,
    days,
    editing,
    editingSlot,
  } = useEditorDraft(editingSlotKey);

  useEffect(() => {
    const loaded = itinerary.data?.days;
    if (loaded !== undefined) seedUnlessDirty(loaded);
  }, [itinerary.data, seedUnlessDirty]);

  // 진입 칸은 매 렌더 스토어 days 에서 다시 찾는다 — 초기값에 굳히면 로딩(days=[])·옛 드래프트 순간의
  // 칸으로 고정된다(LiveItineraryPage 선례). 못 찾으면 -1 → 0(1일차). 칩 선택이 이긴다.
  const activeDayIndex =
    selectedDayIndex ??
    Math.max(
      0,
      days.findIndex((day) => day.date === initialDate)
    );
  // 활성 일자 — 방문 조회 훅(아래)이 조기 반환보다 위에서 이 값을 필요로 한다(LiveItineraryPage 선례).
  // 로딩 중엔 days=[] 라 '' 가 되어 방문 조회가 꺼진다.
  const activeDate = days[activeDayIndex]?.date ?? '';

  // 완료 슬롯 잠금 실연동(AC-11) — 그 날 방문 기록을 조회한다. 훅 규칙상 조기 반환 위에서 무조건
  // 선언하고, 활성 일자가 아직 없으면(로딩) enabled=false 로 꺼 둔다(LiveItineraryPage 패턴).
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, activeDate, {
    query: { enabled: activeDate !== '' },
  });
  // 그 날 완료 여부를 모르면(첫 응답 전 · 404 아닌 실패) 잠금이 비어 완료 카드를 옮기거나 지운 초안이 될 수 있다 — 서버
  // PUT(전체 교체)엔 완료 방문 가드가 없어 화면이 유일한 그물이다(TRIP-1748). 실패면 안내 + [다시 시도]. 404 는 빈 목록 그대로.
  const visitsFailed = visits.isError && !isNotFound(visits.error);
  const activeUnknown = activeDate !== '' && (visits.isPending || visitsFailed);
  // 보는 동안 모름이었던 날을 기억한다 — 그 날 초안을 든 채 다른 날로 옮겨도 PUT 은 모든 날을 싣는다(03b W1). 캐시는
  // gc 로 그 날의 실패를 잊으므로 페이지가 쥔다. 다시 그 날을 보고 알게 되면 지운다.
  const unknownDatesRef = useRef(new Set<string>());
  useEffect(() => {
    if (activeDate === '') return;
    if (activeUnknown) unknownDatesRef.current.add(activeDate);
    else unknownDatesRef.current.delete(activeDate);
  }, [activeDate, activeUnknown]);

  // TRIP-1792 · 되돌리기 — 스토어가 한 장을 되돌리고 날짜를 알려주면 그 일차로 따라간다(다른 날 편집이면 눌러도 화면이 안 변해 보인다).
  // 칩 전환은 보는 날과 비교하지 않고 항상 건다 — 안내 바 콜백은 띄운 시점의 값을 쥐어 "보는 날"이 낡을 수 있다.
  function undoTo(expectId?: number): void {
    const date = undo(expectId);
    if (date === null) return;
    // 열린 시트가 쥔 ordinal 은 되살아난 같은 장소 때문에 다른 카드를 가리킬 수 있다 — 안내 바는 시트 위에 떠 있어 눌린다(TRIP-1812).
    setEditingSlotKey(null);
    setMoving(null);
    setPendingMove(null);
    setRenaming(null);
    const index = days.findIndex((day) => day.date === date);
    if (index !== -1) setActiveDayIndex(index);
  }

  // 끌어서 삭제·선택 빼기 공통 — 삭제를 부른 **뒤** 맨 위 번호가 달라졌으면(정말 쌓였으면) 안내 바를 띄운다. 안 지워진 시도
  // (고정·없는 곳)엔 바가 없다. 맨 위 번호는 핸들러·콜백 안에서만 읽는다(렌더 중이면 React Compiler 가 굳힌다).
  function removeWithUndoBar(remove: () => void, count: number): void {
    const before = topUndoId();
    remove();
    const barId = topUndoId();
    if (barId === null || barId === before) return;
    showToast({
      testID: 'editor-undo-bar',
      message: `${count}곳을 뺐어요`,
      action: { label: '되돌리기', onPress: () => undoTo(barId) },
    });
  }

  // 저장 뒤 복귀와 헤더 ‹ 공통 — 히스토리가 없으면(딥링크) 얼굴별 목적지로 replace(h12 일정 탭 · i07 라이브 허브).
  function leaveAfterSave(): void {
    // 저장 연타의 둘째 탭이 돌아간 h16 「돌아가기」까지 눌러 그 화면을 건너뛰지 않게(통합 QA O2).
    openPressGuardWindow();
    goBackOr(router, {
      pathname: inTrip ? '/trips/[tripId]/live' : '/trips/[tripId]/itinerary',
      params: { tripId },
    });
  }

  function handleSave(): void {
    if (inFlightRef.current) return;
    // 완료 여부를 모르는 날이 있으면 저장하지 않고 그 날로 옮긴다(TRIP-1748) — 보고 있는 날이면 제자리(실패면 안내가 이유를
    // 말하고, 조회 중이면 곧 풀린다), 다른 날이면 그 날의 안내·다시 시도를 보인다. 보지 않은 날은 편집할 수도 없었다.
    // 보고 있는 날은 누른 순간의 캐시 상태로 본다 — 렌더 값·기억(effect)은 응답 직후 화면이 다시 그려지기 전까지
    // 늦다(03b2 W2 · CI 실측: 응답이 캐시에 들어왔는데 다시 그려지기 전에 누르면 막혔다). 보고 있는 날은 관찰자가
    // 있어 캐시에서 지워지지 않는다.
    const activeState =
      activeDate === ''
        ? undefined
        : queryClient.getQueryState(
            getGetTripsTripIdVisitsDaysDayQueryKey(tripId, activeDate)
          );
    const activeUnknownNow =
      activeState === undefined
        ? activeUnknown
        : activeState.status === 'pending' ||
          (activeState.status === 'error' && !isNotFound(activeState.error));
    const unknownDayIndex = days.findIndex((day) =>
      day.date === activeDate
        ? activeUnknownNow
        : unknownDatesRef.current.has(day.date)
    );
    if (unknownDayIndex !== -1) {
      setActiveDayIndex(unknownDayIndex);
      return;
    }
    // 장소 추가 PUT 이 응답 전이면 무반응 — 지금 초안엔 그 장소가 없어 전체 교체 PUT 이 추가분을 지운다(TRIP-1519).
    // 응답이 오면 편집기 초안이 갱신돼(시드/삽입) 이어 누른 저장은 추가분을 싣는다. 진행 표시는 Figma 공백.
    if (queryClient.isMutating({ mutationKey: PUT_MUTATION_KEY }) > 0) return;
    inFlightRef.current = true;
    setSaveError(null);
    // 미지정(startAt null) 슬롯은 buildEditItineraryRequest 가 요청에서 뺀다 — 몇 곳이 빠지는지 미리
    // 세어 안내한다(INV-4 침묵 금지). 스토어 상태 타입은 서버(non-nullable)지만 런타임엔 null 이 흐른다
    // (미지정을 만드는 프로덕션 경로는 h13/TRIP-798 몫 — 지금은 테스트 픽스처가 트리거를 대신 심는다).
    const droppedCount = (days as EditorDaysItem[])
      .flatMap((day) => day.slots)
      .filter((slot) => slot.startAt === null).length;
    // 안내는 결과가 나온 뒤에 세운다 — 성공이면 토스트 문구로, 실패면 배너로(요청 중 과거형 배너 깜빡임 방지).
    setUnspecifiedNotice(null);

    save.mutate(
      { tripId, data: buildEditItineraryRequest(days) },
      {
        onSuccess: (data) => {
          // 최신 Itinerary(서버 재검증 결과)를 조회 캐시에 직접 써넣는다 — 재조회 0회. 시드 useEffect 가
          // itinerary.data 참조 변화로 다시 돌아 스토어를 재-시드하고, 새 hasViolation 배지가 지속된다.
          // 시드 effect 는 dirty 초안을 건너뛰므로(TRIP-1498) 자기 저장 응답은 여기서 먼저 시드한다(dirty 도 내려간다).
          seed(data.days);
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          );
          // 떠나면 배너가 안 보이므로 제외 안내는 토스트 문구로 옮긴다(결정 2). 실패 경로는 배너 그대로.
          const toast =
            droppedCount > 0
              ? `${SAVED_TOAST} · 시간 미정 ${droppedCount}곳은 빠졌어요`
              : SAVED_TOAST;
          const violations = data.days
            .flatMap((day) => day.slots)
            .filter((slot) => slot.hasViolation).length;
          if (violations > 0) {
            // 토스트·이동은 게이트 버튼이 정한다 — 잠금도 그때까지 유지(떠 있는 동안 저장 재누름 차단).
            gateRef.current = true;
            setConflict({ count: violations, toast });
            return;
          }
          showToast({ message: toast, testID: 'itinerary-edit-saved' });
          leaveAfterSave();
        },
        onError: (error) => {
          inFlightRef.current = false;
          if (droppedCount > 0) {
            setUnspecifiedNotice(
              `시간대를 정하지 않은 ${droppedCount}곳은 저장에서 빠졌어요`
            );
          }
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

  // [그대로 저장] = 토스트 + 복귀(잠금 유지) · [고치기] = 토스트 + 머묾(재-시드된 배지를 보고 고쳐 다시
  // 저장할 수 있게 잠금을 푼다, 결정 1).
  function closeConflict(leave: boolean): void {
    if (!gateRef.current || conflict === null) return;
    gateRef.current = false;
    setConflict(null);
    showToast({ message: conflict.toast, testID: 'itinerary-edit-saved' });
    if (leave) {
      leaveAfterSave();
      return;
    }
    inFlightRef.current = false;
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
        icon={<InfoCircleGlyph size={32} color="primaryText" />}
        title="아직 편집할 일정이 없어요"
        description="일정을 만들면 여기에서 수정할 수 있어요"
      />
    );
  }

  if (state.kind === 'failed') {
    return (
      <EditFace
        testID="itinerary-edit-failed"
        icon={<AlertCircleGlyph size={32} />}
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
    visits.data ?? { visits: [] },
    activeDate,
    activeSlots.map((slot) => slot.poiId)
  );
  const completedSlotKeys = completedPoiIds.map((poiId) =>
    buildSlotKey(activeDate, poiId)
  );

  // TRIP-1793 · 옮기기 시트 재료 — 열린 시트의 슬롯이 드래프트에 실재할 때만 시트를 마운트한다(조건부, 위 시각 시트와 같은 방식).
  const slotIn = (date: string, poiId: string, ordinal: number) => {
    const slots = days.find((day) => day.date === date)?.slots ?? [];
    return slots[findSlotIndex(slots, poiId, ordinal)];
  };
  const movingSlot =
    moving === null
      ? undefined
      : slotIn(moving.fromDate, moving.poiId, moving.ordinal);
  const movingDayNumber =
    moving === null ? 0 : days.findIndex((d) => d.date === moving.fromDate) + 1;
  const moveOptions =
    moving === null
      ? { options: [], initialDate: null }
      : buildMoveDayOptions(days, moving.fromDate, moving.poiId);
  // 옮기기 가능 여부 — 고정(`isFixed`)·방문 완료·하루 일정은 날짜 섹션 없이 고치기 행만 연다. `moveSlot` 은 고정을 안 막으므로 이 판정이 유일한 방어선이다.
  const canMove =
    movingSlot !== undefined &&
    moving !== null &&
    !movingSlot.isFixed &&
    !completedSlotKeys.includes(buildSlotKey(moving.fromDate, moving.poiId)) &&
    days.length > 1;
  const renamingSlot =
    renaming === null
      ? undefined
      : slotIn(renaming.date, renaming.poiId, renaming.ordinal);
  function closeRename(): void {
    // 시트가 사라진 자리 아래 「일정 저장하기」에 둘째 탭이 닿지 않게(TRIP-1793 D4 와 같은 처방).
    openPressGuardWindow();
    setRenaming(null);
  }
  function applyRename(
    target: { date: string; poiId: string; ordinal: number },
    patch: Parameters<typeof renameSlot>[2]
  ): void {
    openPressGuardWindow();
    renameSlot(target.date, target.poiId, patch, target.ordinal);
    setRenaming(null);
  }
  const pendingSlot =
    pendingMove === null
      ? undefined
      : slotIn(pendingMove.fromDate, pendingMove.poiId, pendingMove.ordinal);
  const pendingTargetSlots =
    pendingMove === null
      ? []
      : (days.find((day) => day.date === pendingMove.toDate)?.slots ?? []);
  const pendingDefault = suggestNextSlotTime(
    pendingTargetSlots[pendingTargetSlots.length - 1]
  );

  // 편집 중인 슬롯의 **현재 드래프트 값**을 찾아 시트에 시드한다 — 시트가 열렸고 그 슬롯이 드래프트에
  // 실재할 때만 마운트한다(둘 중 하나라도 없으면 안 그린다).

  return (
    <View className="flex-1">
      <EditorView
        center={center}
        pins={pins}
        days={buildPlanDayTabs(state.days)}
        slots={activeSlots as EditorSlot[]}
        activeDayIndex={activeDayIndex}
        activeDate={activeDate}
        dateLabel={formatCoPickDayHeader(activeDate)}
        onSelectDay={setActiveDayIndex}
        onBack={guardPress(leaveAfterSave)}
        onPressTimeChip={setEditingSlotKey}
        onPressAddPlace={() =>
          router.push({
            pathname: '/trips/[tripId]/itinerary/manual/add',
            // 활성 일자 — 시트 제목·담을 날이 이 날이 된다(TRIP-1233).
            params: { tripId, date: activeDate },
          })
        }
        onPressAddBetween={(precedingIndex) =>
          router.push({
            pathname: '/trips/[tripId]/itinerary/manual/add',
            params: {
              tripId,
              insertAfter: String(precedingIndex),
              // 활성 일자 — insertAfter 는 이 날 기준 index 다(TRIP-1115, PlaceAddPage 가 이 날에 담는다).
              date: activeDate,
            },
          })
        }
        onSave={handleSave}
        // 끌기 결과에서 방문 완료 행을 원래 자리로 되돌린 뒤 스토어에 넣는다(TRIP-753 AC-8 · 고정 행은 끌기 결과 그대로 TRIP-1250). 규칙은 startAt 을
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
        onDeleteViaDrag={(poiId, ordinal) =>
          removeWithUndoBar(() => deleteSlot(activeDate, poiId, ordinal), 1)
        }
        onDeleteSelected={(poiIds) =>
          removeWithUndoBar(
            () => deleteSlots(activeDate, poiIds),
            poiIds.length
          )
        }
        undo={{ enabled: canUndo, onPress: () => undoTo() }}
        // TRIP-1793 5-b W2 — 그 날 방문 기록을 모르면(응답 전·404 아닌 실패) 완료 카드도 잠기지 않아 ⋯ 로 옮길 수 있고,
        // 옮긴 뒤엔 출발 날에 그 카드가 없어 저장 가드(unknownDatesRef)도 못 잡는다 → 모르는 동안은 ⋯ 를 안 준다.
        onPressMore={
          activeUnknown
            ? undefined
            : (poiId, ordinal) =>
                setMoving({ fromDate: activeDate, poiId, ordinal })
        }
        completedSlotKeys={completedSlotKeys}
        inTrip={inTrip}
      />

      {/* 순수 뷰가 못 가진 인라인 안내 — 저장 오류·미지정 제외(둘 다 INV-4). 지도·시트 위에 얹는 배너
          (Figma 프레임 없는 발명 표면). testID 는 EditorView 가 아니라 페이지 소유다(02a-C ★C5). */}
      {saveError !== null || unspecifiedNotice !== null || visitsFailed ? (
        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-[96px] items-center gap-xs px-lg"
        >
          {visitsFailed ? (
            <View
              testID="itinerary-edit-visits-error"
              className="w-full flex-row items-center justify-between gap-sm rounded-card bg-primary-pale px-md py-sm"
            >
              <Text className="flex-1 font-noto text-caption text-primary-text">
                {VISITS_ERROR_NOTE}
              </Text>
              <Pressable
                testID="itinerary-edit-visits-retry"
                accessibilityRole="button"
                onPress={() => void visits.refetch()}
              >
                <Text className="font-noto-bold text-caption font-bold text-primary-text">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
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
          title="시간대 조정"
          startAt={editingSlot.startAt}
          endAt={editingSlot.endAt}
          placeSummary={{
            imageUrl: editingSlot.imageUrl ?? null,
            poiId: editingSlot.poiId,
            category: slotDisplayCategory(editingSlot),
            name: slotDisplayName(editingSlot) ?? '',
          }}
          onApply={(patch) => {
            adjustSlotTime(editing.date, editing.poiId, patch, editing.ordinal);
            setEditingSlotKey(null);
          }}
          onCancel={() => setEditingSlotKey(null)}
          testIDPrefix="itinerary-edit-time"
          labels={{ start: '시작', end: '종료' }}
        />
      ) : null}

      {moving !== null && movingSlot !== undefined ? (
        <MoveDaySheet
          name={slotDisplayName(movingSlot) ?? ''}
          photo={{
            imageUrl: movingSlot.imageUrl ?? null,
            poiId: movingSlot.poiId,
            category: slotDisplayCategory(movingSlot),
          }}
          subtitle={[
            `${movingDayNumber}일차`,
            `${movingSlot.startAt.slice(0, 5)}–${movingSlot.endAt.slice(0, 5)}`,
            ...movingSlot.tags,
          ].join(' · ')}
          move={
            canMove
              ? {
                  options: moveOptions.options,
                  initialDate: moveOptions.initialDate,
                  onConfirm: (toDate) => {
                    // 장소 시트 [옮기기] 연타의 둘째 탭이 시각 시트가 올라오기 전 아래 「일정 저장하기」에 닿지 않게(TRIP-1793 D4).
                    openPressGuardWindow();
                    setPendingMove({ ...moving, toDate });
                    setMoving(null);
                  },
                }
              : null
          }
          onPressRename={() => {
            // 행 누름 직후의 둘째 탭이 새 시트 자리 아래 「일정 저장하기」에 닿지 않게 — 시트 교체 직전에 창을 연다(TRIP-1795 AC-15).
            openPressGuardWindow();
            setRenaming({
              date: moving.fromDate,
              poiId: moving.poiId,
              ordinal: moving.ordinal,
            });
            setMoving(null);
          }}
          onClose={() => {
            // 머리 X 연타의 둘째 탭이 닫힌 시트 아래 「일정 저장하기」에 닿지 않게(TRIP-1793 D4, 5-b 경고-1).
            openPressGuardWindow();
            setMoving(null);
          }}
        />
      ) : null}

      {renaming !== null && renamingSlot !== undefined ? (
        <RenameSlotSheet
          name={slotDisplayName(renamingSlot) ?? ''}
          category={slotDisplayCategory(renamingSlot)}
          // 분류 칩은 **원본** 분류가 닫힌 10종일 때만 — 숙소 등은 이름만 고친다(판정은 원본, 표시 분류가 아니다).
          categoryEditable={Object.values(PoiCategory).some(
            (candidate) => candidate === renamingSlot.category
          )}
          canReset={
            !!renamingSlot.displayName?.trim() ||
            !!renamingSlot.displayCategory?.trim()
          }
          onApply={(patch) =>
            applyRename(renaming, {
              displayName: patch.displayName,
              // 분류를 못 고치는 장소는 서버가 준 표시 분류를 건드리지 않고 그대로 둔다.
              displayCategory:
                patch.displayCategory ?? renamingSlot.displayCategory ?? null,
            })
          }
          onReset={() =>
            applyRename(renaming, {
              displayName: null,
              displayCategory: null,
            })
          }
          onClose={closeRename}
        />
      ) : null}

      {/* 시각 시트 — 기본값은 대상 날 마지막 슬롯 기준(`suggestNextSlotTime`, 장소 추가와 같은 규칙). 닫으면 옮기지 않는다. */}
      {pendingMove !== null && pendingSlot !== undefined ? (
        <TimeSheet
          title="시간대 조정"
          startAt={pendingDefault.startAt}
          endAt={pendingDefault.endAt}
          placeSummary={{
            imageUrl: pendingSlot.imageUrl ?? null,
            poiId: pendingSlot.poiId,
            category: slotDisplayCategory(pendingSlot),
            name: slotDisplayName(pendingSlot) ?? '',
          }}
          onApply={(patch) => {
            moveSlot(
              pendingMove.fromDate,
              pendingMove.toDate,
              pendingMove.poiId,
              patch,
              pendingMove.ordinal
            );
            const toIndex = days.findIndex(
              (day) => day.date === pendingMove.toDate
            );
            if (toIndex !== -1) {
              setActiveDayIndex(toIndex);
              showToast({
                testID: 'editor-move-toast',
                message: `${toIndex + 1}일차로 옮겼어요`,
              });
            }
            setPendingMove(null);
          }}
          onCancel={() => setPendingMove(null)}
          testIDPrefix="editor-move-time"
          labels={{ start: '시작', end: '종료' }}
        />
      ) : null}

      {conflict !== null ? (
        <SaveConflictDialog
          count={conflict.count}
          confirmLabel="그대로 저장"
          onConfirm={() => closeConflict(true)}
          onBack={() => closeConflict(false)}
        />
      ) : null}
    </View>
  );
}
