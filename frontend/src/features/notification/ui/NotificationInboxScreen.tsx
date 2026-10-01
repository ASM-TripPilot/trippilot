import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { NotificationIconKind } from '../model/notificationKind';
import { NotifBackChevronGlyph } from './NotificationGlyphs';
import { NotifBellGlyph } from './NotificationInboxGlyphs';
import { NotificationRow } from './NotificationRow';

/**
 * TRIP-576 · l01 알림함 화면 — 순수 프레젠테이션(주입 VM + onNavigate 콜백).
 * 페이지가 groupByDay·notificationKind·notificationAction·formatRelativeTime 로 접은 VM 을 받아
 * 그린다 — 화면은 재판정하지 않는다. route≠null 행은 Pressable(→onNavigate), 미읽음은 dot(View)
 * 조건부 렌더, PLAN_B 만 인라인 액션(notification-inbox-action). TRIP-773: 미읽음 행이 있으면 헤더
 * 오른쪽에 '모두 읽음'(-mark-all) — 호출·무효화·실패 문구는 페이지 몫이고 화면은 pending·error 를 그릴 뿐.
 * empty 는 StateNotice(제목 16·부제 13 고정)가 아닌 로컬 마크업 — Figma 1599:2388 수치가 다르다.
 *
 * testID: notification-inbox-header / -row / -unread-dot / -action / -mark-all / -mark-all-error /
 * -empty / -empty-box.
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
  onMarkAllRead: () => void;
  /** '모두 읽음' 처리 중 — 버튼 비활성. */
  markAllPending?: boolean;
  /** 실패 안내 문구(페이지 소유). null/undefined = 안내 없음. */
  markAllError?: string | null;
}

/** 글자 줄높이 20 + 위아래 12 = 터치 높이 44. */
const MARK_ALL_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };

/** ‹ 알림(좌 묶음) · 모두 읽음(우) 헤더. 좌측을 묶지 않으면 justify-between 이 제목을 가운데로 민다. */
function InboxHeader({
  onPressBack,
  markAll,
}: {
  onPressBack?: () => void;
  markAll?: { onPress: () => void; pending: boolean };
}): ReactElement {
  return (
    <View
      testID="notification-inbox-header"
      className="flex-row items-center justify-between border-b border-hairline px-lg pb-md pt-sm"
    >
      <View className="flex-row items-center gap-sm">
        <Pressable
          testID="notification-inbox-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <NotifBackChevronGlyph />
        </Pressable>
        <Text className="text-[20px] font-noto-bold text-ink">알림</Text>
      </View>
      {markAll ? (
        <Pressable
          testID="notification-inbox-mark-all"
          accessibilityRole="button"
          disabled={markAll.pending}
          onPress={markAll.onPress}
          hitSlop={MARK_ALL_HIT_SLOP}
          className={markAll.pending ? 'opacity-40' : undefined}
        >
          <Text className="font-noto text-body text-primary">모두 읽음</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function NotificationInboxScreen({
  sections,
  isEmpty,
  onNavigate,
  onPressBack,
  onMarkAllRead,
  markAllPending = false,
  markAllError,
}: NotificationInboxScreenProps): ReactElement {
  if (isEmpty) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
        <InboxHeader onPressBack={onPressBack} />
        <View
          testID="notification-inbox-empty"
          className="flex-1 items-center justify-center gap-[18px] px-lg"
        >
          <View
            testID="notification-inbox-empty-box"
            className="h-[112px] w-[112px] items-center justify-center rounded-[24px] border-[1.5px] border-dashed border-hairline-strong bg-canvas-alt"
          >
            {/* 24 viewBox 를 46 으로 그리므로 선 0.99 → 실제 1.9(Figma). */}
            <NotifBellGlyph size={46} strokeWidth={0.99} />
          </View>
          <Text className="font-noto-bold text-section text-ink">
            아직 받은 알림이 없어요
          </Text>
          <Text className="text-center font-noto text-[13.5px] text-muted">
            새로운 소식이 오면 여기에서 알려드릴게요
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasUnread = sections.some((section) =>
    section.rows.some((row) => row.unread)
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <InboxHeader
        onPressBack={onPressBack}
        markAll={
          hasUnread
            ? { onPress: onMarkAllRead, pending: markAllPending }
            : undefined
        }
      />
      {markAllError && hasUnread ? (
        <Text
          testID="notification-inbox-mark-all-error"
          className="px-lg pt-md font-noto text-label text-primary-text"
        >
          {markAllError}
        </Text>
      ) : null}
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
