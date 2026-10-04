import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import type { ReplanSlotVM } from '@/entities/itinerary-slot';
import { buildStatePins } from '@/entities/itinerary-slot';
import { formatDistance } from '@/entities/place';
import { useLiveItinerary } from '@/features/execution';
import { formatCoPickDayHeader } from '@/features/itinerary';
import { readFromInstant } from '../model/replanFromInstant';
import { deriveReplanMapAnchor } from '@/features/request-replan';
import { buildStartReplanRequest } from '@/features/request-replan';
import { useStartReplan } from '@/features/request-replan';
import { resolveReplanState } from '../model/replanState';
import { useApplyReplan } from '@/features/apply-replan';
import { useReplanDiff } from '../model/useReplanDiff';
import { useReplanSession } from '../model/useReplanSession';
import type { ReplanDiff } from '@/shared/api/index.schemas';

import { seoulDate } from '@/shared/lib/seoulDate';
import type { MapCenter, MapPin } from '@/shared/map';

import { ReplanDraftView, type ReplanRemovedVM } from './ReplanDraftView';

/**
 * TRIP-751 · AC-9·AC-10 — i06 재계획안 페이지 배선판. 세션 GET 을 폴링해 판정 1회로 접고
 * 같은 순수 뷰(`ReplanDraftView`)의 세 얼굴 중 하나로 그린다.
 *
 * `useReplanSession`(폴링) → `resolveReplanState(status)`:
 *  - 'draft'      → variant 'draft'. [적용하기]는 **바로 확정**한다(E1 — 확정 지점이 i06 페이지로
 *                    옮겨졌다. 쓰기는 여전히 seam `useApplyReplan` 하나만 통과한다, BR-U4-28).
 *                    성공하면 허브로 `replace`(뒤로가기로 초안에 돌아와 409 를 맞는 길을 없앤다) +
 *                    `applied=sessionId`(i08 시트 신호, 소비는 754).
 *  - 'noSolution' → variant 'noSolution'. 서버가 사유를 주지 않으므로 부제는 뒤 절만(Seed Q4).
 *                    오늘(KST) 세션이고 내일이 일정에 있으면 [내일 일정 다시 짜기] — 같은 조건 · targetDate=내일 ·
 *                    FULL_DAY 로 세션을 새로 열고(`useStartReplan`) solving 으로 replace(i04 와 같은 착지).
 *  - 'failed'     → variant 'failed'(E3 — 다른 화면으로 튕기지 않고 같은 자리에 안내, INV-4).
 *  - 'solving'·'closed'·미도착 → null.
 *
 * TRIP-1007 — 초안 얼굴의 행은 서버 초안(`useReplanDiff` → `GET …/diff`)에서 온다. 세션 계약에 슬롯이
 * 없던 게 아니라 이 조회를 안 하고 있었다(QA #061 빈 시트). 조립 규칙:
 *  - 행 순서 = `after` 배열(entries 순서는 계약이 약속하지 않는다). 시각은 서버 값을 분까지 자르기만(INV-2).
 *  - 이름·사진·카테고리·좌표는 응답 슬롯(`after`)의 필드를 그대로 읽는다(TRIP-1044 — 일정 캐시 역조회 폐기:
 *    재계획이 새로 넣은 장소는 현재 일정에 없고, 일정 조회가 비어도 초안은 그려져야 한다). 서버가 이름을
 *    못 채운 행(`nameKo` null)만 "이름 준비 중"(지어내지 않는다). 행 사이 커넥터는 끈다(행 거리는 계약 밖).
 *  - `REMOVED` 는 초안 행과 섞지 않고 아래에 따로(BR-U4-25). 이름은 `before` 슬롯에서 slotKey 로 찾는다
 *    (`entries` 에는 이름이 없다). 헤더 = `k일차 · M월 D일(요일)` + `N곳 · 총거리`.
 *  - 지도 = 초안 슬롯 핀(전부 예정 톤)과 중심은 초안의 첫 좌표(없으면 기존 앵커: 세션 출발 → 그날 → 일정 전체).
 *  - 초안이 안 왔거나(로딩·ready=false) 조회가 실패하면 안내 + [적용하기] 잠금(INV-4 — 빈 초안 확정 차단).
 */

// 라이브 대안 없음 부제 — Figma 앞 절("17시 이후 …")은 데이터별 사유라 서버가 주기 전엔 쓰지 않는다.
const NO_SOLUTION_DESCRIPTION = '조건을 줄이거나 직접 고쳐 주세요';
const NEXT_DAY_FAILED_DESCRIPTION =
  '내일 일정을 다시 짜지 못했어요. 잠시 후 다시 시도해 주세요';
