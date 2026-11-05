/**
 * TRIP-1787 · g03 여행 설정 배선 — 내 여행 카드 ⋯ 「여행 설정」(TRIP-1786)이 도착하는 화면.
 *
 * 흐름: `GET /trips/{id}` → 이름·동행·일과 입력(이 화면이 쥔 "바꾼 칸") → [저장]이 `PATCH /trips/{id}` 통째 교체 본문
 * (`toEditTripRequest`)을 보낸다. 서버는 받은 본문 전체로 덮어쓰므로 안 바꾼 칸도 GET 값을 다시 싣는다.
 *
 * 규칙:
 *  - **본문은 누르는 순간 만든다** — 저장 핸들러 안에서 그 순간의 최신 여행 캐시(`getQueryData`)와 현재 입력으로 조립한다
 *    (렌더 때 만든 본문·마운트 때 굳힌 여행을 쓰면 다른 표면이 바꾼 예산·목적지를 되돌린다). 렌더 중 `getQueryData` 로
 *    판정하지 않는다(React Compiler 가 첫 값으로 굳힌다 — repo-traps).
 *  - **잠금은 `trip.status === 'ENDED'`** (서버 409 와 같은 기준). `classifyTripPhase` 가 아니다 — 날짜 지난 작성중은
 *    'draft' 라 잠금이 안 걸려 서버 409 를 맞는다. 저장 응답 409 도 같은 잠금.
 *  - **바뀐 값(dirty)은 매 렌더 파생** — 원래대로 되돌리면 다시 꺼진다. 안 바꾼 일과는 서버 원문(`HH:mm:ss`)을 그대로 보낸다.
 *  - 삭제 노출·확인 문구는 내 여행 목록 ⋯ 「삭제」와 같은 판정(`classifyTripPhase` draft·upcoming). 연타 잠금은 ref.
 *  - 저장·삭제로 화면을 떠나는 순간 `openPressGuardWindow()` — 연타 둘째 탭이 뒤 목록 카드를 누르지 않게(통합 QA D2·D3).
 *    삭제는 목록 캐시에서 그 여행을 바로 뺀다(무효화만 하면 재조회 전까지 지운 카드가 남아 눌린다).
 */
import { isAxiosError } from 'axios';
import { type ReactElement, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { isNotFound } from '@/shared/api';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdQueryKey,
  useDeleteTripsTripId,
  useGetTripsTripId,
  usePatchTripsTripId,
} from '@/shared/api/index.hooks';
import type { CompanionType, Trip } from '@/shared/api/index.schemas';
import { goBackOr } from '@/shared/lib/goBackOr';
import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';
import { useSeoulToday } from '@/shared/lib/useSeoulToday';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import { showToast } from '@/shared/ui/Toast';
import {
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  normalizeDayWindow,
  type DayWindow,
} from '@/features/create-trip';
import {
  classifyTripPhase,
  formatDateRangeWithDow,
  formatNightsLabel,
  pickRegionCover,
  TripDeleteDialog,
  tripItinerarySummary,
} from '@/entities/trip';
import {
  clampParty,
  CompanionEditSheet,
  DayWindowEditSheet,
} from '@/widgets/trip-edit-sheets';

import { toEditTripRequest } from '../model/editTripRequest';
import { titleViolation } from '../model/titleRule';
import { TripSettingsHeader, TripSettingsView } from './TripSettingsView';

const DELETE_DONE_HREF = '/(tabs)/itinerary';

/** 서버 일과(`HH:mm[:ss]`, null 가능) → 시트·표시용 `HH:mm`(정한 값만 키). */
function serverDayWindow(trip: Trip): DayWindow {
  return {
    ...(trip.dayStartAt ? { dayStartAt: trip.dayStartAt.slice(0, 5) } : {}),
    ...(trip.firstDayStartAt
      ? { firstDayStartAt: trip.firstDayStartAt.slice(0, 5) }
      : {}),
    ...(trip.lastDayEndAt
      ? { lastDayEndAt: trip.lastDayEndAt.slice(0, 5) }
      : {}),
  };
}

/** 하루 시작 09:00 은 "없음"과 같게 보고 세 칸을 비교한다. */
function sameDayWindow(a: DayWindow, b: DayWindow): boolean {
  const left = normalizeDayWindow(a);
  const right = normalizeDayWindow(b);
  return (
    left.dayStartAt === right.dayStartAt &&
    left.firstDayStartAt === right.firstDayStartAt &&
    left.lastDayEndAt === right.lastDayEndAt
  );
}

