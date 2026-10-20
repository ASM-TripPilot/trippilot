import { usePreventRemove } from '@react-navigation/native';
import type { Href } from 'expo-router';
import { useNavigation, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ReplanSlotVM } from '@/entities/itinerary-slot';
import { buildSlotKey } from '@/entities/itinerary-slot';
import { buildStatePins } from '@/entities/itinerary-slot';
import { projectSlotProgress } from '@/entities/itinerary-slot';
import { useLiveItinerary } from '@/features/execution';
import { deriveVisitProgress } from '@/entities/itinerary-slot';
import { visitedLabelByPoiId } from '@/entities/itinerary-slot';
import { formatCoPickDayHeader } from '@/features/itinerary';
import { staleRetryRequest } from '../model/draftNotice';
import { readFromInstant } from '../model/replanFromInstant';
import { replanCapDeadlineMs } from '../model/replanPollCap';
import {
  deriveReplanMapAnchor,
  useStartReplan,
} from '@/features/request-replan';
import { resolveReplanState } from '../model/replanState';
import { useReplanSession } from '../model/useReplanSession';
import { seoulDate } from '@/shared/lib/seoulDate';
import { useDeadlineFlag } from '@/shared/lib/useDeadlineFlag';
import { useElapsedFlag } from '@/shared/lib/useElapsedFlag';
import type { ReplanSession } from '@/shared/api/index.schemas';
import {
  useGetTripsTripIdVisitsDaysDay,
  usePostTripsTripIdReplanSessionsSessionIdCancel,
} from '@/shared/api/index.hooks';

import { ReplanLeaveDialog } from './ReplanLeaveDialog';
import { ReplanNoticeFace } from './ReplanNoticeFace';
import { ReplanSolvingView } from './ReplanSolvingView';

