import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

/**
 * TRIP-754 · i08 변경 반영 시트(Figma 4401:1568) — 순수 바텀시트(props + 콜백만).
 *
 * 재계획안을 반영하고 허브로 돌아오면(`?applied=`) 페이지가 허브의 형제로 **조건부 마운트**한다.
 * 부제·요약 배지·변경 내역은 데이터가 올 때만 그린다 — 없거나 빈 배열이면 컨테이너째 생략(E4).
 * [확인]·스크림 탭·아래로 끌기 → onConfirm(닫기), [되돌리기] → onRevert(E2 — 페이지가 안내만 켠다).
 *
 * ★ 바텀시트 목 통과형(repo-traps): 실제 딤 전면 커버·끌어 닫기는 jest 사각(6-b 실기).
 */

export type AppliedDiffKind = 'added' | 'removed';

export interface AppliedDiffRow {
  kind: AppliedDiffKind;
  name: string;
  meta: string;
}

export interface ReplanAppliedSheetProps {
  subtitleLines?: readonly string[];
  summaryBadges?: readonly string[];
  diffRows?: readonly AppliedDiffRow[];
  showRevertNotice?: boolean;
  onConfirm: () => void;
  onRevert: () => void;
}

const DIFF_KIND: Record<AppliedDiffKind, { label: string; dot: string }> = {
  added: { label: '추가', dot: 'bg-success' },
  removed: { label: '삭제', dot: 'bg-primary' },
};

// i03 RiskDetailSheet 와 같은 자리(gorhom 배경)지만 Figma 그림자 값이 다르다 — `0 -3 16 rgba(0,0,0,.12)`.
const SHEET_BACKGROUND = {
  backgroundColor: '#FFFFFF',
  borderRadius: 0,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: -3 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 8,
} as const;

export function ReplanAppliedSheet({
  subtitleLines = [],
  summaryBadges = [],
  diffRows = [],
  showRevertNotice = false,
  onConfirm,
  onRevert,
}: ReplanAppliedSheetProps): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onConfirm}
      handleComponent={null}
      backgroundStyle={SHEET_BACKGROUND}
      backdropComponent={() => (
        <Pressable
          testID="planb-applied-scrim"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onConfirm}
          className="absolute inset-0 bg-scrim/40"
        />
      )}
    >
      <BottomSheetView
        testID="planb-applied-sheet"
        className="gap-lg rounded-t-sheet-top bg-canvas px-lg pb-2xl pt-md"
      >
        <View className="h-[5px] w-[40px] self-center rounded-pill bg-hairline-strong" />

        <View className="gap-[6px]">
          <Text
            testID="planb-applied-eyebrow"
            className="font-noto-bold text-caption font-bold leading-[14px] text-success"
          >
            변경 반영됨
          </Text>
          <Text
            testID="planb-applied-title"
            className="font-noto-bold text-hero font-bold leading-[27px] text-ink"
          >
            새 일정이 반영됐어요
          </Text>
        </View>

        {subtitleLines.length === 0 ? null : (
          <View testID="planb-applied-subtitle" className="gap-xs">
            {subtitleLines.map((line, index) => (
              <Text
                key={line}
                testID="planb-applied-subtitle-line"
                className={`font-noto text-body leading-[17px] ${index === 0 ? 'text-body' : 'text-muted'}`}
              >
                {line}
              </Text>
            ))}
          </View>
        )}

        {summaryBadges.length === 0 ? null : (
          <View
            testID="planb-applied-summary"
            className="flex-row flex-wrap gap-sm"
          >
            {summaryBadges.map((badge) => (
              <View
                key={badge}
                testID="planb-applied-badge"
                className="rounded-[8px] bg-surface-strong px-[10px] py-[5px]"
              >
                <Text className="font-noto text-caption leading-[13px] text-body">
                  {badge}
                </Text>
              </View>
            ))}
          </View>
        )}

        {diffRows.length === 0 ? null : (
          <View
            testID="planb-applied-diff"
            className="gap-md rounded-button bg-surface-soft p-[14px]"
          >
            {diffRows.map((row) => (
              <View
                key={`${row.kind}-${row.name}`}
                testID="planb-applied-diff-row"
                className="gap-xs"
              >
                <View className="flex-row items-center gap-sm">
                  <View className="flex-row items-center gap-xs">
                    <View
                      testID="planb-applied-diff-dot"
                      className={`h-[6px] w-[6px] rounded-pill ${DIFF_KIND[row.kind].dot}`}
                    />
                    <Text
                      testID="planb-applied-diff-kind"
                      className="font-noto-bold text-caption font-bold leading-[14px] text-ink"
                    >
                      {DIFF_KIND[row.kind].label}
                    </Text>
                  </View>
                  <Text
                    testID="planb-applied-diff-name"
                    className="font-noto-bold text-card-title font-bold leading-[18px] text-ink"
                  >
                    {row.name}
                  </Text>
                </View>
                <Text
                  testID="planb-applied-diff-meta"
                  className="font-noto text-caption leading-[14px] text-muted"
                >
                  {row.meta}
                </Text>
              </View>
            ))}
          </View>
        )}

        {showRevertNotice ? (
          <Text
            testID="planb-applied-revert-notice"
            className="font-noto text-caption text-body"
          >
            이미 반영돼 되돌릴 수 없어요
          </Text>
        ) : null}

        <View className="flex-row gap-sm">
          <Pressable
            testID="planb-applied-revert"
            accessibilityRole="button"
            onPress={onRevert}
            className="h-[52px] w-[140px] items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              되돌리기
            </Text>
          </Pressable>
          <Pressable
            testID="planb-applied-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              확인
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
