import { Fragment, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { ReplanSlotVM } from '@/entities/itinerary-slot';
import { ReplanSlotRow } from '@/entities/itinerary-slot';
import type { MapCenter, MapPin } from '@/shared/map';
import { DistanceConnector } from '@/widgets/map-sheet-shell';
import { GenerationProgressCard } from '@/widgets/map-sheet-shell';
import { MapSheetShell } from '@/widgets/map-sheet-shell';
import { SheetHeader } from '@/widgets/map-sheet-shell';

import { ReplanSkeletonCards } from './ReplanSkeletonCards';

/**
 * TRIP-752 · i05 다시 짜는 중 **순수 뷰**(pages · api import 0 — preview 가 파일 경로로 직접 import).
 * Figma `4341:1957`. 전면 지도 + 좌상단 진행 카드(셸 overlay 자리) + 40% peek 시트(헤더 · 방문 완료 행 ·
 * 거리 커넥터). CTA 바는 없다 — ‹ 가 "백그라운드로"를 대신한다. 조회·판정·라우팅은 `PlanbSolvingPage` 몫.
 *
 * 진행 막대는 진행률 없이 흐르기만 한다(칸 1 완료 · 칸 2 인디터미닛 — 세션 계약에 진행률이 없다).
 * 시트 빈 곳엔 스켈레톤 슬롯 카드 2장이 펄스한다(TRIP-1205 · Figma `4817:2695`).
 */

const CARD_TITLE = 'AI가 일정을 다시 짜고 있어요';
const KEPT_LABEL = '방문한 곳 그대로';
const TITLE = 'AI 재계획안';
const SNAP_POINTS = ['40%', '88%'];
// TRIP-1277 — 경과·남은 시간 숫자를 넣지 않는다(INV-3, 세션 계약에 진행률이 없다).
const SLOW_TEXT = '시간이 걸리고 있어요';
const SLOW_SUBTEXT = '나가도 원래 일정은 그대로예요';
const CANCEL_FAILED_TEXT = '취소하지 못했어요. ‹ 로 나갈 수 있어요';

export interface ReplanSolvingViewProps {
  center: MapCenter;
  pins?: MapPin[];
  currentLocation?: MapCenter;
  /** 칸 2 캡션 — 예: `17시 이후 다시 짜는 중`(페이지가 fromInstant 로 조립). */
  solvingLabel: string;
  dayLabel: string;
  dateLabel: string;
  meta: string;
  /** 방문 완료 행(tone 'visited') — 콜백을 넘기지 않아 "다른 후보" 링크가 없다. */
  slots: ReplanSlotVM[];
  /** 앞 행과 원 일정에서 이웃하지 않는 행 — 그 앞 커넥터를 그리지 않는다(서버 거리는 바로 앞 슬롯 기준이라
   *  사이에 안 간 곳이 끼면 두 행 사이 거리가 아니다). */
  unlinkedSlotKeys?: readonly string[];
  /** 취소 요청 대기 중 — [취소] 잠금. */
  cancelPending?: boolean;
  /** TRIP-1277 — 화면에 들어온 지 오래됐다(페이지가 잰다). 시트 맨 위 안내 줄 — 요청은 그대로 둔다. */
  slow?: boolean;
  /** TRIP-1277 — [취소] 요청이 실패했다. 무음으로 두지 않고 한 줄로 알린다(INV-4). */
  cancelFailed?: boolean;
  onBack: () => void;
  onCancel: () => void;
}

export function ReplanSolvingView({
  center,
  pins,
  currentLocation,
  solvingLabel,
  dayLabel,
  dateLabel,
  meta,
  slots,
  unlinkedSlotKeys = [],
  cancelPending,
  slow = false,
  cancelFailed = false,
  onBack,
  onCancel,
}: ReplanSolvingViewProps): ReactElement {
  return (
    <MapSheetShell
      center={center}
      pins={pins}
      currentLocation={currentLocation}
      snapPoints={SNAP_POINTS}
      overlay={
        <GenerationProgressCard
          title={CARD_TITLE}
          cells={[
            { status: 'done', label: KEPT_LABEL },
            { status: 'active', label: solvingLabel },
          ]}
          onBack={onBack}
          onCancel={onCancel}
          cancelDisabled={cancelPending}
        />
      }
      header={
        <SheetHeader
          title={TITLE}
          dayLabel={dayLabel}
          dateLabel={dateLabel}
          meta={meta}
        />
      }
    >
      <View className="gap-sm px-lg pb-2xl">
        {cancelFailed ? (
          <Text
            testID="planb-solving-cancel-error"
            className="font-noto text-label text-primary-text"
          >
            {CANCEL_FAILED_TEXT}
          </Text>
        ) : null}
        {slow ? (
          <View testID="planb-solving-slow" className="gap-xs">
            <Text className="font-noto-bold text-label font-bold text-ink">
              {SLOW_TEXT}
            </Text>
            <Text className="font-noto text-label text-muted">
              {SLOW_SUBTEXT}
            </Text>
          </View>
        ) : null}
        {slots.map((slot, index) => {
          const next = slots[index + 1];
          return (
            <Fragment key={slot.slotKey}>
              <ReplanSlotRow vm={slot} index={index} />
              {next !== undefined &&
              !unlinkedSlotKeys.includes(next.slotKey) ? (
                <DistanceConnector
                  slotKey={next.slotKey}
                  distanceRange={next.distanceRange}
                />
              ) : null}
            </Fragment>
          );
        })}
        <ReplanSkeletonCards leadingConnector={slots.length > 0} />
      </View>
    </MapSheetShell>
  );
}