/**
 * TRIP-752 · i05 다시 짜는 중 배선판. 세션 GET 폴링 → 판정 1회 → 짜는 중이면 `ReplanSolvingView`.
 *
 *  - 보여 줄 날 = 세션의 `targetDate`(TRIP-1195 — 오늘이 아닌 날을 다시 짤 수 있다. 오늘 세션이면 서버의 "오늘"과
 *    같다). 그날 일정 슬롯 중 방문
 *    기록상 완료된 것만 일정 순서대로 행으로 그린다(BR-U4-34 — 진행 상태는 기록에서 온다, 시계 추정 없음).
 *    헤더 곳 수 = 완료 + 진행 중(둘 다 기준 시각 이전이라 그대로 둔다, BR-U4-17·18).
 *    그날을 모르면(일정 미도착·그날 없음) 제목만 남기고 화면은 그대로 그린다.
 *  - [취소] → cancel 요청만(itinerary PUT 없음 — INV-U4-05). **성공한 뒤에만** 뒤로(없으면 허브로 replace).
 *  - ‹ → 이탈 확인부터(TRIP-1007 · QA #062 — 나간 뒤 다시 요청하면 새 POST 가 이 세션을 닫아 결과가
 *    버려진다, INV-U4-06). [나가기]면 `leaveWithoutServer` — 세션을 살린 채 나간다(cancel 0). 뒤가 없으면
 *    (딥링크·푸시 착지) 허브로 replace, 같은 틱 연타는 ref 로 1회(TRIP-1291). [계속 기다리기]는 확인만 닫는다.
 *    스와이프·Android 하드웨어 뒤로도 진행 얼굴(미도착 포함)에선 같은 확인을 띄운다(TRIP-1292 — `usePreventRemove`).
 *    오류·종료 얼굴은 잃을 결과가 없어 그대로 나간다. 화면이 스스로 하는 이동(i06 replace·[취소] 성공 뒤
 *    나가기·[나가기])은 막지 않는다.
 *  - 캡션: PARTIAL_SLOTS 는 `{H}시 이후 다시 짜는 중`, FULL_DAY 는 시각 없이 — 오늘이면 `오늘 일정`, 오늘이 아닌 날이면
 *    `{N}일차 일정`(BR-U4-11). 오늘이 아닌 날엔 방문 기록이 없어 `방문한 N곳` 줄을 비운다.
 *  - DRAFT·NO_SOLUTION·FAILED → i06(`planb/draft`)으로 **replace** 1회. push 면 i06 에서 뒤로 갔을 때 이
 *    화면이 다시 떠 곧장 i06 로 되돌려 보내는 루프가 생긴다. 의존성을 kind 문자열로 둬 폴링 재렌더에
 *    다시 발화하지 않는다.
 *  - TRIP-1277 — 어떤 상태에서도 빈 화면이 아니다(INV-4):
 *    · 미도착(첫 응답 전) → 진행 기본 얼굴(캡션 `일정 다시 짜는 중`, 행 0). ‹·[취소]는 tripId·sessionId 만으로 동작.
 *    · data 없는 조회 실패 → 오류 얼굴. [다시 시도]=세션 재조회(`refetch`)만, [취소]=**서버 호출 없이** 나가기
 *      (조회가 실패한 판에 cancel 도 실패할 공산이 크다 — 세션은 다음 요청이 닫는다, INV-U4-06).
 *      TRIP-1293 — 재조회가 끝날 때까지 오류 얼굴을 지키고 [다시 시도]만 잠근다(`retrying=isFetching`).
 *      TanStack v5 는 data 없는 재조회가 시작되면 status 를 pending 으로 되돌려 isError 가 풀리므로, 판정은
 *      "data 없음 && 실패 이력(errorUpdateCount>0)"이다(첫 로딩은 0 이라 진행 기본 얼굴).
 *      TRIP-1348 — 폴링은 오류 1회에 한 번 더 묻고 또 실패하면 멈춘다(`useReplanSession`). 그렇게 멈췄을 때 짜는 중
 *      data 가 남아 있어도(`isError && kind==='solving'`) 오류 얼굴이다 — 진행 카드에 머물면 멈춘 걸 모른다(INV-4).
 *    · closed → 종료 얼굴 + [나가기](서버 호출 없음).
 *    · 화면에 들어온 지 90초가 지나면 시트 맨 위 느림 안내 — 요청·폴링은 그대로 둔다. 미도착·오류 구간도
 *      끊지 않고 마운트부터 잰다(TRIP-1293) — 폴링 응답마다 리셋하지 않는다(restartKey 없음).
 *    · [취소] 요청이 실패하면(`cancel.isError`) 한 줄로 알린다.
 *  - TRIP-1363 — **8분 상한**(`replanPollCap`). 세션 `createdAt`(없으면 마운트 시각)부터 8분이 지나도 진행 얼굴이면
 *    본문(`PlanbSolvingBody`)을 내려 폴링을 끊고 `solving-capped` 얼굴을 보인다 — [홈으로] · [다시 시도]. 조용히 계속
 *    돌거나 이전 일정으로 말없이 되돌리지 않는다(INV-4). 폴링 훅(`useReplanSession`)은 건드리지 않고 이 껍데기가 조합한다.
 *    [다시 시도]는 **같은 입력·같은 알림으로 바로 다시 짠다**(i06 [새 대안 보기]와 같은 봉투 `staleRetryRequest` — 사유·지시·
 *    제외·범위·날짜·트리거 그대로) → 성공하면 새 세션의 이 화면으로 replace(열린 세션은 새 요청이 닫는다, INV-U4-06).
 *    알림과 끊긴 빈 요청 화면을 열면 사유를 다시 골라야 하고, 적용해도 알약이 남고, 전날 창에선 막다른 길이다(사용자 결정
 *    2026-10-20). 재누름은 ref 로 1회(실패에서만 푼다), 요청 중엔 버튼 잠금, 실패면 부제가 시작 실패 문장이 된다(INV-4).
 *    응답을 한 번도 못 받아 입력을 모르면 종전대로 요청 화면(오늘)을 연다.
 *  - 오류·종료 얼굴과 ‹ 확인의 나가기 연타는 ref 로 막는다(같은 틱 두 번째 누름은 옛 state 를 본다).
 *    그 ref 가 "나가는 중" 신호라, 선 뒤의 뒤로는 확인 없이 통과한다.
 */

