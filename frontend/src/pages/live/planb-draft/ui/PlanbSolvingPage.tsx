import { usePreventRemove } from '@react-navigation/native';
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
import { formatCoPickDayHeader } from '@/features/itinerary';
import { readFromInstant } from '../model/replanFromInstant';
import { deriveReplanMapAnchor } from '@/features/request-replan';
import { resolveReplanState } from '../model/replanState';
import { useReplanSession } from '../model/useReplanSession';
import { useElapsedFlag } from '@/shared/lib/useElapsedFlag';
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
 *    · closed → 종료 얼굴 + [나가기](서버 호출 없음).
 *    · 화면에 들어온 지 90초(미도착 구간 포함)가 지나면 시트 맨 위 느림 안내 — 요청·폴링은 그대로 둔다.
 *      시계는 마운트부터다 — 폴링 응답마다 리셋하지 않는다(restartKey 없음).
 *    · [취소] 요청이 실패하면(`cancel.isError`) 한 줄로 알린다.
 *  - 오류·종료 얼굴과 ‹ 확인의 나가기 연타는 ref 로 막는다(같은 틱 두 번째 누름은 옛 state 를 본다).
 *    그 ref 가 "나가는 중" 신호라, 선 뒤의 뒤로는 확인 없이 통과한다.
 */

const SLOW_MS = 90_000;

export interface PlanbSolvingPageProps {
  tripId: string;
  sessionId: string;
}

export function PlanbSolvingPage({
  tripId,
  sessionId,
}: PlanbSolvingPageProps): ReactElement | null {
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

  // 훅이라 조기 반환 위에서 — 미도착(실패 전)·짜는 중 동안 이어서 잰다.
  const slow = useElapsedFlag(
    data === undefined ? !session.isError : kind === 'solving',
    SLOW_MS
  );

  // 진행 얼굴(미도착 포함)에서만 스와이프·하드웨어 뒤로를 ‹ 와 같은 확인으로 붙잡는다.
  const solvingFace =
    data === undefined ? !session.isError : kind === 'solving';
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
        params: { tripId, sessionId },
      });
    }
  }, [kind, tripId, sessionId, router]);

  // 서버 호출 없이 나간다 — 뒤로 갈 곳이 없으면(딥링크 착지) 허브로.
  const leaveWithoutServer = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace(`/trips/${tripId}/live`);
  };

  if (data === undefined && session.isError) {
    return (
      <ReplanNoticeFace
        kind="solving-error"
        onRetry={() => session.refetch()}
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
      // 서버 검증 시각을 자르기만 한다(INV-2).
      timeLabel: `${slot.startAt.slice(0, 5)} 방문`,
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