// KST 는 서머타임이 없어 하루가 항상 24시간이다 — '지금 + 하루'의 KST 날짜가 내일이다(seoulDate 와 같은 기준).
const DAY_MS = 86_400_000;
// 서버가 이름을 못 채운 행(nameKo null) — poiId 를 이름처럼 쓰지 않는다.
const NAME_PENDING = '이름 준비 중';
const DIFF_LOADING_NOTICE = {
  title: '재계획안을 불러오는 중이에요',
  description: '',
};
const DIFF_FAILED_NOTICE = {
  title: '재계획안을 불러오지 못했어요',
  description: '잠시 후 다시 시도해 주세요',
};

/** 서버 초안 → 행 VM(초안) · 빠지는 행 VM · 헤더 meta. 거리는 초안 총거리만(행 거리 없음, INV-3). */
function buildDraftSheet(diff: ReplanDiff): {
  slots: ReplanSlotVM[];
  removed: ReplanRemovedVM[];
  meta: string;
  pins: MapPin[];
} {
  const slots: ReplanSlotVM[] = diff.after.map((slot) => ({
    slotKey: slot.slotKey,
    placeName: slot.nameKo ?? NAME_PENDING,
    // diff 엔 방문 여부가 없다 — 전 행 예정 톤(Seed Q6).
    tone: 'planned',
    photo: slot.imageUrl ? { uri: slot.imageUrl } : null,
    category: slot.category ?? null,
    timeLabel: `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`,
    categoryLabel: null,
    distanceRange: null,
    isFixed: slot.isFixed,
  }));
  // REMOVED 는 이번 초안에 없는 장소라 이름은 `before` 에서 찾는다(entries 에는 이름이 없다).
  const before = new Map(diff.before.map((slot) => [slot.slotKey, slot]));
  const removed: ReplanRemovedVM[] = diff.entries
    .filter((entry) => entry.change === 'REMOVED')
    .map((entry) => ({
      slotKey: entry.slotKey,
      placeName: before.get(entry.slotKey)?.nameKo ?? NAME_PENDING,
      timeLabel: entry.beforeStart
        ? `원래 ${entry.beforeStart.slice(0, 5)}`
        : null,
    }));
  // 좌표 없는 행은 핀을 건너뛰되 번호는 원래 자리를 지킨다(buildStatePins). 초안 행은 전부 예정 톤.
  const pins = buildStatePins(
    diff.after.map((slot) => ({
      lat: slot.lat,
      lng: slot.lng,
      progress: 'upcoming' as const,
    }))
  );
  // 총거리를 모르면 곳 수만 — 0km 로 채우면 거짓 요약이다(openapi ReplanImpact).
  const km = diff.impact?.totalDistanceKm;
  const meta =
    km === null || km === undefined
      ? `${slots.length}곳`
      : `${slots.length}곳 · ${formatDistance(km * 1000)}`;
  return { slots, removed, meta, pins };
}

/** 초안의 첫 좌표(핀 중 첫 것) — 번호·상태 같은 핀 필드를 지도 중심에 흘리지 않는다. */
function draftCenter(pins: MapPin[] | undefined): MapCenter | undefined {
  const first = pins?.[0];
  return first ? { lat: first.lat, lng: first.lng } : undefined;
}

export interface PlanbDraftPageProps {
  tripId: string;
  sessionId: string;
}