function Face({
  testID,
  message,
  onBack,
  onRetry,
  retryTestID,
}: {
  testID: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
  retryTestID?: string;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-canvas">
      <TripSettingsHeader onBack={onBack} />
      <View className="flex-1 items-center justify-center gap-md px-lg">
        <Text testID={testID} className="font-noto text-body text-muted">
          {message}
        </Text>
        {onRetry ? (
          <Pressable
            testID={retryTestID}
            accessibilityRole="button"
            onPress={onRetry}
            className="rounded-button border border-hairline-strong px-lg py-sm"
          >
            <Text className="font-noto-bold text-label font-bold text-ink">
              다시 시도
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

export function TripSettingsPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const trip = useGetTripsTripId(tripId);
  const goBack = guardPress(() => goBackOr(router, shellTabHref('itinerary')));

  if (trip.data === undefined) {
    if (trip.isPending) {
      return (
        <Face
          testID="trip-settings-loading"
          message="불러오는 중이에요"
          onBack={goBack}
        />
      );
    }
    if (isNotFound(trip.error)) {
      return (
        <Face
          testID="trip-settings-notfound"
          message="여행을 찾을 수 없어요"
          onBack={goBack}
        />
      );
    }
    return (
      <Face
        testID="trip-settings-fetch-error"
        message="여행을 불러오지 못했어요"
        onBack={goBack}
        onRetry={() => void trip.refetch()}
        retryTestID="trip-settings-fetch-retry"
      />
    );
  }
  return <TripSettingsBody tripId={tripId} trip={trip.data} onBack={goBack} />;
}

function TripSettingsBody({
  tripId,
  trip,
  onBack,
}: {
  tripId: string;
  trip: Trip;
  onBack: () => void;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = useSeoulToday();

  // 바꾼 칸 — 없으면 "안 바꿈"(서버 값을 보인다).
  const [titleEdit, setTitleEdit] = useState<string | undefined>(undefined);
  const [partyEdit, setPartyEdit] = useState<number | undefined>(undefined);
  const [companionEdit, setCompanionEdit] = useState<CompanionType | undefined>(
    undefined
  );
  const [dayWindowEdit, setDayWindowEdit] = useState<DayWindow | undefined>(
    undefined
  );
  const [conflict, setConflict] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // 시트 드래프트 — 열 때 현재 표시값에서 시드하고 [적용]에서만 커밋한다(위저드와 같은 약속).
  const [companionSheetOpen, setCompanionSheetOpen] = useState(false);
  const [draftParty, setDraftParty] = useState(trip.party);
  const [draftCompanion, setDraftCompanion] = useState<
    CompanionType | undefined
  >(undefined);
  const [dayWindowSheetOpen, setDayWindowSheetOpen] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // 연타 잠금은 ref — isPending 은 한 틱 늦게 알려져 같은 틱 두 번째 press 를 못 막는다.
  const deletingRef = useRef(false);
  const savingRef = useRef(false);

  // 캐시 갱신은 훅 옵션에 둔다 — 호출별 콜백(`mutate(…, {onSuccess})`)은 응답 전에 화면을 떠나면 안 불린다(TRIP-1677 선례).
  const patch = usePatchTripsTripId({
    mutation: {
      onSuccess: (saved, _vars, _onMutateResult, context) => {
        context.client.setQueryData(getGetTripsTripIdQueryKey(tripId), saved);
        void context.client.invalidateQueries({
          queryKey: getGetTripsQueryKey(),
        });
      },
    },
  });
  // 목록 캐시에서 바로 빼고 다시 받는다 — 훅 옵션이라 호출별 onSuccess(이동)보다 먼저 돈다.
  const dropFromList = (client: QueryClient): void => {
    client.setQueryData<Trip[]>(getGetTripsQueryKey(), (list) =>
      list?.filter((one) => one.tripId !== tripId)
    );
    void client.invalidateQueries({ queryKey: getGetTripsQueryKey() });
  };
  const deleteTrip = useDeleteTripsTripId({
    mutation: {
      onSuccess: (_data, _vars, _onMutateResult, context) =>
        dropFromList(context.client),
      // 이미 없는 여행(404)도 목록에선 지워져야 한다.
      onError: (error, _vars, _onMutateResult, context) => {
        if (isNotFound(error)) dropFromList(context.client);
      },
    },
  });

  const title = titleEdit ?? trip.title;
  const party = partyEdit ?? trip.party;
  const companionType = companionEdit ?? trip.companionType ?? undefined;
  const serverWindow = serverDayWindow(trip);
  const dayWindow = dayWindowEdit ?? serverWindow;

  const locked = trip.status === 'ENDED' || conflict;
  const titleInvalid = titleViolation(title) !== null;
  const dayWindowDirty =
    dayWindowEdit !== undefined && !sameDayWindow(dayWindowEdit, serverWindow);
  const dirty =
    title !== trip.title ||
    (partyEdit !== undefined && partyEdit !== trip.party) ||
    (companionEdit !== undefined && companionEdit !== trip.companionType) ||
    dayWindowDirty;
  const canSave = dirty && !titleInvalid && !locked && !patch.isPending;

  const summary = tripItinerarySummary(trip);
  const phase = classifyTripPhase(trip, summary.status, today);
  const deletable = phase === 'draft' || phase === 'upcoming';

  const save = (): void => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaveFailed(false);
    // 누르는 순간의 최신 여행 + 현재 입력 — 렌더 때 만든 본문·마운트 스냅샷을 쓰지 않는다.
    const latest =
      queryClient.getQueryData<Trip>(getGetTripsTripIdQueryKey(tripId)) ?? trip;
    const data = toEditTripRequest(latest, {
      title: titleEdit,
      party: partyEdit,
      companionType: companionEdit,
      dayWindow: dayWindowDirty ? dayWindowEdit : undefined,
    });
    patch.mutate(
      { tripId, data },
      {
        onSuccess: () => {
          showToast({
            message: '여행 설정을 저장했어요',
            testID: 'trip-settings-saved-toast',
          });
          openPressGuardWindow();
          goBackOr(router, shellTabHref('itinerary'));
        },
        onError: (error) => {
          if (isAxiosError(error) && error.response?.status === 409) {
            setConflict(true);
          } else {
            setSaveFailed(true);
          }
        },
        onSettled: () => {
          savingRef.current = false;
        },
      }
    );
  };

  const openCompanionSheet = (): void => {
    setDraftParty(party);
    setDraftCompanion(companionType);
    setCompanionSheetOpen(true);
  };
  const pickCompanion = (type: CompanionType): void => {
    setDraftCompanion(type);
    setDraftParty((current) => clampParty(type, current));
  };
  const applyCompanion = (): void => {
    setPartyEdit(draftParty);
    if (draftCompanion !== undefined) setCompanionEdit(draftCompanion);
    setCompanionSheetOpen(false);
  };

  const confirmDelete = (): void => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleteFailed(false);
    const done = (): void => {
      openPressGuardWindow();
      router.dismissTo(DELETE_DONE_HREF);
    };
    deleteTrip.mutate(
      { tripId },
      {
        onSuccess: done,
        // 이미 없는 여행(404)은 성공과 같다.
        onError: (error) =>
          isNotFound(error) ? done() : setDeleteFailed(true),
        onSettled: () => {
          deletingRef.current = false;
        },
      }
    );
  };

  const sameDay = trip.startDate === trip.endDate;

  return (
    <View className="flex-1">
      <TripSettingsView
        title={title}
        titleInvalid={titleInvalid}
        locked={locked}
        companionLabel={companionType ?? '미정'}
        partyLabel={`${party}명`}
        dayRangeLabel={`${dayWindow.dayStartAt ?? DEFAULT_DAY_START} ~ ${DEFAULT_DAY_END}`}
        dayFirstLabel={
          dayWindow.firstDayStartAt !== undefined
            ? `첫날 ${dayWindow.firstDayStartAt}부터`
            : undefined
        }
        dayEndLabel={
          dayWindow.lastDayEndAt !== undefined
            ? `마지막 날 ${dayWindow.lastDayEndAt}까지`
            : undefined
        }
        periodLabel={formatDateRangeWithDow(
          trip.startDate,
          trip.endDate,
          today
        )}
        nightsLabel={formatNightsLabel(trip.startDate, trip.endDate)}
        destinationsLabel={[...trip.destinations]
          .sort((a, b) => a.seq - b.seq)
          .map((one) => one.region)
          .join(' · ')}
        cover={pickRegionCover(trip.destinations)}
        canSave={canSave}
        saveFailed={saveFailed}
        deletable={deletable}
        onBack={onBack}
        onChangeTitle={setTitleEdit}
        onPressCompanion={openCompanionSheet}
        onPressDayWindow={() => setDayWindowSheetOpen(true)}
        onSave={save}
        onPressDelete={() => {
          setDeleteFailed(false);
          setDeleteOpen(true);
        }}
      />
      {companionSheetOpen ? (
        <CompanionEditSheet
          party={draftParty}
          companionType={draftCompanion}
          onChangeParty={(next) => setDraftParty(Math.max(1, next))}
          onSelectCompanion={pickCompanion}
          onApply={applyCompanion}
          onClose={() => setCompanionSheetOpen(false)}
        />
      ) : null}
      {dayWindowSheetOpen ? (
        <DayWindowEditSheet
          value={dayWindow}
          sameDay={sameDay}
          onApply={(next) => {
            setDayWindowEdit(next);
            setDayWindowSheetOpen(false);
          }}
          onClose={() => setDayWindowSheetOpen(false)}
        />
      ) : null}
      {deleteOpen ? (
        <TripDeleteDialog
          failed={deleteFailed}
          confirmed={summary.status === 'CONFIRMED'}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </View>
  );
}
