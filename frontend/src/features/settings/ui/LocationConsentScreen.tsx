import { Fragment, type ReactElement, useState } from 'react';
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
import { Toggle } from '@/shared/ui/Toggle';

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
 * 딤 실제 덮임·모달 실제 열림은 jest 원리적 사각(6-b 실기 전용). permission-denied 는 opacity 가 아니라
 * 색으로 흐린다(TRIP-780, Figma 1612:2440) — 픽셀·글리프 SVG 색/모양은 6-b (repo-traps).
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

/** 카드 그림자(Figma 0,2,10 · 6%) — 그림자는 className 으로 못 준다(HomeScreen 선례). */
const CARD_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

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

  // denied 는 opacity 로 블록을 흐리지 않는다 — 용도 카드는 흰 카드 그대로, 글자·아이콘 색만 흐린 톤.
  const tone = disabled
    ? {
        label: 'text-muted-soft',
        title: 'text-muted',
        desc: 'text-muted-soft',
        tile: 'bg-surface-soft',
        glyph: LOCATION_ICON_COLORS.mutedSoft,
      }
    : {
        label: 'text-muted',
        title: 'text-ink',
        desc: 'text-muted',
        tile: 'bg-surface-strong',
        glyph: LOCATION_ICON_COLORS.body,
      };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View className="flex-row items-center gap-[6px] border-b border-hairline bg-canvas px-lg pb-md pt-sm">
        <Pressable
          testID="settings-location-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <LocationBackChevronGlyph />
        </Pressable>
        <Text className="font-noto-bold text-section text-ink">
          위치정보 동의
        </Text>
      </View>

      <ScrollView
        contentContainerClassName={`px-lg pb-3xl pt-lg ${
          disabled ? 'gap-lg' : 'gap-xl'
        }`}
      >
        {disabled ? (
          <View
            testID="settings-location-denied-banner"
            className="flex-row items-center gap-[10px] rounded-[12px] border-[1.4px] border-dashed border-hairline-strong py-md pl-[14px] pr-md"
          >
            <LocationWarningGlyph
              size={18}
              color={LOCATION_ICON_COLORS.muted}
            />
            <Text className="flex-1 font-noto text-label text-body">
              기기 설정에서 위치 권한을 허용하세요
            </Text>
            <Pressable
              testID="settings-location-open-settings"
              accessibilityRole="button"
              onPress={onOpenSettings}
              className="rounded-[8px] border border-hairline-strong bg-canvas px-[13px] py-[7px]"
            >
              <Text className="text-[12.5px] font-noto-bold text-ink">
                설정 이동
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* 토글 카드 */}
        <View
          style={CARD_SHADOW}
          className="flex-row items-center gap-md rounded-[12px] border border-hairline bg-canvas p-lg"
        >
          <View className="flex-1">
            <Text className="font-noto-bold text-card-title text-ink">
              위치정보 수집
            </Text>
            <Text className="mt-[3px] text-[12.5px] font-noto text-muted">
              {subtitle}
            </Text>
          </View>
          <Toggle
            testID="settings-location-toggle"
            checked={consentOn}
            disabled={disabled}
            onPress={handleTogglePress}
          />
        </View>

        {/* 이렇게 사용해요 — 카드 한 장 안에 3행, 행 사이에만 구분선 */}
        <View testID="settings-location-usage-section" className="gap-[10px]">
          <Text className={`font-noto-bold text-label ${tone.label}`}>
            이렇게 사용해요
          </Text>
          <View
            testID="settings-location-usage-card"
            style={CARD_SHADOW}
            className="overflow-hidden rounded-[12px] border border-hairline bg-canvas"
          >
            {USAGE_ITEMS.map(({ Glyph, title, desc }, i) => (
              <Fragment key={title}>
                {i > 0 ? (
                  <View
                    testID="settings-location-usage-divider"
                    className="h-px bg-hairline"
                  />
                ) : null}
                <View
                  testID="settings-location-usage-row"
                  className="flex-row items-center gap-md px-lg py-[14px]"
                >
                  <View
                    className={`h-10 w-[22px] items-center justify-center rounded-[10px] ${tone.tile}`}
                  >
                    <Glyph size={22} color={tone.glyph} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`text-[14.5px] font-noto-bold ${tone.title}`}
                    >
                      {title}
                    </Text>
                    <Text
                      className={`mt-[3px] text-[12.5px] font-noto ${tone.desc}`}
                    >
                      {desc}
                    </Text>
                  </View>
                </View>
              </Fragment>
            ))}
          </View>
        </View>

        {/* 동의를 꺼도 계속 동작해요 배너 — denied 에서도 default 와 같다 */}
        <View
          testID="settings-location-continue-banner"
          className="gap-[10px] rounded-[12px] bg-surface-soft p-[14px]"
        >
          <View className="flex-row items-center gap-sm">
            <LocationInfoGlyph size={18} color={LOCATION_ICON_COLORS.muted} />
            <Text className="text-[13.5px] font-noto-bold text-body">
              동의를 꺼도 계속 동작해요
            </Text>
          </View>
          <View className="gap-[6px] pl-xs">
            {impact.continues.map((item) => (
              <View key={item} className="flex-row items-center gap-sm">
                <View className="h-1 w-1 rounded-pill bg-muted-soft" />
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
