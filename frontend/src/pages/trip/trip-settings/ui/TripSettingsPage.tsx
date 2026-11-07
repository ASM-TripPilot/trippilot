/**
 * TRIP-1787 · g03 여행 설정 배선 — 내 여행 카드 ⋯ 「여행 설정」(TRIP-1786)이 도착하는 화면.
 *
 * 흐름: `GET /trips/{id}` → 이름·기간·동행·일과·커버 입력(이 화면이 쥔 "바꾼 칸") → [저장]이 `PATCH /trips/{id}` 통째 교체 본문
 * (`toEditTripRequest`)을 보낸다. 서버는 받은 본문 전체로 덮어쓰므로 안 바꾼 칸도 GET 값을 다시 싣는다.
 *
 * TRIP-1788 — **기간**: 시작 전 여행만 눌러서 고친다(시트 [적용]이 드래프트 `periodEdit` 로 커밋, 저장 때 같이 나간다).
 * 일수가 바뀌는 [적용]은 드래프트가 아니라 확인창 → 확정 시 `discardItinerary:true` + 새 기간으로 곧바로 PATCH → 같은 여행의
 * 일정 방식 선택으로 `replace`(일정만 다시 짠다). 저장 409 는 `error.code` 로 갈라 기간만 잠근다. **커버**: 번들 그림 중 골라
 * `coverKey` 로 저장(`null` = 첫 여행지 자동). 캐시 갱신(날짜 이동 = 자식 조회 무효화, 일정 버림 = 자식 조회 비우기)은 훅 옵션.
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
import { type Href, useRouter } from 'expo-router';

import { isNotFound } from '@/shared/api';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdQueryKey,
  useDeleteTripsTripId,
  useGetTripsTripId,
  usePatchTripsTripId,
} from '@/shared/api/index.hooks';
import type {
  CompanionType,
  EditTripRequest,
  Trip,
} from '@/shared/api/index.schemas';
import { goBackOr } from '@/shared/lib/goBackOr';
import { shiftMonth } from '@/shared/lib/monthGrid';
import {
  guardPress,
  openPressGuardWindow,
  respectPressGuard,
} from '@/shared/lib/pressGuard';
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
  TripDeleteDialog,
  tripCoverLabel,
  tripCoverSource,
  tripItinerarySummary,
} from '@/entities/trip';
import {
  clampParty,
  CompanionEditSheet,
  DayWindowEditSheet,
  PeriodEditSheet,
} from '@/widgets/trip-edit-sheets';

import { toEditTripRequest, type TripEdits } from '../model/editTripRequest';
import {
  droppedDestinations,
  droppedNotice,
  isTripChildKey,
  nightsBetween,
  periodConflictCode,
  periodHint,
  periodLock,
  pickLengthRange,
  shiftedEndDate,
  type PeriodLock,
} from '../model/periodRules';
import { titleViolation } from '../model/titleRule';
import { CoverPickSheet } from './CoverPickSheet';
import { PeriodLengthDialog } from './PeriodLengthDialog';
import { TripSettingsHeader, TripSettingsView } from './TripSettingsView';

const DELETE_DONE_HREF = '/(tabs)/itinerary';

const NOTE_SHIFT = '일수는 그대로 두고 시작일만 옮겨요';
const NOTE_LENGTH = '끝나는 날을 골라요 · 일수가 바뀌면 일정을 다시 짜요';

interface Period {
  startDate: string;
  endDate: string;
}

/** 서버가 기간 변경을 거절한 사유(409 `error.code`) → 안내 문구와, 기간만 잠글지. 그 밖의 코드는 null(화면 전체 잠금 등 종전 처리). */
function periodRejection(
  code: string | null
): { text: string; lock: 'started' | 'generating' | null } | null {
  switch (code) {
    case 'TRIP_PERIOD_STARTED':
      return { text: '여행이 시작돼 기간을 바꾸지 못했어요', lock: 'started' };
    case 'TRIP_PERIOD_GENERATING':
      return {
        text: '일정을 만드는 중이라 기간을 바꾸지 못했어요',
        lock: 'generating',
      };
    case 'TRIP_PERIOD_LENGTH_CHANGED':
      return { text: '일수가 달라져 기간을 바꾸지 못했어요', lock: null };
    default:
      return null;
  }
}

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
  // (TRIP-1788) 기간·커버 드래프트 — [적용]에서만 커밋. 기간은 일수가 같을 때만 여기 담긴다(다르면 확인창).
  const [periodEdit, setPeriodEdit] = useState<Period | undefined>(undefined);
  // 커버: undefined = 안 건드림, null = 첫 여행지 자동을 고름. 서버 값과 같으면 안 담는다(바뀐 게 아니다).
  const [coverEdit, setCoverEdit] = useState<string | null | undefined>(
    undefined
  );
  const [conflict, setConflict] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // 서버가 기간 변경을 거절한 뒤 — 기간만 잠그고(STARTED·GENERATING) 안내를 띄운다.
  const [rejectedLock, setRejectedLock] = useState<
    'started' | 'generating' | null
  >(null);
  const [periodNotice, setPeriodNotice] = useState<string | undefined>(
    undefined
  );

  // 기간 시트 — 열 때 현재 표시 기간에서 시드하고 [적용]에서만 커밋한다.
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [draftRange, setDraftRange] = useState({ start: '', end: '' });
  const [periodMonth, setPeriodMonth] = useState('');
  const [lengthMode, setLengthMode] = useState(false);
  // 일수 변경 확인창 — 대기 중인 새 기간(있으면 창이 떠 있다).
  const [lengthConfirm, setLengthConfirm] = useState<Period | undefined>(
    undefined
  );
  const [lengthFailed, setLengthFailed] = useState(false);
  const [coverSheetOpen, setCoverSheetOpen] = useState(false);

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
  // PATCH(저장·일수 확인) 진행 잠금 하나 — 같은 뮤테이션을 겹쳐 부르면 앞 호출의 개별 콜백이 버려져(TanStack Query) 잠금이 안 풀린다.
  const patchingRef = useRef(false);

  // 캐시 갱신은 훅 옵션에 둔다 — 호출별 콜백(`mutate(…, {onSuccess})`)은 응답 전에 화면을 떠나면 안 불린다(TRIP-1677 선례).
  const patch = usePatchTripsTripId({
    mutation: {
      onSuccess: (saved, vars, _onMutateResult, context) => {
        const detailKey = getGetTripsTripIdQueryKey(tripId);
        const isChild = (query: { queryKey: readonly unknown[] }): boolean =>
          isTripChildKey(tripId, query.queryKey);
        if (vars.data.discardItinerary) {
          // 일정을 버렸다 — 옛 일정·거점·꼭 갈 곳이 다음 화면에 잠깐이라도 그려지지 않게 데이터째 비운다.
          void context.client.resetQueries({ predicate: isChild });
        } else {
          // 날짜만 옮겼다면(쓰기 전 캐시의 날짜와 응답을 비교) 하위 조회를 낡음 처리한다. 이름만 고친 저장은 안 건드린다.
          const before = context.client.getQueryData<Trip>(detailKey);
          if (
            before !== undefined &&
            (before.startDate !== saved.startDate ||
              before.endDate !== saved.endDate)
          ) {
            void context.client.invalidateQueries({ predicate: isChild });
          }
        }
        context.client.setQueryData(detailKey, saved);
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
  const serverPeriod: Period = {
    startDate: trip.startDate,
    endDate: trip.endDate,
  };
  const period = periodEdit ?? serverPeriod;
  const coverKey = coverEdit === undefined ? trip.coverKey : coverEdit;
  // 기간 행을 못 여는 이유 — 화면 전체 잠금이면 끝난 여행 얼굴, 아니면 여행 상태·서버 거절.
  const lock: PeriodLock = conflict
    ? 'ended'
    : (periodLock(trip, today) ?? rejectedLock);
  const titleInvalid = titleViolation(title) !== null;
  const dayWindowDirty =
    dayWindowEdit !== undefined && !sameDayWindow(dayWindowEdit, serverWindow);
  const dirty =
    title !== trip.title ||
    (partyEdit !== undefined && partyEdit !== trip.party) ||
    (companionEdit !== undefined && companionEdit !== trip.companionType) ||
    dayWindowDirty ||
    periodEdit !== undefined ||
    coverEdit !== undefined;
  const canSave = dirty && !titleInvalid && !locked && !patch.isPending;

  const summary = tripItinerarySummary(trip);
  const phase = classifyTripPhase(trip, summary.status, today);
  const deletable = phase === 'draft' || phase === 'upcoming';

  // 누르는 순간의 최신 여행 + 현재 입력으로 본문을 만든다 — 렌더 때 만든 본문·마운트 스냅샷을 쓰지 않는다.
  const buildBody = (
    extra: Pick<TripEdits, 'period' | 'discardItinerary'>
  ): EditTripRequest => {
    const latest =
      queryClient.getQueryData<Trip>(getGetTripsTripIdQueryKey(tripId)) ?? trip;
    return toEditTripRequest(latest, {
      title: titleEdit,
      party: partyEdit,
      companionType: companionEdit,
      dayWindow: dayWindowDirty ? dayWindowEdit : undefined,
      coverKey: coverEdit,
      ...extra,
    });
  };

  /**
   * PATCH 409 처리 — 기간 사유 코드(`TRIP_PERIOD_*`)면 기간 편집만 버리고 기간만 잠근다(화면은 안 잠긴다). 그 밖의 409
   * (`CONFLICT`·코드 없음)는 종전처럼 화면 전체 잠금. 409 가 아니면 false 를 돌려 호출자가 실패 표면을 고른다.
   */
  const handleConflict = (error: unknown): boolean => {
    const rejection = periodRejection(periodConflictCode(error));
    if (rejection !== null) {
      setPeriodEdit(undefined);
      setLengthConfirm(undefined);
      setRejectedLock(rejection.lock);
      setPeriodNotice(rejection.text);
      return true;
    }
    if (isAxiosError(error) && error.response?.status === 409) {
      setLengthConfirm(undefined);
      setConflict(true);
      return true;
    }
    return false;
  };

  const save = (): void => {
    if (!canSave || patchingRef.current) return;
    patchingRef.current = true;
    setSaveFailed(false);
    setPeriodNotice(undefined);
    const data = buildBody({ period: periodEdit });
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
          if (!handleConflict(error)) setSaveFailed(true);
        },
        onSettled: () => {
          patchingRef.current = false;
        },
      }
    );
  };

  // 일수 확정이 뺄 여행지 한 줄 — 본문을 만드는 함수(`fitDestinationNights`)를 그대로 지나 말과 실제가 안 갈린다.
  const lengthDropNotice =
    lengthConfirm === undefined
      ? null
      : droppedNotice(
          droppedDestinations(
            trip.destinations,
            nightsBetween(trip.startDate, trip.endDate),
            nightsBetween(lengthConfirm.startDate, lengthConfirm.endDate)
          )
        );

  const openPeriodSheet = (): void => {
    setDraftRange({ start: period.startDate, end: period.endDate });
    setPeriodMonth(period.startDate.slice(0, 7));
    setLengthMode(false);
    setPeriodSheetOpen(true);
  };
  // 기본 모드: 탭 = 새 시작, 끝은 같은 일수로 따라온다. 끝일 모드: 끝(또는 시작)을 직접 고른다.
  const pickPeriodDate = (date: string): void =>
    setDraftRange((range) =>
      lengthMode
        ? pickLengthRange(range, date)
        : { start: date, end: shiftedEndDate(serverPeriod, date) }
    );
  const applyPeriod = (): void => {
    const next: Period = {
      startDate: draftRange.start,
      endDate: draftRange.end,
    };
    setPeriodSheetOpen(false);
    if (
      nightsBetween(next.startDate, next.endDate) !==
      nightsBetween(trip.startDate, trip.endDate)
    ) {
      // 일수가 바뀐다 — 일정을 다시 짜야 하니 확정 전엔 아무것도 보내지 않고 확인창부터.
      setLengthFailed(false);
      setLengthConfirm(next);
      return;
    }
    const same =
      next.startDate === trip.startDate && next.endDate === trip.endDate;
    setPeriodEdit(same ? undefined : next);
  };
  const confirmLength = (): void => {
    if (lengthConfirm === undefined || patchingRef.current) return;
    patchingRef.current = true;
    setLengthFailed(false);
    setPeriodNotice(undefined);
    patch.mutate(
      {
        tripId,
        data: buildBody({ period: lengthConfirm, discardItinerary: true }),
      },
      {
        onSuccess: () => {
          // 같은 여행의 일정 방식 선택으로 — 응답으로 표면이 바뀌는 순간이라 연타 창을 연다.
          openPressGuardWindow();
          router.replace(`/trips/${tripId}/itinerary/method` as Href);
        },
        onError: (error) => {
          if (!handleConflict(error)) setLengthFailed(true);
        },
        onSettled: () => {
          patchingRef.current = false;
        },
      }
    );
  };
  const applyCover = (picked: string | null | undefined): void => {
    setCoverSheetOpen(false);
    // 안 골랐으면 건드리지 않는다(앱이 모르는 서버 키가 지워지지 않게). 서버 값과 같으면 바뀐 게 아니다.
    if (picked === undefined) return;
    setCoverEdit(picked === (trip.coverKey ?? null) ? undefined : picked);
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
          period.startDate,
          period.endDate,
          today
        )}
        nightsLabel={formatNightsLabel(period.startDate, period.endDate)}
        periodHint={periodHint(lock)}
        periodNotice={periodNotice}
        onPressPeriod={lock === null ? guardPress(openPeriodSheet) : undefined}
        onPressCover={
          locked ? undefined : guardPress(() => setCoverSheetOpen(true))
        }
        destinationsLabel={[...trip.destinations]
          .sort((a, b) => a.seq - b.seq)
          .map((one) => one.region)
          .join(' · ')}
        cover={tripCoverSource({
          coverKey,
          destinations: trip.destinations,
        })}
        coverLabel={tripCoverLabel({
          coverKey,
          destinations: trip.destinations,
        })}
        canSave={canSave}
        saveFailed={saveFailed}
        deletable={deletable}
        onBack={onBack}
        onChangeTitle={setTitleEdit}
        // 행·「여행 삭제」는 창을 따른다 — 목록 ⋯ 「여행 설정」 연타의 둘째 탭이 여기 떨어진다(통합 QA O1).
        onPressCompanion={guardPress(openCompanionSheet)}
        onPressDayWindow={guardPress(() => setDayWindowSheetOpen(true))}
        // `save` 는 ref 를 읽는 함수라 렌더 중에 `respectPressGuard(save)` 로 감싸면 컴파일러 린트가 막는다 — 누르는 순간 감싼다.
        onSave={() => respectPressGuard(save)()}
        onPressDelete={guardPress(() => {
          setDeleteFailed(false);
          setDeleteOpen(true);
        })}
      />
      {companionSheetOpen ? (
        <CompanionEditSheet
          party={draftParty}
          companionType={draftCompanion}
          onChangeParty={(next) => setDraftParty(Math.max(1, next))}
          onSelectCompanion={pickCompanion}
          // 시트가 닫힌 자리에 [저장]이 있다 — 연타 둘째 탭이 저장으로 가지 않게 창을 연다(통합 QA D1·D2).
          onApply={guardPress(applyCompanion)}
          onClose={() => setCompanionSheetOpen(false)}
        />
      ) : null}
      {dayWindowSheetOpen ? (
        <DayWindowEditSheet
          value={dayWindow}
          sameDay={sameDay}
          onApply={guardPress((next: DayWindow) => {
            setDayWindowEdit(next);
            setDayWindowSheetOpen(false);
          })}
          onClose={() => setDayWindowSheetOpen(false)}
        />
      ) : null}
      {periodSheetOpen ? (
        <PeriodEditSheet
          today={today}
          month={periodMonth}
          range={draftRange}
          note={lengthMode ? NOTE_LENGTH : NOTE_SHIFT}
          onPressChangeLength={
            lengthMode ? undefined : () => setLengthMode(true)
          }
          onPickDate={pickPeriodDate}
          onPrevMonth={() => setPeriodMonth(shiftMonth(periodMonth, -1))}
          onNextMonth={() => setPeriodMonth(shiftMonth(periodMonth, 1))}
          onApply={guardPress(applyPeriod)}
          onClose={() => setPeriodSheetOpen(false)}
        />
      ) : null}
      {coverSheetOpen ? (
        <CoverPickSheet
          value={coverKey}
          autoSource={tripCoverSource({ destinations: trip.destinations })}
          onApply={guardPress(applyCover)}
          onClose={() => setCoverSheetOpen(false)}
        />
      ) : null}
      {lengthConfirm !== undefined ? (
        <PeriodLengthDialog
          hasItinerary={trip.itineraryDayCount > 0}
          droppedNotice={lengthDropNotice}
          failed={lengthFailed}
          // 창이 닫히면 뒤 행이 드러난다 — 연타 둘째 탭이 그 행을 열지 않게 한다(통합 QA D4).
          onCancel={guardPress(() => {
            setLengthConfirm(undefined);
            setLengthFailed(false);
          })}
          onConfirm={confirmLength}
        />
      ) : null}
      {deleteOpen ? (
        <TripDeleteDialog
          failed={deleteFailed}
          confirmed={summary.status === 'CONFIRMED'}
          onCancel={guardPress(() => setDeleteOpen(false))}
          onConfirm={confirmDelete}
        />
      ) : null}
    </View>
  );
}