export function PlanbDraftPage({
  tripId,
  sessionId,
}: PlanbDraftPageProps): ReactElement | null {
  const router = useRouter();
  const session = useReplanSession(tripId, sessionId);
  const apply = useApplyReplan();
  const startReplan = useStartReplan();
  // 출발 좌표 없는 세션의 지도 중심을 일정에서 고른다(TRIP-979 B). 훅이라 조기 반환 위에서 부른다.
  const itinerary = useLiveItinerary(tripId);

  const data = session.data;
  const state =
    data === undefined ? undefined : resolveReplanState(data.status);
  // 훅이라 조기 반환 위에서 부른다 — 초안 얼굴에서만 조회한다.
  const diff = useReplanDiff(tripId, sessionId, {
    enabled: state?.kind === 'draft',
  });

  if (data === undefined || state === undefined) return null;
  if (
    state.kind !== 'draft' &&
    state.kind !== 'noSolution' &&
    state.kind !== 'failed'
  ) {
    return null;
  }

  const days = itinerary.data?.days ?? [];
  // 밤에 오늘을 다시 짜면 하루 창이 남지 않아 대안 없음으로 끝난다 — 내일이 일정에 있으면 내일 하루 전체를
  // 같은 조건으로 다시 짜는 길을 준다. 지난 날·기간 밖·일정 없는 날의 최종 판정은 서버(409)다.
  const now = new Date();
  const tomorrow = seoulDate(new Date(now.getTime() + DAY_MS));
  const canReplanNextDay =
    state.kind === 'noSolution' &&
    data.targetDate === seoulDate(now) &&
    days.some((day) => day.date === tomorrow);
  const draft = diff.data?.ready === true ? diff.data : undefined;
  const sheet = draft ? buildDraftSheet(draft) : undefined;
  const draftDate = draft?.date ?? undefined;
  const dayIndex =
    draftDate === undefined
      ? -1
      : days.findIndex((day) => day.date === draftDate);

  return (
    <ReplanDraftView
      variant={state.kind}
      // 초안의 첫 좌표가 먼저다(초안이 이 화면의 주인공) — 좌표가 없으면 세션 출발 → 그날 → 일정 전체 → 서울시청.
      center={
        draftCenter(sheet?.pins) ??
        deriveReplanMapAnchor({
          days: itinerary.data?.days,
          preferredDate:
            data.targetDate ?? readFromInstant(data.fromInstant).date,
          origin: { lat: data.originLat, lng: data.originLng },
        }).center
      }
      pins={sheet?.pins}
      days={[]}
      selectedDayIndex={0}
      dayLabel={dayIndex === -1 ? '' : `${dayIndex + 1}일차`}
      dateLabel={draftDate ? formatCoPickDayHeader(draftDate) : ''}
      meta={sheet?.meta ?? ''}
      slots={sheet?.slots ?? []}
      removed={sheet?.removed ?? []}
      showConnectors={false}
      draftNotice={
        sheet !== undefined
          ? null
          : diff.isError
            ? DIFF_FAILED_NOTICE
            : DIFF_LOADING_NOTICE
      }
      applyDisabled={sheet === undefined}
      noSolutionDescription={
        startReplan.isError
          ? NEXT_DAY_FAILED_DESCRIPTION
          : NO_SOLUTION_DESCRIPTION
      }
      replanNextDayPending={startReplan.isPending}
      onReplanNextDay={
        canReplanNextDay
          ? () =>
              startReplan.mutate(
                {
                  tripId,
                  // 원 요청의 사유·방향·자유 입력 그대로, 날만 내일. 오늘 아닌 날은 FULL_DAY 만(서버 400).
                  // 오늘 감지한 트리거는 내일을 다시 짜는 근거가 아니라 null(수동 진입). 좌표도 안 싣는다 —
                  // 서버가 미래일엔 그 날 거점에서 출발한다(i04 미래일 요청과 같은 규칙).
                  data: buildStartReplanRequest({
                    scope: 'FULL_DAY',
                    targetDate: tomorrow,
                    reasons: data.reasons ?? [],
                    directives: data.directives ?? [],
                    freeText: data.freeText ?? '',
                    triggerId: null,
                  }),
                },
                {
                  onSuccess: (next) =>
                    router.replace({
                      pathname: '/trips/[tripId]/planb/solving',
                      params: { tripId, sessionId: next.sessionId },
                    }),
                }
              )
          : undefined
      }
      applyPending={apply.isPending}
      applyFailed={apply.isError}
      onBack={() => router.back()}
      onManualEdit={() =>
        router.push({
          pathname: '/trips/[tripId]/planb/manual',
          params: { tripId },
        })
      }
      onApply={() =>
        apply.mutate(
          { tripId, sessionId },
          {
            onSuccess: () =>
              router.replace({
                pathname: '/trips/[tripId]/live',
                // TRIP-1195 — 오늘이 아닌 날을 확정했으면 허브가 그 일차로 열리게 날짜를 싣는다(오늘이면 종전과 같은 params).
                params:
                  data.targetDate && data.targetDate !== seoulDate(new Date())
                    ? { tripId, applied: sessionId, day: data.targetDate }
                    : { tripId, applied: sessionId },
              }),
          }
        )
      }
      // TRIP-1195 — 오늘이 아닌 날을 다시 짜던 세션이면 같은 날로 다시 연다(날짜를 빠뜨리면 오늘로 조용히 바뀐다, INV-4).
      onReopenRequest={() =>
        router.push(
          data.targetDate && data.targetDate !== seoulDate(new Date())
            ? `/trips/${tripId}/planb?targetDate=${data.targetDate}`
            : `/trips/${tripId}/planb`
        )
      }
    />
  );
}
