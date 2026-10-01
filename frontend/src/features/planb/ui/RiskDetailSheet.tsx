import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import {
  WATCH_CATEGORY_LABEL,
  WATCH_STATUS_LABEL,
  type WatchKind,
} from '../config/watchLabels';
import type { RiskAffectedRow } from '../model/riskAffectedRow';
import type { TriggerWatchlistRow } from '../model/triggerWatchlist';
import { RiskWarningGlyph } from './PlanbGlyphs';

/**
 * TRIP-749 · i03 위험 상세 시트(Figma 4052:2427) — 순수 바텀시트(props + 콜백만).
 *
 * 지도 알약을 누르면 페이지가 이 시트를 **조건부 마운트**한다(열림 = 트리에 있음). 제목은 서버
 * `reason` 그대로, 영향 행은 `riskAffectedRow` 결과(null 이면 상자째 생략), 배지는 `triggerWatchlist`
 * 사영 행 순서 그대로다. [대안 보기] → onPressAlternative, 스크림 탭·아래로 끌기 → onClose.
 *
 * ★ 바텀시트 목 통과형(repo-traps): 실제 딤 전면 커버·끌어 닫기는 jest 사각(6-b 실기).
 */

export interface RiskDetailSheetProps {
  kind: WatchKind;
  title: string;
  affected: RiskAffectedRow | null;
  watchRows: TriggerWatchlistRow[];
  onPressAlternative: () => void;
  onClose: () => void;
}

// gorhom 기본 배경에 얹는 스타일 — 배경은 위로 끌 때(over-drag) 내용 아래 여분 패딩까지 칠하므로
// 끄지 않고 canvas(#FFFFFF)·rounded-t-sheet-top(24)으로 덮어쓴다(기본 라운드 15). Figma 위쪽 그림자
// `0 -4 16 rgba(0,0,0,.08)`도 여기 단다 — 내용 컨테이너는 overflow:hidden 이라 거기 달면 잘린다.
// 그림자 토큰이 없어 스타일 객체(리포 관례).
const SHEET_BACKGROUND = {
  backgroundColor: '#FFFFFF',
  borderRadius: 0,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 8,
} as const;

export function RiskDetailSheet({
  kind,
  title,
  affected,
  watchRows,
  onPressAlternative,
  onClose,
}: RiskDetailSheetProps): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      // 기본 핸들은 끈다 — grabber 는 아래 시트 본문이 토큰으로 그린다.
      handleComponent={null}
      backgroundStyle={SHEET_BACKGROUND}
      backdropComponent={() => (
        // 목/실라이브러리 모두 backdrop 에 prop 을 안 넘길 수 있어 onClose 를 클로저로 문다
        // (SlotCandidateSheet 선례).
        <Pressable
          testID="planb-risk-scrim"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="absolute inset-0 bg-scrim/40"
        />
      )}
    >
      <BottomSheetView
        testID="planb-risk-sheet"
        className="gap-lg rounded-t-sheet-top bg-canvas px-lg pb-3xl pt-md"
      >
        {/* grabber — Figma #DEDEDE 는 토큰이 없어 hairline-strong(#DDDDDD, 허용 차이). */}
        <View className="h-[4px] w-[40px] self-center rounded-pill bg-hairline-strong" />

        <View className="gap-xs">
          <View className="flex-row items-center gap-[6px]">
            <RiskWarningGlyph size={12} testID="planb-risk-warning" />
            <Text
              testID="planb-risk-eyebrow"
              className="font-noto-bold text-caption font-bold text-primary-text"
            >
              {`위험 요소 · ${WATCH_CATEGORY_LABEL[kind]}`}
            </Text>
          </View>
          <Text
            testID="planb-risk-title"
            className="font-noto-bold text-[20px] font-bold text-ink"
          >
            {title}
          </Text>
        </View>

        {affected === null ? null : (
          <View
            testID="planb-risk-affected"
            className="flex-row items-center gap-md rounded-button bg-surface-soft px-[14px] py-md"
          >
            <Text
              testID="planb-risk-affected-time"
              className="w-[64px] font-inter-bold text-[18px] text-body"
            >
              {affected.time}
            </Text>
            <View className="flex-1 gap-[2px]">
              <View className="flex-row items-center gap-sm">
                <Text
                  testID="planb-risk-affected-name"
                  className="font-noto-bold text-card-title font-bold text-ink"
                >
                  {affected.name}
                </Text>
                <View
                  testID="planb-risk-affected-tag"
                  className="rounded-button bg-primary-pale px-sm py-[3px]"
                >
                  <Text className="font-noto-bold text-micro font-bold text-primary">
                    영향
                  </Text>
                </View>
              </View>
              <Text
                testID="planb-risk-affected-meta"
                className="font-noto text-caption text-muted"
              >
                {affected.meta}
              </Text>
            </View>
          </View>
        )}

        <View className="gap-sm">
          <Text
            testID="planb-risk-watch-label"
            className="font-noto-bold text-caption font-bold text-body"
          >
            Plan-B가 지켜보는 것
          </Text>
          <View className="flex-row flex-wrap gap-[6px]">
            {watchRows.map((row) => {
              const active = row.status === 'active';
              return (
                <View
                  key={row.kind}
                  testID={`planb-risk-watch-${row.kind.toLowerCase()}`}
                  className={`rounded-button px-[10px] py-[5px] ${
                    active ? 'bg-primary-pale' : 'bg-surface-strong'
                  }`}
                >
                  <Text
                    className={`font-noto-bold text-micro font-bold ${
                      active ? 'text-primary' : 'text-muted'
                    }`}
                  >
                    {`${row.label} · ${WATCH_STATUS_LABEL[row.status]}`}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <Pressable
          testID="planb-risk-cta"
          accessibilityRole="button"
          onPress={onPressAlternative}
          className="h-[52px] w-full items-center justify-center rounded-button bg-primary"
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            대안 보기
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
