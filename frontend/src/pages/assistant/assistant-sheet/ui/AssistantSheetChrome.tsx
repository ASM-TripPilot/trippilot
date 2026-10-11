import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { SparkleGlyph } from '@/features/open-assistant';
import type { QuickReply } from '../api/assistantContract';
import { COMPOSER_LIMIT } from '../model/composerLimit';
import { CAPABILITIES_LABEL } from '../model/displayActions';
import { CloseGlyph, SendArrowGlyph } from './AssistantSheetGlyphs';

/**
 * 시트 테두리 부품(TRIP-1322) — 헤더 · 컨텍스트 칩 · quick reply 줄 · 입력창. 라이브 Figma b01 default 를 옮겼다
 * (헤더 ✦ 원 30 + "AI 도우미", 칩 = info 연청 바탕 + 점, quick reply = 외곽선 알약, 입력 = 둥근 칸 + 분홍 원 보내기 44).
 */

export function AssistantSheetHeader({
  onClose,
  trailing,
}: {
  onClose: () => void;
  trailing?: ReactElement | null;
}): ReactElement {
  return (
    <View className="flex-row items-center justify-between px-lg pb-sm pt-xs">
      <View className="flex-row items-center gap-sm">
        <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-primary">
          <SparkleGlyph size={17} />
        </View>
        <Text className="font-noto-bold text-section font-bold text-ink">
          AI 도우미
        </Text>
      </View>
      <View className="flex-row items-center gap-md">
        {trailing}
        <Pressable
          testID="assistant-sheet-close"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          hitSlop={8}
          onPress={onClose}
        >
          <CloseGlyph />
        </Pressable>
      </View>
    </View>
  );
}

/** 사용한 컨텍스트 칩 — 서버 문구 그대로(BR-U8-03). 없으면(여행 없이 연 b07) 회색 "진행 중인 여행 없음". */
export function ContextChip({ text }: { text: string | null }): ReactElement {
  const hasContext = text !== null && text !== '';
  return (
    <View className="flex-row px-lg pb-md">
      <View
        testID="assistant-context-chip"
        className={`flex-row items-center gap-sm rounded-button border px-md py-[7px] ${
          hasContext
            ? 'border-info-border bg-info-bg'
            : 'border-hairline bg-surface-strong'
        }`}
      >
        <View
          className={`h-[7px] w-[7px] rounded-full ${hasContext ? 'bg-info' : 'bg-muted-soft'}`}
        />
        <Text
          className={`font-noto text-caption ${hasContext ? 'text-info' : 'text-muted'}`}
        >
          {hasContext ? text : '진행 중인 여행 없음'}
        </Text>
      </View>
    </View>
  );
}

function ReplyChip({
  testID,
  label,
  onPress,
  disabled,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled: boolean;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`rounded-button border border-hairline-strong bg-canvas px-[14px] py-sm${disabled ? ' opacity-40' : ''}`}
    >
      <Text className="font-noto text-label text-ink">{label}</Text>
    </Pressable>
  );
}

/** 서버 발급 quick reply + 상시 "내가 할 수 있는 것 보기"(BR-U8-04 — 클라가 만드는 유일한 칩). */
export function QuickReplyBar({
  replies,
  showCapabilitiesChip,
  onPick,
  onPressCapabilities,
  disabled = false,
}: {
  replies: readonly QuickReply[];
  showCapabilitiesChip: boolean;
  onPick: (reply: QuickReply) => void;
  onPressCapabilities: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-sm px-lg py-sm"
    >
      {replies.map((reply) => (
        <ReplyChip
          key={reply.id}
          testID={`assistant-quick-reply-${reply.id}`}
          label={reply.label}
          disabled={disabled}
          onPress={() => onPick(reply)}
        />
      ))}
      {showCapabilitiesChip ? (
        <ReplyChip
          testID="assistant-quick-reply-capabilities"
          label={CAPABILITIES_LABEL}
          disabled={disabled}
          onPress={onPressCapabilities}
        />
      ) : null}
    </ScrollView>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  canSend,
  sendTestID = 'assistant-send',
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  canSend: boolean;
  sendTestID?: string;
}): ReactElement {
  return (
    <View className="flex-row items-center gap-sm border-t border-hairline px-lg pb-sm pt-[10px]">
      <TextInput
        testID="assistant-input"
        value={value}
        onChangeText={onChange}
        placeholder="무엇이든 물어보세요…"
        placeholderTextColor="#9AA1AB"
        maxLength={COMPOSER_LIMIT}
        multiline
        className="max-h-[96px] min-h-[46px] flex-1 rounded-input border border-hairline-strong bg-canvas px-lg py-[12px] font-noto text-body text-ink"
      />
      <Pressable
        testID={sendTestID}
        accessibilityRole="button"
        accessibilityLabel="보내기"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={onSend}
        className={`h-[44px] w-[44px] items-center justify-center rounded-full bg-primary${canSend ? '' : ' opacity-40'}`}
      >
        <SendArrowGlyph />
      </Pressable>
    </View>
  );
}
