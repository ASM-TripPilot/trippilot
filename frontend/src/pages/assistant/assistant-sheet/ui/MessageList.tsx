import { useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { SparkleGlyph } from '@/features/open-assistant';
import type {
  AssistantMessage,
  FallbackPayload,
  NextAction,
} from '../api/assistantContract';
import { cardConsumes } from './AssistantCards';
import { ArrowDownGlyph } from './AssistantSheetGlyphs';
import { ActionRow } from './OutlineCard';

/**
 * 대화 목록(TRIP-1322) — 최신이 아래. `inverted` FlatList 라 데이터는 뒤집어 넣는다.
 * 메시지 하나 = 본문(사용자 연한 우측 말풍선 · 도우미 평문, TRIP-1527) + 카드(`renderCard`, TRIP-1323) + next action + 각주
 * + 답 평가 줄(`renderFeedback`, US-ASSIST-09). 문구·시각·거리는 서버 문자열 그대로 그린다(DEC-U8-6 · INV-2·3).
 */

export interface MessageListProps {
  messages: readonly AssistantMessage[];
  onPressAction: (action: NextAction) => void;
  /** 메시지 kind 별 카드 — 없으면 본문·행동만 그린다. */
  renderCard?: (message: AssistantMessage) => ReactNode;
  /** 답 평가 줄 — 도우미의 답에만 붙인다(사용자 말·적용 기록 `ACTION_LOG` 제외, INV-U8-10). */
  renderFeedback?: (message: AssistantMessage) => ReactNode;
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
        className="max-w-[286px] rounded-card bg-surface-strong px-[14px] py-sm"
      >
        {/* 줄높이 22 는 body 토큰(14/20)에 없는 값 — Figma 평문·말풍선 공통 */}
        <Text className="font-noto text-body leading-[22px] text-ink">
          {message.text}
        </Text>
      </View>
    </View>
  );
}

/** 이력 화면(HistoryView)이 아직 쓰는 옛 말풍선 — 대화 목록의 도우미 답은 `AssistantMessageBlock` 안 평문 `Text` 로 그린다(이력 평문화는 사이클 C). */
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
    <ActionRow
      testID={`assistant-next-action-${action.type}`}
      label={action.label}
      onPress={() => onPress(action)}
    />
  );
}

function AssistantMessageBlock({
  message,
  onPressAction,
  renderCard,
  renderFeedback,
}: {
  message: AssistantMessage;
  onPressAction: (action: NextAction) => void;
  renderCard?: (message: AssistantMessage) => ReactNode;
  renderFeedback?: (message: AssistantMessage) => ReactNode;
}): ReactElement {
  // 카드가 스스로 그린 행동(외부 위임 링크·폴백 다시 시도/계속)은 버튼 줄에서 뺀다.
  const consumed = cardConsumes(message);
  const buttons = message.nextActions.filter(
    (action) => !consumed.includes(action.type)
  );
  // "적용 전까지 일정은 그대로" 류 각주는 제안이 아직 열려 있을 때만 맞다 — 적용·취소·만료 뒤엔 숨긴다.
  const proposalSettled =
    !!message.proposal && message.proposal.status !== 'PROPOSED';
  // 응답 실패 카드가 같은 문장을 이미 싣고 있으면 평문은 생략한다 — 같은 문장이 두 번 나오지 않게(01b Q6).
  const duplicated =
    message.kind === 'FALLBACK' &&
    (message.payload as FallbackPayload | null | undefined)?.notice ===
      message.text;
  return (
    <View testID={`assistant-message-${message.id}`} className="gap-md">
      {message.text && !duplicated ? (
        <Text
          testID={`assistant-message-text-${message.id}`}
          className="font-noto text-body leading-[22px] text-ink"
        >
          {message.text}
        </Text>
      ) : null}
      {renderCard?.(message)}
      {buttons.length > 0 ? (
        <View className="gap-md">
          {buttons.map((action, index) => (
            <NextActionButton
              key={`${action.type}-${index}`}
              action={action}
              onPress={onPressAction}
            />
          ))}
        </View>
      ) : null}
      {message.footnote && !proposalSettled ? (
        <Text
          testID={`assistant-footnote-${message.id}`}
          className="font-noto text-caption text-muted"
        >
          {message.footnote}
        </Text>
      ) : null}
      {/* 적용 기록은 도우미가 한 일의 기록이지 답이 아니다 — 평가 대상이 아니다(서버도 400). */}
      {message.kind !== 'ACTION_LOG' ? renderFeedback?.(message) : null}
    </View>
  );
}

// inverted 목록의 scroll offset 0 = 맨 아래(최신). 이만큼 넘게 위로 올라오면 ↓ 버튼을 띄운다.
const SCROLL_DOWN_THRESHOLD = 40;

export function MessageList({
  messages,
  onPressAction,
  renderCard,
  renderFeedback,
}: MessageListProps): ReactElement {
  const listRef = useRef<FlatList<AssistantMessage>>(null);
  const [away, setAway] = useState(false);
  return (
    <View className="flex-1">
      <FlatList
        ref={listRef}
        testID="assistant-message-list"
        inverted
        data={[...messages].reverse()}
        keyExtractor={(message) => message.id}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-md px-lg py-lg"
        scrollEventThrottle={16}
        onScroll={(event) =>
          setAway(event.nativeEvent.contentOffset.y > SCROLL_DOWN_THRESHOLD)
        }
        renderItem={({ item }) =>
          item.role === 'USER' ? (
            <UserBubble message={item} />
          ) : (
            <AssistantMessageBlock
              message={item}
              onPressAction={onPressAction}
              renderCard={renderCard}
              renderFeedback={renderFeedback}
            />
          )
        }
      />
      {/* 위쪽 짧은 페이드 — 글이 위 가장자리에서 갑자기 잘려 보이지 않게(반투명 흰색이라 토큰이 아니다) */}
      <LinearGradient
        pointerEvents="none"
        colors={['#FFFFFF', '#FFFFFF00']}
        className="absolute inset-x-0 top-0 h-[16px]"
      />
      {away ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 bottom-md items-center"
        >
          <Pressable
            testID="assistant-scroll-down"
            accessibilityRole="button"
            accessibilityLabel="맨 아래로"
            // 시각 지름은 38 그대로 두고 터치 영역만 44 이상으로(각 변 +3)
            hitSlop={3}
            onPress={() =>
              listRef.current?.scrollToOffset({ offset: 0, animated: true })
            }
            // 지름 38 · 그림자 0 2 10 6% — 토큰에 없는 일회성 값(Figma 5020:3165)
            className="h-[38px] w-[38px] items-center justify-center rounded-full border border-hairline-strong bg-canvas"
            style={{
              shadowColor: '#000000',
              shadowOpacity: 0.06,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            }}
          >
            <ArrowDownGlyph />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
