import type { ReactElement, ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { SparkleGlyph } from '@/features/open-assistant';
import type { AssistantMessage, NextAction } from '../api/assistantContract';
import { ChevronRightGlyph } from './AssistantSheetGlyphs';

/**
 * 대화 목록(TRIP-1322) — 최신이 아래. `inverted` FlatList 라 데이터는 뒤집어 넣는다.
 * 메시지 하나 = 말풍선(사용자 검정 · 도우미 회색 + ✦) + 카드(`renderCard`, TRIP-1323) + next action + 각주.
 * 문구·시각·거리는 서버 문자열 그대로 그린다(DEC-U8-6 · INV-2·3).
 */

export interface MessageListProps {
  messages: readonly AssistantMessage[];
  onPressAction: (action: NextAction) => void;
  /** 메시지 kind 별 카드 — 없으면 말풍선·행동만 그린다. */
  renderCard?: (message: AssistantMessage) => ReactNode;
}

export function UserBubble({
  message,
}: {
  message: AssistantMessage;
}): ReactElement {
  return (
    <View className="items-end">
      <View
        testID={`assistant-user-bubble-${message.id}`}
        className="max-w-[286px] rounded-[18px] bg-ink px-[14px] py-[11px]"
      >
        <Text className="font-noto text-body text-on-primary">
          {message.text}
        </Text>
      </View>
    </View>
  );
}

export function AssistantBubble({ text }: { text: string }): ReactElement {
  return (
    <View className="flex-row items-start gap-sm">
      <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-primary">
        <SparkleGlyph size={14} />
      </View>
      <View className="max-w-[286px] rounded-[18px] bg-surface-strong px-[14px] py-[11px]">
        <Text className="font-noto text-body text-ink">{text}</Text>
      </View>
    </View>
  );
}

export function NextActionButton({
  action,
  onPress,
}: {
  action: NextAction;
  onPress: (action: NextAction) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`assistant-next-action-${action.type}`}
      accessibilityRole="button"
      onPress={() => onPress(action)}
      className="flex-row items-center justify-center gap-xs rounded-button bg-surface-strong px-lg py-md"
    >
      <Text className="font-noto-bold text-label font-bold text-ink">
        {action.label}
      </Text>
      <ChevronRightGlyph size={14} />
    </Pressable>
  );
}

function AssistantMessageBlock({
  message,
  onPressAction,
  renderCard,
}: {
  message: AssistantMessage;
  onPressAction: (action: NextAction) => void;
  renderCard?: (message: AssistantMessage) => ReactNode;
}): ReactElement {
  return (
    <View testID={`assistant-message-${message.id}`} className="gap-sm">
      {message.text ? <AssistantBubble text={message.text} /> : null}
      {renderCard?.(message)}
      {message.nextActions.length > 0 ? (
        <View className="gap-sm">
          {message.nextActions.map((action, index) => (
            <NextActionButton
              key={`${action.type}-${index}`}
              action={action}
              onPress={onPressAction}
            />
          ))}
        </View>
      ) : null}
      {message.footnote ? (
        <Text className="font-noto text-micro text-muted">
          {message.footnote}
        </Text>
      ) : null}
    </View>
  );
}

export function MessageList({
  messages,
  onPressAction,
  renderCard,
}: MessageListProps): ReactElement {
  return (
    <FlatList
      testID="assistant-message-list"
      inverted
      data={[...messages].reverse()}
      keyExtractor={(message) => message.id}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-lg px-lg py-lg"
      renderItem={({ item }) =>
        item.role === 'USER' ? (
          <UserBubble message={item} />
        ) : (
          <AssistantMessageBlock
            message={item}
            onPressAction={onPressAction}
            renderCard={renderCard}
          />
        )
      }
    />
  );
}
