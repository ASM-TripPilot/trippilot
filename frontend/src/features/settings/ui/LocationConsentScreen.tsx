import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  LocationBackChevronGlyph,
  LocationClockGlyph,
  LocationInfoGlyph,
  LocationPinGlyph,
  LocationSwapGlyph,
  LocationWarningGlyph,
} from '@/shared/location/LocationGlyphs';
import { LOCATION_ICON_COLORS } from '@/shared/location/lib/locationColors';
import type { RevokeImpact } from '@/shared/location/revokeImpact';

import { RevokeConfirmDialog } from './RevokeConfirmDialog';

/**
 * l06 위치정보 동의 화면(무상태 프레젠테이션 + 철회 게이트 UI 로직). 상태·서버 호출은 페이지 몫이고,
 * 화면은 철회 다이얼로그의 열림만 로컬로 쥔다(608 SettingsScreen 선례).
 *
 * 토글 press 가 곧 게이트다:
 *  - `disabled`(OS 권한 거부) → no-op(+ Pressable 이 press 실차단, AC-3).
 *  - `consentOn`(동의 ON) → 로컬 `dialogOpen=true`. **콜백 미호출**(즉시 PUT 금지 = 재확인 게이트).
 *  - else(동의 OFF) → `onGrant()`(승낙은 게이트 없이).
 * 다이얼로그 [취소] → 닫기만. [동의 철회] → `onRevokeConfirmed()` + 닫기.
 *
 * 딤 실제 덮임·모달 실제 열림은 jest 원리적 사각(6-b 실기 전용). permission-denied dimmed 픽셀·글리프
 * SVG 색/모양도 6-b (repo-traps).
 */
export interface LocationConsentScreenProps {
  consentOn: boolean;
  disabled: boolean;
  impact: RevokeImpact;
  onGrant: () => void;
  onRevokeConfirmed: () => void;
  onOpenSettings: () => void;
  onPressBack?: () => void;
}

/** 용도 3항목(US-NOTIF-11 정상) — 화면 고정 문안. */
const USAGE_ITEMS = [
  {
    Glyph: LocationClockGlyph,
    title: '이동 지연 감지',
    desc: '현재 위치로 일정 지연을 알아차려요',
  },
  {
    Glyph: LocationSwapGlyph,
    title: '실시간 Plan-B 재계획',
    desc: '막히면 즉시 대안 동선을 제안해요',
  },
  {
    Glyph: LocationPinGlyph,
    title: '주변 숙소·일정 추천',
    desc: '지금 위치 기준으로 추천해요',
  },
] as const;

export function LocationConsentScreen({
  consentOn,
  disabled,
  impact,
  onGrant,
  onRevokeConfirmed,
  onOpenSettings,
  onPressBack,
}: LocationConsentScreenProps): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);

  const subtitle = disabled
    ? 'OS 권한 거부로 사용 불가'
    : consentOn
      ? '동의함 · 정확한 위치 사용'
      : '동의 안 함 · 위치 미사용';

  const handleTogglePress = (): void => {
    if (disabled) return;
    if (consentOn) {
      setDialogOpen(true);
    } else {
      onGrant();
    }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas-alt">
      <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
        <Pressable
          testID="settings-location-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <LocationBackChevronGlyph />
        </Pressable>
        <Text className="text-[18px] font-noto-bold text-ink">
          위치정보 동의
        </Text>
      </View>

      <ScrollView contentContainerClassName="gap-lg px-lg pb-3xl pt-lg">
        {disabled ? (
          <View
            testID="settings-location-denied-banner"
            className="flex-row items-center gap-sm rounded-[20px] border border-dashed border-hairline-strong px-lg py-md"
          >
            <LocationWarningGlyph size={18} />
            <Text className="flex-1 font-noto text-body text-body">
              기기 설정에서 위치 권한을 허용하세요
            </Text>
            <Pressable
              testID="settings-location-open-settings"
              accessibilityRole="button"
              onPress={onOpenSettings}
              className="rounded-pill border border-hairline-strong px-md py-xs"
            >
              <Text className="font-noto-bold text-label text-ink">
                설정 이동
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* 토글 카드 */}
        <View className="flex-row items-center gap-md rounded-[20px] bg-canvas px-lg py-lg">
          <View className="flex-1">
            <Text className="font-noto-bold text-card-title text-ink">
              위치정보 수집
            </Text>
            <Text className="mt-xs font-noto text-label text-muted">
              {subtitle}
            </Text>
          </View>
          <Pressable
            testID="settings-location-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: consentOn, disabled }}
            disabled={disabled}
            onPress={handleTogglePress}
            className={`h-[30px] w-[52px] justify-center rounded-pill px-[3px] ${
              !disabled && consentOn
                ? 'items-end bg-primary'
                : 'items-start bg-hairline-strong'
            }`}
          >
            <View className="h-6 w-6 rounded-pill bg-canvas" />
          </Pressable>
        </View>

        {/* 이렇게 사용해요 — permission-denied 는 dimmed */}
        <View className={disabled ? 'gap-sm opacity-40' : 'gap-sm'}>
          <Text className="font-noto-bold text-label text-muted">
            이렇게 사용해요
          </Text>
          <View className="gap-md rounded-[20px] bg-canvas px-lg py-lg">
            {USAGE_ITEMS.map(({ Glyph, title, desc }) => (
              <View key={title} className="flex-row items-center gap-md">
                <View className="h-9 w-9 items-center justify-center rounded-card bg-surface-soft">
                  <Glyph size={20} />
                </View>
                <View className="flex-1">
                  <Text className="font-noto-bold text-body text-ink">
                    {title}
                  </Text>
                  <Text className="mt-[2px] font-noto text-label text-muted">
                    {desc}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 동의를 꺼도 계속 동작해요 배너 */}
        <View
          testID="settings-location-continue-banner"
          className={`gap-sm rounded-[20px] bg-surface-soft px-lg py-lg ${
            disabled ? 'opacity-40' : ''
          }`}
        >
          <View className="flex-row items-center gap-sm">
            <LocationInfoGlyph size={18} color={LOCATION_ICON_COLORS.ink} />
            <Text className="font-noto-bold text-body text-ink">
              동의를 꺼도 계속 동작해요
            </Text>
          </View>
          <View className="gap-xs pl-[26px]">
            {impact.continues.map((item) => (
              <View key={item} className="flex-row gap-sm">
                <Text className="font-noto text-label text-muted">·</Text>
                <Text className="flex-1 font-noto text-label text-muted">
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {dialogOpen ? (
        <RevokeConfirmDialog
          impact={impact}
          onCancel={() => setDialogOpen(false)}
          onConfirm={() => {
            onRevokeConfirmed();
            setDialogOpen(false);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
