import { type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { RevokeImpact } from '@/shared/location/revokeImpact';

/** 카드 그림자(Figma drop 0,8,14 · 20%) — 그림자는 className 으로 못 준다. */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.2,
  shadowRadius: 14,
  elevation: 8,
} as const;

/**
 * 위치 동의 **철회 재확인 다이얼로그**(BR-U6-30 · AC-1 법적 게이트). 608 DeleteAccountDialog 와 동형으로
 * 리포 Modal 선례 없이 **조건부 렌더 absolute 오버레이**로 짜, 열림 시 testID 가 트리에 실재하게 한다
 * (딤 실제 덮임·모달 실제 열림은 jest 원리적 사각 — 6-b 실기 전용, repo-traps).
 *
 * 삭제(608)는 2단이지만 철회는 **1단** — 중단·계속을 고지한 뒤 [동의 철회] 한 번이면 `onConfirm`.
 * 이 콜백은 페이지에서 PUT 로 배선되므로, 다이얼로그를 거치지 않으면 PUT 이 나가지 않는다.
 *
 * 중단3·계속2 는 `revokeImpact()` 가 공급한 `impact` 를 그대로 렌더한다(default 배너와 같은 순수함수
 * 소비 — 문구 중복 제거). 구조화 리스트(블록 2 · 불릿 5)는 라이브 Figma `1610:2440` 과 같다(TRIP-780 G2).
 */
export function RevokeConfirmDialog({
  impact,
  onCancel,
  onConfirm,
}: {
  impact: RevokeImpact;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <View
      testID="settings-location-revoke-confirm"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas px-[22px] pb-xl pt-2xl"
      >
        <Text className="text-[19px] font-noto-bold text-ink">
          위치정보 동의를 철회할까요?
        </Text>

        <ScrollView className="mt-md max-h-[260px]">
          <ImpactBlock label="이런 기능이 멈춰요" items={impact.stops} />
          <View className="mt-md">
            <ImpactBlock
              label="이런 기능은 계속 동작해요"
              items={impact.continues}
            />
          </View>
        </ScrollView>

        <View className="mt-[30px] flex-row gap-[10px]">
          <DialogButton
            testID="settings-location-revoke-cancel"
            label="취소"
            tone="ghost"
            onPress={onCancel}
          />
          <DialogButton
            testID="settings-location-revoke-confirm-button"
            label="동의 철회"
            tone="dark"
            onPress={onConfirm}
          />
        </View>
      </View>
    </View>
  );
}

function ImpactBlock({
  label,
  items,
}: {
  label: string;
  items: readonly string[];
}): ReactElement {
  return (
    <View>
      <Text className="font-noto-bold text-label text-ink">{label}</Text>
      <View className="mt-xs gap-xs">
        {items.map((item) => (
          <View key={item} className="flex-row gap-sm">
            <Text className="font-noto text-body text-body">•</Text>
            <Text className="flex-1 font-noto text-body text-body">{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DialogButton({
  testID,
  label,
  tone,
  onPress,
}: {
  testID: string;
  label: string;
  tone: 'ghost' | 'dark';
  onPress: () => void;
}): ReactElement {
  const surface =
    tone === 'ghost' ? 'border border-hairline-strong bg-canvas' : 'bg-ink';
  const text = tone === 'ghost' ? 'text-ink' : 'text-canvas';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={`h-12 flex-1 items-center justify-center rounded-button ${surface}`}
    >
      <Text className={`font-noto-bold text-card-title ${text}`}>{label}</Text>
    </Pressable>
  );
}
