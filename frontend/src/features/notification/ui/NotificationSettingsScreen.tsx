import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { NotificationToggleKind } from '@/shared/api/generated/schemas';

import { NotifBackChevronGlyph, NotifInfoGlyph } from './NotificationGlyphs';
import { PermissionBanner } from './PermissionBanner';
import { ToggleRow } from './ToggleRow';

/**
 * TRIP-607 · l02 알림 설정 화면 — 순수 프레젠테이션(값·콜백 주입).
 *
 * 화면이 그릴 kind 목록(6종·순서·라벨)을 **화면이 소유**한다 — 컨테이너가 넘긴 `values` 에
 * COMMUNITY·SYSTEM 이 섞여 있어도 화면은 이 6종만 순회하므로 렌더 트리에 나타나지 않는다
 * (notificationKindGuard 가 이 부재를 잠근다). 푸시 열의 disabled·ON 은 `pushColumnAvailable`
 * 로 게이트하고, 인앱 열은 권한과 무관하게 항상 조작 가능하다.
 *
 * 상태별 표면 전환:
 *  - 상단 배너: 권한 있음 = 정보("다음 알림부터 반영") / 거부 = 대시 권한 배너 + [설정 이동].
 *  - 열 헤더 푸시 자리: 권한 있음 = "푸시" 라벨 / 거부 = "권한 필요" 대시 칩.
 *  - 하단 배너: 권한 있음 = SYSTEM 줄 / 거부 = 푸시-누적 줄(프레임 실물대로 상태별 단일 문구).
 *
 * testID: notification-settings-toggle-push-{kind} · -inapp-{kind} · notification-settings-permission-banner.
 * 실제 픽셀(토글 회색·thumb 위치·딤)은 jest 원리적 사각 → 6-b 실기(LocationConsentScreen 동형).
 */

export type ToggleValueMap = Partial<
  Record<
    NotificationToggleKind,
    { pushEnabled: boolean; inAppEnabled: boolean }
  >
>;

export interface NotificationSettingsScreenProps {
  /** kind 로 키가 매겨진 토글 값 맵. 화면은 자신의 VISIBLE 목록(6종)만 조회한다. */
  values: ToggleValueMap;
  /** 푸시 열 조작 가능 여부(false=OS 권한 거부: 푸시 disabled + 권한 배너/칩). */
  pushColumnAvailable: boolean;
  onToggle: (
    kind: NotificationToggleKind,
    channel: 'push' | 'inapp',
    next: boolean
  ) => void;
  onOpenSettings: () => void;
  onPressBack?: () => void;
}

/** 화면이 소유하는 6종(순서·라벨) — COMMUNITY 는 U7 개통 전까지, SYSTEM 은 계약상 여기 없다. */
const VISIBLE_ROWS: { kind: NotificationToggleKind; label: string }[] = [
  { kind: 'STAY', label: '숙소 등록·저장 완료' },
  { kind: 'TRIP_PRE', label: '여행 시작 전' },
  { kind: 'TRIP_DAY', label: '당일 일정' },
  { kind: 'SLOT_PRE', label: '일정 시작 전' },
  { kind: 'PLAN_B', label: 'Plan-B 재계획' },
  { kind: 'REFLECTION', label: '회고 완료' },
];

const EMPTY_VALUE = { pushEnabled: false, inAppEnabled: false } as const;

/** ⓘ + 문구 정보 배너(상·하단 공용) — surface-soft 라운드 블록. */
function InfoBanner({ text }: { text: string }): ReactElement {
  return (
    <View className="flex-row items-center gap-sm rounded-[20px] bg-surface-soft px-lg py-md">
      <NotifInfoGlyph size={18} />
      <Text className="flex-1 font-noto text-label text-muted">{text}</Text>
    </View>
  );
}

export function NotificationSettingsScreen({
  values,
  pushColumnAvailable,
  onToggle,
  onOpenSettings,
  onPressBack,
}: NotificationSettingsScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas-alt">
      <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
        <Pressable
          testID="notification-settings-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <NotifBackChevronGlyph />
        </Pressable>
        <Text className="text-[18px] font-noto-bold text-ink">알림 설정</Text>
      </View>

      <ScrollView contentContainerClassName="gap-lg px-lg pb-3xl pt-lg">
        {pushColumnAvailable ? (
          <InfoBanner text="변경한 알림 설정은 다음 알림부터 바로 반영됩니다" />
        ) : (
          <PermissionBanner onOpenSettings={onOpenSettings} />
        )}

        {/* 열 헤더 — 두 토글 열 위에 정렬(ToggleRow 의 오른쪽 클러스터와 같은 w-[52px]·gap-md). */}
        <View className="flex-row items-center">
          <View className="flex-1" />
          <View className="flex-row gap-md">
            <View className="w-[52px] items-center">
              {pushColumnAvailable ? (
                <Text className="font-noto-bold text-label text-muted">
                  푸시
                </Text>
              ) : (
                <View className="rounded-pill border border-dashed border-hairline-strong px-sm py-[2px]">
                  <Text className="font-noto-medium text-caption text-muted">
                    권한 필요
                  </Text>
                </View>
              )}
            </View>
            <View className="w-[52px] items-center">
              <Text className="font-noto-bold text-label text-muted">인앱</Text>
            </View>
          </View>
        </View>

        {/* 종류 행 카드 — 한 카드에 6행. */}
        <View className="rounded-[20px] bg-canvas px-lg">
          {VISIBLE_ROWS.map((row, index) => (
            <ToggleRow
              key={row.kind}
              kind={row.kind}
              label={row.label}
              value={values[row.kind] ?? EMPTY_VALUE}
              pushColumnAvailable={pushColumnAvailable}
              onToggle={onToggle}
              showDivider={index > 0}
            />
          ))}
        </View>

        <InfoBanner
          text={
            pushColumnAvailable
              ? '모든 알림을 꺼도 보안·계정 관련 알림은 알림함에 표시됩니다'
              : '푸시를 꺼도 인앱 알림은 알림함에 계속 누적됩니다'
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}
