import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import type { NotificationIconKind } from '../model/notificationKind';
import { NotifBackChevronGlyph } from './NotificationGlyphs';
import { NotifBellGlyph } from './NotificationInboxGlyphs';
import { NotificationRow } from './NotificationRow';

/**
 * TRIP-576 · l01 알림함 화면 — 순수 프레젠테이션(주입 VM + onNavigate 콜백).
 * 페이지가 groupByDay·notificationKind·notificationAction·formatRelativeTime 로 접은 VM 을 받아
 * 그린다 — 화면은 재판정하지 않는다. route≠null 행은 Pressable(→onNavigate), 미읽음은 dot(View)
 * 조건부 렌더, PLAN_B 만 인라인 액션(notification-inbox-action). Figma 헤더의 '모두 읽음'은 렌더하지
 * 않는다(01b Q3 — 누를 수 없는 죽은 컨트롤은 INV-4 침묵 위반, 후속 티켓).
 *
 * testID: notification-inbox-row / -unread-dot / -action / -empty. (-mark-all 은 렌더하지 않는다.)
 */

// l01 카드 그림자(§8.2 MISS raw 허용 — 그림자는 토큰 대상 아님, RN shadow prop). features 경계로
// features/home 의 동형 softCardShadow 를 import 못 해 동일 값을 지역 상수로 둔다. '#000000'은 raw-hex 예외.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

export interface NotificationRowVM {
  id: string;
  icon: NotificationIconKind;
  title: string;
  body: string;
  /** "라벨 · 상대시각" 한 문자열(단일 Text 노드). */
  meta: string;
  unread: boolean;
  /** 행 press 목적지. null = 비활성(딥링크 없음·데이터없음 회고). */
  route: string | null;
  /** PLAN_B 인라인 링크 라벨. null = 인라인 액션 없음. */
  inlineActionLabel: string | null;
}

export interface NotificationSection {
  key: 'today' | 'earlier';
  label: string;
  rows: NotificationRowVM[];
}

export interface NotificationInboxScreenProps {
  sections: NotificationSection[];
  isEmpty: boolean;
  onNavigate: (route: string) => void;
  onPressBack?: () => void;
}

/** ‹ 알림 헤더(l02 와 동형). '모두 읽음'은 렌더하지 않는다(01b Q3). */
function InboxHeader({
  onPressBack,
}: {
  onPressBack?: () => void;
}): ReactElement {
  return (
    <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
      <Pressable
        testID="notification-inbox-back"
        accessibilityRole="button"
        onPress={onPressBack}
      >
        <NotifBackChevronGlyph />
      </Pressable>
      <Text className="text-[20px] font-noto-bold text-ink">알림</Text>
    </View>
  );
}

export function NotificationInboxScreen({
  sections,
  isEmpty,
  onNavigate,
  onPressBack,
}: NotificationInboxScreenProps): ReactElement {
  if (isEmpty) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
        <InboxHeader onPressBack={onPressBack} />
        <View className="flex-1 items-center justify-center px-lg">
          <StateNotice
            testID="notification-inbox-empty"
            illustration={
              <View className="h-[72px] w-[72px] items-center justify-center rounded-[20px] border-[1.5px] border-dashed border-hairline-strong">
                <NotifBellGlyph />
              </View>
            }
            title="아직 받은 알림이 없어요"
            description="새로운 소식이 오면 여기에서 알려드릴게요"
            actions={[]}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <InboxHeader onPressBack={onPressBack} />
      <ScrollView contentContainerClassName="gap-[22px] px-lg pb-[26px] pt-xl">
        {sections.map((section) => (
          <View key={section.key} className="gap-[10px]">
            <Text className="font-noto-bold text-label text-muted">
              {section.label}
            </Text>
            <View
              style={cardShadow}
              className="rounded-card border border-hairline bg-canvas"
            >
              {section.rows.map((row, index) => (
                <NotificationRow
                  key={row.id}
                  row={row}
                  onNavigate={onNavigate}
                  showDivider={index > 0}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
