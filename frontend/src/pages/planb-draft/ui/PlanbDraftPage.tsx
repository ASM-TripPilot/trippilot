import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { formatDistance } from '@/entities/place/lib/formatDistance';
import { useLiveItinerary } from '@/features/execution/model/useLiveItinerary';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import { readFromInstant } from '@/features/planb/model/replanFromInstant';
import { deriveReplanMapAnchor } from '@/features/planb/model/replanMapCenter';
import { resolveReplanState } from '@/features/planb/model/replanState';
import { useApplyReplan } from '@/features/planb/model/useApplyReplan';
import { useReplanDiff } from '@/features/planb/model/useReplanDiff';
import { useReplanSession } from '@/features/planb/model/useReplanSession';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  ReplanDiff,
} from '@/shared/api/generated/schemas';

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
 *  - 'failed'     → variant 'failed'(E3 — 다른 화면으로 튕기지 않고 같은 자리에 안내, INV-4).
 *  - 'solving'·'closed'·미도착 → null.
 *
 * TRIP-1007 — 초안 얼굴의 행은 서버 초안(`useReplanDiff` → `GET …/diff`)에서 온다. 세션 계약에 슬롯이
 * 없던 게 아니라 이 조회를 안 하고 있었다(QA #061 빈 시트). 조립 규칙:
 *  - 행 순서 = `after` 배열(entries 순서는 계약이 약속하지 않는다). 시각은 서버 값을 분까지 자르기만(INV-2).
 *  - 이름·사진·카테고리는 라이브 일정 캐시를 poiId 로 역조회, 없으면 "이름 준비 중"(지어내지 않는다).
 *    캐시의 `distanceRange` 는 옛 순서 기준 거리라 쓰지 않고, 행 사이 커넥터를 끈다(행 거리는 계약 밖).
 *  - `REMOVED` 는 초안 행과 섞지 않고 아래에 따로(BR-U4-25). 헤더 = `k일차 · M월 D일(요일)` + `N곳 · 총거리`.
 *  - 초안이 안 왔거나(로딩·ready=false) 조회가 실패하면 안내 + [적용하기] 잠금(INV-4 — 빈 초안 확정 차단).
 */

// 라이브 대안 없음 부제 — Figma 앞 절("17시 이후 …")은 데이터별 사유라 서버가 주기 전엔 쓰지 않는다.
const NO_SOLUTION_DESCRIPTION = '조건을 줄이거나 직접 고쳐 주세요';
// 캐시에 없는 poiId — 서버 초안엔 이름이 없다(ReplanDiffSlot 계약). poiId 를 이름처럼 쓰지 않는다.
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
function buildDraftSheet(
  diff: ReplanDiff,
  days: ItineraryDaysItem[]
): { slots: ReplanSlotVM[]; removed: ReplanRemovedVM[]; meta: string } {
  const cached = new Map<string, ItineraryDaysItemSlotsItem>();
  for (const day of days) {
    for (const slot of day.slots) cached.set(slot.poiId, slot);
  }
  const lookup = (slotKey: string) => {
    const parsed = parseSlotKey(slotKey);
    return parsed.kind === 'ok' ? cached.get(parsed.poiId) : undefined;
  };

  const slots: ReplanSlotVM[] = diff.after.map((slot) => {
    const hit = lookup(slot.slotKey);
    return {
      slotKey: slot.slotKey,
      placeName: hit?.nameKo ?? NAME_PENDING,
      // diff 엔 방문 여부가 없다 — 전 행 예정 톤(Seed Q6).
      tone: 'planned',
      photo: hit?.imageUrl ? { uri: hit.imageUrl } : null,
      category: hit?.category ?? null,
      timeLabel: `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`,
      categoryLabel: null,
      distanceRange: null,
      isFixed: slot.isFixed,
    };
  });
  const removed: ReplanRemovedVM[] = diff.entries
    .filter((entry) => entry.change === 'REMOVED')
    .map((entry) => ({
      slotKey: entry.slotKey,
      placeName: lookup(entry.slotKey)?.nameKo ?? NAME_PENDING,
      timeLabel: entry.beforeStart
        ? `원래 ${entry.beforeStart.slice(0, 5)}`
        : null,
    }));
  // 총거리를 모르면 곳 수만 — 0km 로 채우면 거짓 요약이다(openapi ReplanImpact).
  const km = diff.impact?.totalDistanceKm;
  const meta =
    km === null || km === undefined
      ? `${slots.length}곳`
      : `${slots.length}곳 · ${formatDistance(km * 1000)}`;
  return { slots, removed, meta };
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
  const draft = diff.data?.ready === true ? diff.data : undefined;
  const sheet = draft ? buildDraftSheet(draft, days) : undefined;
  const draftDate = draft?.date ?? undefined;
  const dayIndex =
    draftDate === undefined
      ? -1
      : days.findIndex((day) => day.date === draftDate);

  return (
    <ReplanDraftView
      variant={state.kind}
      center={
        deriveReplanMapAnchor({
          days: itinerary.data?.days,
          preferredDate: readFromInstant(data.fromInstant).date,
          origin: { lat: data.originLat, lng: data.originLng },
        }).center
      }
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
      noSolutionDescription={NO_SOLUTION_DESCRIPTION}
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
                params: { tripId, applied: sessionId },
              }),
          }
        )
      }
      onReopenRequest={() => router.push(`/trips/${tripId}/planb`)}
    />
  );
}
