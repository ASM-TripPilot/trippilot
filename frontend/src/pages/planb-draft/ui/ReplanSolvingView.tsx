import { Fragment, type ReactElement } from 'react';
import { View } from 'react-native';

import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';
import { ReplanSlotRow } from '@/entities/itinerary-slot/ui/ReplanSlotRow';
import type { MapCenter, MapPin } from '@/shared/map';
import { DistanceConnector } from '@/widgets/map-sheet-shell/ui/DistanceConnector';
import { GenerationProgressCard } from '@/widgets/map-sheet-shell/ui/GenerationProgressCard';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';

/**
 * TRIP-752 · i05 다시 짜는 중 **순수 뷰**(pages · api import 0 — preview 가 파일 경로로 직접 import).
 * Figma `4341:1957`. 전면 지도 + 좌상단 진행 카드(셸 overlay 자리) + 40% peek 시트(헤더 · 방문 완료 행 ·
 * 거리 커넥터). CTA 바는 없다 — ‹ 가 "백그라운드로"를 대신한다. 조회·판정·라우팅은 `PlanbSolvingPage` 몫.
 *
 * 진행 막대는 정적이다(칸 1 완료 · 칸 2 진행 중) — 세션 계약에 진행률이 없다.
 */

const CARD_TITLE = 'AI가 일정을 다시 짜고 있어요';
const KEPT_LABEL = '방문한 곳 그대로';
const TITLE = 'AI 재계획안';
const SNAP_POINTS = ['40%', '88%'];

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
      </View>
    </MapSheetShell>
  );
}