const SLOW_MS = 90_000;

export interface PlanbSolvingPageProps {
  tripId: string;
  sessionId: string;
  /** 상황 감지 FE-B — 넣으려던 POI. 서버에 보내지 않고 i06 replace params 로만 잇는다(§3.6 미포함 안내). */
  includePoiId?: string;
}

/** 상한에 닿았을 때 본문이 넘기는 세션 스냅샷(`null` = 응답을 한 번도 못 받았다). */
type CappedSession = ReplanSession | null;

export function PlanbSolvingPage({
  tripId,
  sessionId,
  includePoiId,
}: PlanbSolvingPageProps): ReactElement | null {
  const router = useRouter();
  const startReplan = useStartReplan();
  // [다시 시도] 재누름 잠금 — 같은 틱 두 번째 누름은 옛 state 를 본다(ref). 실패에서만 푼다(새 POST 는 방금 연 세션을 닫는다).
  const retryRef = useRef(false);
  const [capped, setCapped] = useState<CappedSession | undefined>(undefined);
  if (capped !== undefined) {
    // 본문이 내려가 세션 폴링도 끝났다. [다시 시도]는 상한에 닿은 세션의 입력·트리거로 바로 다시 짠다. 응답을 한 번도
    // 못 받았으면(null) 입력도 날짜도 몰라 종전대로 요청 화면을 연다.
    const retry =
      capped === null
        ? () => router.replace(`/trips/${tripId}/planb`)
        : () => {
            if (retryRef.current) return;
            retryRef.current = true;
            startReplan.mutate(
              {
                tripId,
                data: staleRetryRequest(capped, seoulDate(new Date())),
              },
              {
                onSuccess: (next) =>
                  router.replace({
                    pathname: '/trips/[tripId]/planb/solving',
                    params: includePoiId
                      ? { tripId, sessionId: next.sessionId, includePoiId }
                      : { tripId, sessionId: next.sessionId },
                  }),
                onError: () => {
                  retryRef.current = false;
                },
              }
            );
          };
    return (
      <ReplanNoticeFace
        kind="solving-capped"
        onRetry={retry}
        retrying={startReplan.isPending}
        retryFailed={startReplan.isError}
        onLeave={() => router.replace('/(tabs)' as Href)}
      />
    );
  }
  return (
    <PlanbSolvingBody
      tripId={tripId}
      sessionId={sessionId}
      includePoiId={includePoiId}
      onCapped={(session) => setCapped(session ?? null)}
    />
  );
}

interface PlanbSolvingBodyProps extends PlanbSolvingPageProps {
  onCapped: (session: ReplanSession | undefined) => void;
}

