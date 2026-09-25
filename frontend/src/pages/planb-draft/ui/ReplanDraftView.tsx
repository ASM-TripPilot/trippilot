import { Fragment, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';
import { ReplanSlotRow } from '@/entities/itinerary-slot/ui/ReplanSlotRow';
import type { MapCenter, MapPin } from '@/shared/map';
import type { CtaButton } from '@/widgets/map-sheet-shell/ui/CtaBar';
import type { DayChip } from '@/widgets/map-sheet-shell/ui/DayChipOverlay';
import { DistanceConnector } from '@/widgets/map-sheet-shell/ui/DistanceConnector';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';

/**
 * TRIP-751 · i06 재계획안 **순수 뷰**(pages · api import 0 — preview 가 파일 경로로 직접 import, TRIP-610).
 * Figma `4314:1923`(펼침) · `4335:1923`(대안 없음). 지도+시트 셸 위에 헤더 · 번호 행 · 거리 커넥터 · CTA.
 * 조회·판정·확정·라우팅은 페이지(`PlanbDraftPage`) 몫이다. pages 층에 둔 이유는 widgets 셸을 import 할
 * 수 있는 가장 낮은 층이기 때문이다(features 는 widgets 를 못 올려다본다).
 *
 * 한 화면 세 얼굴(variant): draft(펼침) / noSolution(대안 없음) / failed(E3). 뒤 둘과 확정 실패(Q6)는
 * 헤더 아래 같은 안내 자리를 쓴다. 대안 없음이면 곳 수를 지우고 예정 행을 전부 흐린다(Seed Q3).
 * 시트는 항상 펼침(index 2 — 셸 기본 배열 [닫힘·peek·펼침])으로 연다 — 실제 88% 스냅은 6-b 몫.
 */

// 확정 실패 안내 — PlanbDiffPage ERROR 와 같은 카피(BR-U4-32 "원 일정 유지"를 말로 알림, Q6).
const APPLY_FAILED_NOTICE = {
  title: '변경을 반영하지 못했어요',
  description: '원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.',
};
const FAILED_NOTICE = {
  title: '다시 짜지 못했어요',
  description: '잠시 후 다시 시도하거나 직접 고쳐 주세요',
};
const NO_SOLUTION_TITLE = '대안을 찾지 못했어요';
const TITLE = 'AI 재계획안';

type ReplanDraftVariant = 'draft' | 'noSolution' | 'failed';

export interface ReplanDraftViewProps {
  variant: ReplanDraftVariant;
  center: MapCenter;
  pins?: MapPin[];
  days: DayChip[];
  selectedDayIndex: number;
  dayLabel: string;
  dateLabel: string;
  meta: string;
  slots: ReplanSlotVM[];
  /** 대안 없음 부제 — 서버가 사유를 주지 않아 주입받는다(Seed Q4). */
  noSolutionDescription?: string;
  /** 확정 요청 중 — [적용하기] 잠금(이중 POST → 409 차단, Q6). */
  applyPending?: boolean;
  /** 확정 실패 — 같은 안내 자리에 실패 문구(Q6). */
  applyFailed?: boolean;
  onBack: () => void;
  onManualEdit: () => void;
  onApply: () => void;
  onReopenRequest: () => void;
  onPressCandidates?: (slotKey: string) => void;
}

export function ReplanDraftView({
  variant,
  center,
  pins,
  days,
  selectedDayIndex,
  dayLabel,
  dateLabel,
  meta,
  slots,
  noSolutionDescription,
  applyPending,
  applyFailed,
  onBack,
  onManualEdit,
  onApply,
  onReopenRequest,
  onPressCandidates,
}: ReplanDraftViewProps): ReactElement {
  const isDraft = variant === 'draft';
  const notice =
    variant === 'noSolution'
      ? { title: NO_SOLUTION_TITLE, description: noSolutionDescription ?? '' }
      : variant === 'failed'
        ? FAILED_NOTICE
        : applyFailed
          ? APPLY_FAILED_NOTICE
          : null;

  const manualButton: CtaButton = {
    label: '직접 수정',
    variant: 'outline',
    onPress: onManualEdit,
    // 교차 잠금(PlanbDiffPage 선례) — 확정 요청 중 편집으로 떠나면 밑에 남은 이 화면의 onSuccess 가
    // 맨 위(편집) 화면을 허브로 갈아 끼운다.
    disabled: applyPending,
  };
  const primaryButton: CtaButton = isDraft
    ? {
        label: '적용하기',
        variant: 'primary',
        onPress: onApply,
        disabled: applyPending,
      }
    : {
        label: variant === 'noSolution' ? '조건 바꿔 다시 짜기' : '다시 시도',
        variant: 'primary',
        onPress: onReopenRequest,
      };

  return (
    <MapSheetShell
      center={center}
      pins={pins}
      days={days}
      selectedDayIndex={selectedDayIndex}
      onBack={onBack}
      initialIndex={2}
      header={
        <>
          <SheetHeader
            title={TITLE}
            dayLabel={dayLabel}
            dateLabel={dateLabel}
            meta={isDraft ? meta : ''}
          />
          {notice !== null ? (
            <View testID="planb-draft-notice" className="gap-xs px-lg pb-md">
              <Text
                testID="planb-draft-notice-title"
                className="font-noto-bold text-[20px] font-bold text-ink"
              >
                {notice.title}
              </Text>
              <Text
                testID="planb-draft-notice-description"
                className="font-noto text-label text-muted"
              >
                {notice.description}
              </Text>
            </View>
          ) : null}
        </>
      }
      cta={[manualButton, primaryButton]}
    >
      <View className="gap-sm px-lg pb-2xl">
        {slots.map((slot, index) => {
          const next = slots[index + 1];
          // 이미 다녀온(visited) 행은 바꿀 수 없다 — 후보 교체·흐림은 예정 행에만.
          const planned = slot.tone === 'planned';
          return (
            <Fragment key={slot.slotKey}>
              <ReplanSlotRow
                vm={slot}
                index={index}
                dimmed={variant === 'noSolution' && planned}
                onPressCandidates={
                  isDraft && planned ? onPressCandidates : undefined
                }
              />
              {next !== undefined ? (
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
