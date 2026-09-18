import { type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { RevokeImpact } from '@/shared/location/revokeImpact';

/**
 * 위치 동의 **철회 재확인 다이얼로그**(BR-U6-30 · AC-1 법적 게이트). 608 DeleteAccountDialog 와 동형으로
 * 리포 Modal 선례 없이 **조건부 렌더 absolute 오버레이**로 짜, 열림 시 testID 가 트리에 실재하게 한다
 * (딤 실제 덮임·모달 실제 열림은 jest 원리적 사각 — 6-b 실기 전용, repo-traps).
 *
 * 삭제(608)는 2단이지만 철회는 **1단** — 중단·계속을 고지한 뒤 [동의 철회] 한 번이면 `onConfirm`.
 * 이 콜백은 페이지에서 PUT 로 배선되므로, 다이얼로그를 거치지 않으면 PUT 이 나가지 않는다.
 *
 * 중단3·계속2 는 `revokeImpact()` 가 공급한 `impact` 를 그대로 렌더한다(default 배너와 같은 순수함수
 * 소비 — 문구 중복 제거). Figma 는 중단3 을 산문 1문장으로 접었으나, 608 "법적 고지는 더 많이" 원칙을
 * 계승해 구조화 리스트로 고지한다(Q1 확정 · 드리프트 기록).
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
      <View className="w-[330px] rounded-[20px] bg-canvas p-2xl">
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

        <View className="mt-2xl flex-row gap-[10px]">
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
      <Text className="font-noto-bold text-label text-muted">{label}</Text>
      <View className="mt-xs gap-xs">
        {items.map((item) => (
          <View key={item} className="flex-row gap-sm">
            <Text className="font-noto text-body text-muted">·</Text>
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
