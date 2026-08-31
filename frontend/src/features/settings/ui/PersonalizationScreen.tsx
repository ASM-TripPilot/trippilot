import { type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  PersonalizationInfoReason,
  PersonalizationItem,
} from '@/shared/api/generated/schemas';
import { LocationBackChevronGlyph } from '@/shared/location/LocationGlyphs';

import { personalizationCopy } from '../model/personalizationCopy';

/**
 * l05 개인화 화면(무상태 프레젠테이션). 상태·서버 호출은 페이지 몫이고, 토글 press 는 곧장 콜백으로
 * 나간다 — 위치동의(l06)와 달리 재확인 다이얼로그가 없다(01b Q3, 데이터 파기가 아니라 추천 입력 제외뿐).
 *
 * reason 이 세 축을 함께 가른다:
 *  - 토글 checked = `consentOn`(페이지가 reason 에서 도출해 주입).
 *  - 안내 문구 = `personalizationCopy(reason)`(단일 출처 — null 이면 안 그림, APPLIED).
 *  - 목록 = `sharedItems` **만** map(하드코딩 금지 — applied=false 면 서버가 빈 배열을 줘 자동 0개).
 *
 * ★함정(BR-U5-44): NOT_ENOUGH_RECORDS 는 이미 동의한 사용자다 — 토글 ON 유지 + "동의하면…" 문구 부재.
 * 그래서 이 화면의 어떤 고정 문안에도 "동의하면"을 두지 않는다(그 문구는 CONSENT_MISSING copy 로만 등장).
 *
 * 픽셀·글리프 SVG 색/모양은 l06 준용 발명값이라 6-b 실기 몫(Figma 프레임 부재, repo-traps).
 */
export interface PersonalizationScreenProps {
  consentOn: boolean;
  reason: PersonalizationInfoReason;
  sharedItems: PersonalizationItem[];
  onToggle: () => void;
  onPressBack?: () => void;
}

export function PersonalizationScreen({
  consentOn,
  reason,
  sharedItems,
  onToggle,
  onPressBack,
}: PersonalizationScreenProps): ReactElement {
  const copy = personalizationCopy(reason);
  const subtitle = consentOn ? '개인화 추천 사용 중' : '개인화 추천 사용 안 함';

  return (
    <SafeAreaView
      testID="settings-personalization-root"
      edges={['top']}
      className="flex-1 bg-canvas-alt"
    >
      <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
        <Pressable
          testID="settings-personalization-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <LocationBackChevronGlyph />
        </Pressable>
        <Text className="text-[18px] font-noto-bold text-ink">개인화</Text>
      </View>

      <ScrollView contentContainerClassName="gap-lg px-lg pb-3xl pt-lg">
        {/* 토글 카드 */}
        <View className="flex-row items-center gap-md rounded-[20px] bg-canvas px-lg py-lg">
          <View className="flex-1">
            <Text className="font-noto-bold text-card-title text-ink">
              지난 기록으로 추천 맞춤
            </Text>
            <Text className="mt-xs font-noto text-label text-muted">
              {subtitle}
            </Text>
          </View>
          <Pressable
            testID="settings-personalization-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: consentOn }}
            onPress={onToggle}
            className={`h-[30px] w-[52px] justify-center rounded-pill px-[3px] ${
              consentOn
                ? 'items-end bg-primary'
                : 'items-start bg-hairline-strong'
            }`}
          >
            <View className="h-6 w-6 rounded-pill bg-canvas" />
          </Pressable>
        </View>

        {/* 안내 문구 — reason 에 따라 있을 때만. APPLIED 는 null 이라 그리지 않는다(목록이 대신 말함). */}
        {copy !== null ? (
          <View className="gap-sm rounded-[20px] bg-surface-soft px-lg py-lg">
            <Text className="font-noto text-body text-body">{copy}</Text>
          </View>
        ) : null}

        {/* 반영 중인 기록 — sharedItems 만 그린다(하드코딩·placeholder 금지). 빈 배열이면 통째로 안 그림. */}
        {sharedItems.length > 0 ? (
          <View className="gap-sm">
            <Text className="font-noto-bold text-label text-muted">
              지금 반영 중인 기록
            </Text>
            <View className="gap-md rounded-[20px] bg-canvas px-lg py-lg">
              {sharedItems.map((entry) => (
                <View
                  key={`${entry.item}·${entry.purpose}`}
                  testID="settings-personalization-item"
                  className="gap-xs"
                >
                  <Text className="font-noto-bold text-body text-ink">
                    {entry.item}
                  </Text>
                  <Text className="font-noto text-label text-muted">
                    {entry.purpose}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
