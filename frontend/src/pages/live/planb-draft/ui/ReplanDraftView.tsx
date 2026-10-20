import { Fragment, useContext, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { ReplanSlotVM } from '@/entities/itinerary-slot';
import { ReplanSlotRow } from '@/entities/itinerary-slot';
import type { MapCenter, MapPin } from '@/shared/map';
import type { CtaButton } from '@/widgets/map-sheet-shell';
import type { DayChip } from '@/widgets/map-sheet-shell';
import { DistanceConnector } from '@/widgets/map-sheet-shell';
import { CTA_BAR_HEIGHT, MapSheetShell } from '@/widgets/map-sheet-shell';
import { SheetHeader } from '@/widgets/map-sheet-shell';

/**
 * TRIP-751 · i06 재계획안 **순수 뷰**(pages · api import 0 — preview 가 파일 경로로 직접 import, TRIP-610).
 * Figma `4314:1923`(펼침) · `4335:1923`(대안 없음). 지도+시트 셸 위에 헤더 · 번호 행 · 거리 커넥터 · CTA.
 * 조회·판정·확정·라우팅은 페이지(`PlanbDraftPage`) 몫이다. pages 층에 둔 이유는 widgets 셸을 import 할
 * 수 있는 가장 낮은 층이기 때문이다(features 는 widgets 를 못 올려다본다).
 *
 * 한 화면 세 얼굴(variant): draft(펼침) / noSolution(대안 없음) / failed(E3). 뒤 둘과 확정 실패(Q6)는
 * 헤더 아래 같은 안내 자리를 쓴다. 대안 없음이면 곳 수를 지우고 예정 행을 전부 흐린다(Seed Q3).
 * 시트는 항상 펼침(index 2 — 셸 기본 배열 [닫힘·peek·펼침])으로 연다 — 실제 88% 스냅은 6-b 몫.
 *
 * 상황 감지 FE-B(frontend-components §3.6) — 머리에 `미리 준비한 대안` 표식(`prepared`), 낡음 얼굴(`stale` — 같은 안내 자리에
 * 문구 + [새 대안 보기], [적용하기] 잠금), 미포함 안내 한 줄(`includeMissingText`). 문구·자리는 정본 작도 스펙이다(G-SA-12).
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
// 상황 감지 FE-B(frontend-components §3.6) — 문구는 정본 그대로. 재요청 실패는 i04 시작 실패와 같은 문장이다
// (낡음 얼굴 [새 대안 보기] · 실패 얼굴 [다시 시도] 공용).
const PREPARED_MARK = '미리 준비한 대안';
const STALE_TITLE = '시간이 지나 이 대안은 지금 일정과 맞지 않아요';
const STALE_RETRY_LABEL = '새 대안 보기';
const RETRY_FAILED =
  '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요';
// TRIP-1214 — 셸 기본 배열의 닫힘 칸(28)은 CTA 바를 뺀다. 초안은 시트를 내리고 지도를 보다 바로 [적용하기]를
// 눌러야 하므로, 가장 낮은 칸을 CTA 바 위(손잡이 28 + 바 높이 + 하단 안전 영역)로 직접 준다 — 직접 준 배열은
// 닫힘 규칙이 안 걸려 버튼이 항상 남고, 손잡이는 바 위에 보인다. 셸 기본값은 안 건드린다(다른 소비처 영향).
const HANDLE_HEIGHT = 28;

type ReplanDraftVariant = 'draft' | 'noSolution' | 'failed';

/** 원 일정에서 빠지는 슬롯 1행(BR-U4-25) — 번호 원 없이 흐리게, 원래 시각과 함께(TRIP-1007). */
export interface ReplanRemovedVM {
  slotKey: string;
  placeName: string;
  /** `원래 HH:mm` — 원래 시각을 모르면 null(요소째 안 그린다). */
  timeLabel: string | null;
}

interface ReplanNotice {
  title: string;
  description: string;
}

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
  /** 빠지는 곳(TRIP-1007) — 초안 행 아래 따로 그린다. */
  removed?: ReplanRemovedVM[];
  /** 행 사이 거리 커넥터 — 기본 켬. 서버 초안엔 행 거리가 없어 페이지가 끈다(TRIP-1007). */
  showConnectors?: boolean;
  /** 초안 얼굴의 안내(초안 로딩·조회 실패, TRIP-1007) — 확정 실패 안내가 있으면 그쪽이 먼저다. */
  draftNotice?: ReplanNotice | null;
  /** 초안이 아직 없어 [적용하기]만 잠근다(INV-4) — [직접 수정]은 살린다. */
  applyDisabled?: boolean;
  /** 대안 없음 부제 — 서버가 사유를 주지 않아 주입받는다(Seed Q4). */
  noSolutionDescription?: string;
  /** 확정 요청 중 — [적용하기] 잠금(이중 POST → 409 차단, Q6). */
  applyPending?: boolean;
  /** 확정 실패 — 같은 안내 자리에 실패 문구(Q6). */
  applyFailed?: boolean;
  /** 오늘 대안 없음 + 내일이 일정에 있을 때만 페이지가 준다 — 안내 아래 [내일 일정 다시 짜기]. 없으면 안 그린다. */
  onReplanNextDay?: () => void;
  /** 내일 재계획 시작 요청 중 — 보조 버튼 잠금(이중 POST 차단). */
  replanNextDayPending?: boolean;
  /** 상황 감지 FE-B — 서버가 미리 짠 대안(SYSTEM 세션)이면 머리에 `미리 준비한 대안` 표식. */
  prepared?: boolean;
  /** 적용이 409 EXPIRED·STALE 로 거절됐다 — 낡음 얼굴(안내 + [새 대안 보기]) · [적용하기] 잠금. */
  stale?: boolean;
  /** [새 대안 보기] — 같은 입력으로 새 세션(페이지 몫). 없으면 버튼이 없다(다시 짤 수 없는 지난 날 초안). */
  onRetryStale?: () => void;
  /** 새 세션 요청 중 — [새 대안 보기] 잠금. */
  staleRetryPending?: boolean;
  /** 새 세션 요청 실패 — 낡음 안내 아래 한 줄(INV-4). */
  staleRetryFailed?: boolean;
  /** 실패 얼굴 [다시 시도](같은 입력으로 새 세션)가 실패했다 — 부제를 시작 실패 문장으로 바꾼다(INV-4). */
  retryFailed?: boolean;
  /** 넣으려던 장소가 초안에 없다는 문장(페이지가 만든다) — 없으면 안 그린다. */
  includeMissingText?: string | null;
  onBack: () => void;
  onManualEdit: () => void;
  onApply: () => void;
  /** 대안 없음 [조건 바꿔 다시 짜기]·실패 [다시 시도] — 무엇을 하는지(시드 i04 · 같은 입력 새 세션)는 페이지 몫. */
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
  removed = [],
  showConnectors = true,
  draftNotice = null,
  noSolutionDescription,
  applyPending,
  applyDisabled,
  applyFailed,
  onReplanNextDay,
  replanNextDayPending,
  prepared = false,
  stale = false,
  onRetryStale,
  staleRetryPending,
  staleRetryFailed,
  retryFailed = false,
  includeMissingText = null,
  onBack,
  onManualEdit,
  onApply,
  onReopenRequest,
  onPressCandidates,
}: ReplanDraftViewProps): ReactElement {
  const isDraft = variant === 'draft';
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const notice: ReplanNotice | null =
    variant === 'noSolution'
      ? { title: NO_SOLUTION_TITLE, description: noSolutionDescription ?? '' }
      : variant === 'failed'
        ? retryFailed
          ? { ...FAILED_NOTICE, description: RETRY_FAILED }
          : FAILED_NOTICE
        : applyFailed
          ? APPLY_FAILED_NOTICE
          : draftNotice;

  const manualButton: CtaButton = {
    label: '직접 수정',
    variant: 'outline',
    onPress: onManualEdit,
    // 교차 잠금(PlanbDiffPage 선례) — 확정 요청 중 편집으로 떠나면 밑에 남은 이 화면의 onSuccess 가
    // 맨 위(편집) 화면을 허브로 갈아 끼운다. 내일 재계획 시작 요청 중도 같은 이유(solving 으로 갈아 끼움).
    disabled: applyPending || replanNextDayPending,
  };
  const primaryButton: CtaButton = isDraft
    ? {
        label: '적용하기',
        variant: 'primary',
        onPress: onApply,
        // 낡은 초안은 다시 눌러도 같은 409 다 — [새 대안 보기]로만 나아간다(INV-SA-7).
        disabled: applyPending || applyDisabled || stale,
      }
    : {
        label: variant === 'noSolution' ? '조건 바꿔 다시 짜기' : '다시 시도',
        variant: 'primary',
        onPress: onReopenRequest,
        disabled: replanNextDayPending,
      };

  return (
    <MapSheetShell
      center={center}
      pins={pins}
      // TRIP-1204 — 시트가 열린 채로도 손가락 확대·이동(셸 기본은 열림=잠금). 6-b 실기 전용.
      mapViewOnly={false}
      days={days}
      selectedDayIndex={selectedDayIndex}
      onBack={onBack}
      snapPoints={[HANDLE_HEIGHT + CTA_BAR_HEIGHT + bottomInset, '45%', '88%']}
      initialIndex={2}
      header={
        <>
          <SheetHeader
            title={TITLE}
            dayLabel={dayLabel}
            dateLabel={dateLabel}
            meta={isDraft ? meta : ''}
          />
          {prepared ? (
            <Text
              testID="planb-draft-prepared"
              className="px-lg pb-sm font-noto-bold text-caption font-bold text-primary-text"
            >
              {PREPARED_MARK}
            </Text>
          ) : null}
          {stale ? (
            <View testID="planb-draft-stale" className="gap-xs px-lg pb-md">
              <Text className="font-noto-bold text-[20px] font-bold text-ink">
                {STALE_TITLE}
              </Text>
              {staleRetryFailed ? (
                <Text
                  testID="planb-draft-stale-failed"
                  className="font-noto text-label text-muted"
                >
                  {RETRY_FAILED}
                </Text>
              ) : null}
              {/* 보조 버튼 자리·모양은 [내일 일정 다시 짜기]와 같다 — CTA 바는 1~2버튼이라 안내 아래에 둔다.
                  다시 짤 수 없는 초안(지난 날)이면 페이지가 onRetryStale 을 주지 않는다 — 늘 실패할 버튼을 두지 않는다. */}
              {onRetryStale ? (
                <Pressable
                  testID="planb-draft-stale-retry"
                  accessibilityRole="button"
                  onPress={onRetryStale}
                  disabled={staleRetryPending}
                  accessibilityState={{ disabled: staleRetryPending === true }}
                  className="mt-xs self-start rounded-pill border border-hairline-strong bg-canvas px-lg py-sm"
                >
                  <Text className="font-noto-bold text-label font-bold text-ink">
                    {STALE_RETRY_LABEL}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : notice !== null ? (
            <View testID="planb-draft-notice" className="gap-xs px-lg pb-md">
              <Text
                testID="planb-draft-notice-title"
                className="font-noto-bold text-[20px] font-bold text-ink"
              >
                {notice.title}
              </Text>
              {notice.description !== '' ? (
                <Text
                  testID="planb-draft-notice-description"
                  className="font-noto text-label text-muted"
                >
                  {notice.description}
                </Text>
              ) : null}
              {/* CTA 바는 1~2버튼이라 보조 버튼은 안내 아래에 둔다. */}
              {onReplanNextDay ? (
                <Pressable
                  testID="planb-draft-next-day"
                  accessibilityRole="button"
                  onPress={onReplanNextDay}
                  disabled={replanNextDayPending}
                  className="mt-xs self-start rounded-pill border border-hairline-strong bg-canvas px-lg py-sm"
                >
                  <Text className="font-noto-bold text-label font-bold text-ink">
                    내일 일정 다시 짜기
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {includeMissingText ? (
            <Text
              testID="planb-draft-include-missing"
              className="px-lg pb-md font-noto text-label text-muted"
            >
              {includeMissingText}
            </Text>
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
              {showConnectors && next !== undefined ? (
                <DistanceConnector
                  slotKey={next.slotKey}
                  distanceRange={next.distanceRange}
                />
              ) : null}
            </Fragment>
          );
        })}
        {removed.length > 0 ? (
          <View className="mt-md gap-sm">
            <Text className="font-noto-bold text-label text-muted">
              {`이번 계획에서 빠지는 곳 ${removed.length}곳`}
            </Text>
            {removed.map((row) => (
              <View
                key={row.slotKey}
                testID={`planb-draft-removed-${row.slotKey}`}
                className="gap-[6px] rounded-card border border-hairline bg-canvas p-[11px] opacity-45"
              >
                {row.timeLabel !== null ? (
                  <Text className="font-noto-bold text-caption leading-[15px] text-ink">
                    {row.timeLabel}
                  </Text>
                ) : null}
                <Text
                  numberOfLines={1}
                  className="font-noto-bold text-card-title font-bold leading-[18px] text-ink"
                >
                  {row.placeName}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </MapSheetShell>
  );
}
