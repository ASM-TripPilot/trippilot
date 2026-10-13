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
} from '@/shared/location/index.view';
import { LOCATION_ICON_COLORS } from '@/shared/location/index.view';
import type {
  AutomationStatusView,
  RevokeImpact,
} from '@/shared/location/index.view';
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
  /** 동의 조회 상태 — 생략이면 'ready'. 로딩·실패는 토글 대신 별도 얼굴(TRIP-1194, "동의 안 함"으로 접지 않음). */
  loadState?: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
  /** 마지막 저장 실패 — 토글 카드 아래 안내(INV-4). */
  saveFailed?: boolean;
  /**
   * TRIP-1341 · U10 자동 기록 상태 행(Figma u10d 4860:3767). 플래그 OFF 면 페이지가 null 을 줘 행·사용처 추가가 없다.
   */
  automation?: AutomationStatusView | null;
  /** [켜기] — 승격 설명을 띄운다(페이지 몫). */
  onPressAutomationEnable?: () => void;
  /** `설정 열기` — OS 설정 앱. */
  onPressAutomationSettings?: () => void;
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

/** TRIP-1341 — 플래그 ON 빌드에서만 붙는 4번째 사용처(G-U10-8). */
const AUTOMATION_USAGE = {
  Glyph: LocationPinGlyph,
  title: '자동 방문 기록 · 이동 경로',
  desc: '여행 날짜 동안 앱을 닫아도 방문과 다닌 길을 기록해요',
} as const;

/** 토글 카드 제목 — 스위치 이름(accessibilityLabel)도 이 값을 쓴다(카피 수정 시 둘이 어긋나지 않게). */
const TOGGLE_TITLE = '위치정보 수집';

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
  loadState = 'ready',
  onRetry,
  saveFailed = false,
  automation = null,
  onPressAutomationEnable,
  onPressAutomationSettings,
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

        {/* 토글 카드 — 조회 로딩·실패는 "동의 안 함"으로 접지 않고 별도 얼굴(TRIP-1194) */}
        {loadState === 'loading' ? (
          <View
            testID="settings-location-consent-loading"
            style={CARD_SHADOW}
            className="rounded-[12px] border border-hairline bg-canvas p-lg"
          >
            <Text className="font-noto text-label text-muted">
              동의 상태를 불러오는 중이에요
            </Text>
          </View>
        ) : loadState === 'error' ? (
          <View
            testID="settings-location-consent-error"
            style={CARD_SHADOW}
            className="gap-md rounded-[12px] border border-hairline bg-canvas p-lg"
          >
            <Text className="font-noto text-label text-body">
              동의 상태를 불러오지 못했어요
            </Text>
            <Pressable
              testID="settings-location-consent-retry"
              accessibilityRole="button"
              onPress={onRetry}
              className="self-start rounded-[8px] border border-hairline-strong bg-canvas px-[13px] py-[7px]"
            >
              <Text className="text-[12.5px] font-noto-bold text-ink">
                다시 시도
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={CARD_SHADOW}
            className="flex-row items-center gap-md rounded-[12px] border border-hairline bg-canvas p-lg"
          >
            <View className="flex-1">
              <Text className="font-noto-bold text-card-title text-ink">
                {TOGGLE_TITLE}
              </Text>
              <Text className="mt-[3px] text-[12.5px] font-noto text-muted">
                {subtitle}
              </Text>
            </View>
            <Toggle
              testID="settings-location-toggle"
              accessibilityLabel={TOGGLE_TITLE}
              checked={consentOn}
              disabled={disabled}
              onPress={handleTogglePress}
            />
          </View>
        )}
        {saveFailed ? (
          <Text
            testID="settings-location-save-error"
            accessibilityRole="alert"
            className="font-noto text-caption text-primary-text"
          >
            저장하지 못했어요. 잠시 후 다시 시도해 주세요.
          </Text>
        ) : null}

        {automation ? (
          <View
            testID="settings-location-automation-row"
            style={CARD_SHADOW}
            className="flex-row items-center gap-md rounded-[12px] border border-hairline bg-canvas p-lg"
          >
            <View className="flex-1">
              <Text className="font-noto-bold text-card-title text-ink">
                자동 기록
              </Text>
              <Text className="mt-[3px] text-[12.5px] font-noto text-muted">
                {automation.reason}
              </Text>
              {automation.action === 'enable' ? (
                <Pressable
                  testID="settings-location-automation-enable"
                  accessibilityRole="button"
                  onPress={onPressAutomationEnable}
                  className="mt-sm self-start"
                >
                  <Text className="font-noto-bold text-[13px] text-primary-text">
                    켜기
                  </Text>
                </Pressable>
              ) : null}
              {automation.action === 'settings' ? (
                <Pressable
                  testID="settings-location-automation-open-settings"
                  accessibilityRole="link"
                  onPress={onPressAutomationSettings}
                  className="mt-sm self-start"
                >
                  <Text className="font-noto-bold text-[13px] text-primary-text">
                    설정 열기
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View
              className={`rounded-pill px-md py-xs ${
                automation.status === 'on'
                  ? 'bg-success-bg'
                  : 'bg-surface-strong'
              }`}
            >
              <Text
                testID="settings-location-automation-status"
                className={`font-noto-bold text-[12px] ${
                  automation.status === 'on' ? 'text-success' : 'text-muted'
                }`}
              >
                {automation.status === 'on' ? '켜짐' : '꺼짐'}
              </Text>
            </View>
          </View>
        ) : null}

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
            {automation ? (
              <>
                <View className="h-px bg-hairline" />
                <View
                  testID="settings-location-usage-row-automation"
                  className="flex-row items-center gap-md px-lg py-[14px]"
                >
                  <View
                    className={`h-10 w-[22px] items-center justify-center rounded-[10px] ${tone.tile}`}
                  >
                    <AUTOMATION_USAGE.Glyph size={22} color={tone.glyph} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`text-[14.5px] font-noto-bold ${tone.title}`}
                    >
                      {AUTOMATION_USAGE.title}
                    </Text>
                    <Text
                      className={`mt-[3px] text-[12.5px] font-noto ${tone.desc}`}
                    >
                      {AUTOMATION_USAGE.desc}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}
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