function PlanbSolvingBody({
  tripId,
  sessionId,
  includePoiId,
  onCapped,
}: PlanbSolvingBodyProps): ReactElement | null {
  const router = useRouter();
  const navigation = useNavigation();
  const session = useReplanSession(tripId, sessionId);
  const cancel = usePostTripsTripIdReplanSessionsSessionIdCancel();
  const itinerary = useLiveItinerary(tripId);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leavingRef = useRef(false);

  const data = session.data;
  const kind =
    data === undefined ? undefined : resolveReplanState(data.status).kind;
  const from =
    data === undefined ? undefined : readFromInstant(data.fromInstant);
  const days = itinerary.data?.days ?? [];
  // 다시 짜는 날 = 세션 targetDate. fromInstant 의 날짜는 '지금'일 뿐 그 날이 아니다(미래일 세션에선 다르다).
  const targetDate = data?.targetDate;
  const otherDay =
    from !== undefined && targetDate !== undefined && targetDate !== from.date;
  const dayIndex =
    targetDate === undefined
      ? -1
      : days.findIndex((day) => day.date === targetDate);
  const day = dayIndex === -1 ? undefined : days[dayIndex];

  // 훅 규칙상 조기 반환 위에서 무조건 부른다 — 그날을 모르면 쿼리를 끈다.
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, day?.date ?? '', {
    query: { enabled: day !== undefined },
  });

  // data 없이 한 번이라도 실패했으면 재조회 중에도 오류 얼굴이다 — data 없는 재조회는 status 가 pending 으로
  // 돌아가 isError 가 풀리므로(TanStack v5) 실패 이력(errorUpdateCount)으로 판정한다. 첫 로딩은 0 이라 진행 얼굴.
  // 짜는 중 data 가 남은 채 폴링이 재시도까지 실패로 서도(TRIP-1348) 오류 얼굴이다 — 안 그러면 진행 카드에 머문 채 멈춘다.
  const errorFace =
    (data === undefined && session.errorUpdateCount > 0) ||
    (session.isError && kind === 'solving');

  // 훅이라 조기 반환 위에서 — 진입부터 미도착·오류 구간을 끊지 않고 짜는 중까지 이어서 잰다.
  const slow = useElapsedFlag(
    data === undefined || kind === 'solving',
    SLOW_MS
  );

  // TRIP-1363 — 8분 상한. 진행 얼굴(미도착 포함)에서만 잰다 — 오류 얼굴·결과가 나온 뒤엔 재지 않는다.
  // 기준은 세션 createdAt, 응답 전이면 마운트 시각(마운트 ref 는 렌더 간 고정).
  const mountedAtRef = useRef(Date.now());
  const capWatching = !errorFace && (data === undefined || kind === 'solving');
  const capReached = useDeadlineFlag(
    capWatching
      ? replanCapDeadlineMs(data?.createdAt, mountedAtRef.current)
      : null
  );
  useEffect(() => {
    if (capReached) onCapped(data);
    // data 는 상한 도달 시점의 스냅샷만 넘기면 된다 — 의존성에 두면 폴링 응답마다 재발화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capReached]);

  // 진행 얼굴(미도착 포함)에서만 스와이프·하드웨어 뒤로를 ‹ 와 같은 확인으로 붙잡는다.
  const solvingFace = data === undefined ? !errorFace : kind === 'solving';
  usePreventRemove(solvingFace, ({ data: { action } }) => {
    const isBack = action.type === 'GO_BACK' || action.type === 'POP';
    if (!isBack || leavingRef.current) {
      navigation.dispatch(action);
      return;
    }
    setLeaveOpen(true);
  });

  useEffect(() => {
    if (kind === 'draft' || kind === 'noSolution' || kind === 'failed') {
      router.replace({
        pathname: '/trips/[tripId]/planb/draft',
        params: includePoiId
          ? { tripId, sessionId, includePoiId }
          : { tripId, sessionId },
      });
    }
  }, [kind, tripId, sessionId, includePoiId, router]);

  // 서버 호출 없이 나간다 — 뒤로 갈 곳이 없으면(딥링크 착지) 허브로.
  const leaveWithoutServer = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace(`/trips/${tripId}/live`);
  };

  if (errorFace) {
    return (
      <ReplanNoticeFace
        kind="solving-error"
        onRetry={() => session.refetch()}
        retrying={session.isFetching}
        onLeave={leaveWithoutServer}
      />
    );
  }
  if (kind === 'closed') {
    return (
      <ReplanNoticeFace kind="solving-closed" onLeave={leaveWithoutServer} />
    );
  }
  // 결과가 나왔다 — 위 effect 가 i06 로 갈아 끼우는 중.
  if (kind !== undefined && kind !== 'solving') return null;

  // 방문 기록을 모르면(조회 중·실패) 곳 수·행을 비운다 — "방문한 0곳"은 거짓이다.
  const visitsKnown = visits.data !== undefined;
  const progress = deriveVisitProgress(
    visits.data ?? { visits: [] },
    day?.date ?? '',
    (day?.slots ?? []).map((slot) => slot.poiId)
  );
  const projected = day
    ? projectSlotProgress(day.slots, {
        completedPoiIds: progress.completedPoiIds,
        activePoiId: progress.activePoiId,
      })
    : [];
  const doneIndexes = visitsKnown
    ? projected.flatMap((entry, index) =>
        entry.state === 'done' ? [index] : []
      )
    : [];
  const kept =
    doneIndexes.length +
    projected.filter((entry) => entry.state === 'active').length;

  // TRIP-1419 — 완료 행 시각은 허브 완료 카드와 같은 실제 도착 시각. 없으면 계획 시각 + "계획".
  const visitedLabels = visitedLabelByPoiId(
    visits.data ?? { visits: [] },
    day?.date ?? ''
  );

  const slotKeyAt = (index: number) =>
    buildSlotKey(day?.date ?? '', projected[index].slot.poiId);
  // 원 일정에서 바로 앞 슬롯이 완료 행이 아니면 그 앞 커넥터를 뺀다(거리는 바로 앞 슬롯 기준).
  const unlinkedSlotKeys = doneIndexes
    .filter((index, i) => i > 0 && doneIndexes[i - 1] !== index - 1)
    .map(slotKeyAt);

  const slots: ReplanSlotVM[] = doneIndexes.map((index) => {
    const { slot } = projected[index];
    return {
      slotKey: slotKeyAt(index),
      placeName: slot.nameKo ?? '',
      tone: 'visited',
      photo: slot.imageUrl ? { uri: slot.imageUrl } : null,
      category: slot.category ?? null,
      // 서버 값을 읽기만 한다 — 실제 도착(arrivedAt) 또는 검증된 계획 시각(INV-2).
      timeLabel:
        visitedLabels[slot.poiId] !== undefined
          ? `${visitedLabels[slot.poiId]} 방문`
          : `${slot.startAt.slice(0, 5)} 계획`,
      // 서버 category 는 코드값이라 Figma 의 한글 부제(`마을 · 벽화`)를 만들 재료가 없다.
      categoryLabel: null,
      distanceRange: slot.distanceRange ?? null,
      isFixed: slot.isFixed,
    };
  });

  return (
    <View className="flex-1">
      <ReplanSolvingView
        // 세션 출발 좌표 → 그날 첫 좌표 슬롯 → 일정 전체 → 서울시청(TRIP-979 B).
        center={
          deriveReplanMapAnchor({
            days,
            preferredDate: targetDate,
            origin: { lat: data?.originLat, lng: data?.originLng },
          }).center
        }
        pins={buildStatePins(
          projected.map(({ slot, state }) => ({
            lat: slot.lat,
            lng: slot.lng,
            progress: state,
          }))
        )}
        solvingLabel={
          from === undefined
            ? '일정 다시 짜는 중'
            : data?.scope === 'FULL_DAY'
              ? !otherDay
                ? '오늘 일정 다시 짜는 중'
                : day
                  ? `${dayIndex + 1}일차 일정 다시 짜는 중`
                  : '일정 다시 짜는 중'
              : `${from.hour}시 이후 다시 짜는 중`
        }
        dayLabel={day ? `${dayIndex + 1}일차` : ''}
        dateLabel={day ? formatCoPickDayHeader(day.date) : ''}
        meta={day && visitsKnown && !otherDay ? `방문한 ${kept}곳 그대로` : ''}
        slots={slots}
        unlinkedSlotKeys={unlinkedSlotKeys}
        cancelPending={cancel.isPending}
        slow={slow}
        cancelFailed={cancel.isError}
        onBack={() => setLeaveOpen(true)}
        onCancel={() =>
          cancel.mutate(
            { tripId, sessionId },
            // 여전히 진행 얼굴이라 나가는 중 신호를 세우고 나가야 붙잡히지 않는다.
            { onSuccess: leaveWithoutServer }
          )
        }
      />
      {leaveOpen ? (
        <ReplanLeaveDialog
          onStay={() => setLeaveOpen(false)}
          onLeave={leaveWithoutServer}
        />
      ) : null}
    </View>
  );
}
