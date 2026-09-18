import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { NotificationKindIcon } from './NotificationInboxGlyphs';
import type { NotificationRowVM } from './NotificationInboxScreen';

/**
 * TRIP-576 · l01 — 알림 1건 행. 화면이 순회하며 그린다.
 *
 * 무엇을 그리나(전부 주입 VM 으로 결정, 재판정 없음):
 *  - 미읽음 dot: `unread` 일 때만 `View`(bg-primary rounded-full)를 조건부 렌더(testID 존재/부재로
 *    미읽음을 표현 — SVG fill 토글 금지, 맹점③). 읽음 행은 dot 컬럼이 빈다.
 *  - 아이콘 타일 40px(bg surface-strong) + kind 글리프 22px.
 *  - 제목 + 메타("라벨 · 상대시각") 단일 Text 노드씩(§5-A 완전일치 매칭 보존).
 *  - 인라인 액션(`inlineActionLabel`≠null = PLAN_B): `notification-inbox-action` press→onNavigate(route).
 *  - 행 자체 press: 인라인 액션이 없고 route≠null(=REFLECTION)일 때만 onNavigate(route).
 *    route=null(데이터없음 회고·딥링크 없는 kind)이면 press 무동작.
 *
 * testID: notification-inbox-row / -unread-dot / -action.
 */

export interface NotificationRowProps {
  row: NotificationRowVM;
  onNavigate: (route: string) => void;
  /** 카드 안 두 번째 행부터 상단 hairline 구분선. */
  showDivider?: boolean;
}

export function NotificationRow({
  row,
  onNavigate,
  showDivider = false,
}: NotificationRowProps): ReactElement {
  const { route, inlineActionLabel } = row;
  // 행 전체 press 는 인라인 액션이 없을 때만(REFLECTION). PLAN_B 는 인라인 링크가 진다.
  const pressRow =
    route != null && inlineActionLabel == null
      ? () => onNavigate(route)
      : undefined;

  return (
    <Pressable
      testID="notification-inbox-row"
      accessibilityRole={pressRow ? 'button' : undefined}
      onPress={pressRow}
      className={`flex-row items-start gap-md p-[14px] ${
        showDivider ? 'border-t border-hairline' : ''
      }`}
    >
      {/* 미읽음 dot 컬럼(8px폭·40px높이) — 미읽음일 때만 dot(View) 렌더. */}
      <View className="h-10 w-[8px] items-center justify-center">
        {row.unread ? (
          <View
            testID="notification-inbox-unread-dot"
            className="h-2 w-2 rounded-full bg-primary"
          />
        ) : null}
      </View>

      {/* 아이콘 타일 40px. */}
      <View className="h-10 w-10 items-center justify-center rounded-[10px] bg-surface-strong">
        <NotificationKindIcon icon={row.icon} />
      </View>

      {/* 텍스트열 — 제목·메타·(선택)인라인 액션. */}
      <View className="flex-1 gap-xs">
        <Text className="font-noto-bold text-body leading-[20px] text-ink">
          {row.title}
        </Text>
        <Text className="font-noto text-caption text-muted">{row.meta}</Text>
        {inlineActionLabel != null && route != null ? (
          <Pressable
            testID="notification-inbox-action"
            accessibilityRole="button"
            onPress={() => onNavigate(route)}
            className="pt-[2px]"
          >
            <Text className="font-noto-medium text-label text-primary">
              {inlineActionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
