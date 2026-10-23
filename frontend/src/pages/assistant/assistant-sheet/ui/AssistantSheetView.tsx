import { useContext, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type {
  AssistantMessage,
  AssistantSurface,
  NextAction,
  QuickReply,
} from '../api/assistantContract';
import { useKeyboardVisible } from '@/shared/lib/useKeyboardVisible';
import { contextChipLabel, splitQuickReplies } from '../model/sheetModel';
import type { SheetState } from '../model/resolveSheetState';
import {
  AssistantSheetHeader,
  Composer,
  QuickReplyBar,
} from './AssistantSheetChrome';
import { RetryGlyph, WarningGlyph } from './AssistantSheetGlyphs';
import { MessageList, type OlderMessagesProps } from './MessageList';

/**
 * b01~b07 도우미 시트 순수 뷰(TRIP-1322) — props 만 받는다. 네트워크·라우터·판정 없음(판정은 page 가
 * `resolveSheetState` 로 1회). 프리뷰가 이 파일만 물 수 있게 컨테이너와 파일을 나눈다(traps-shell).
 *
 * 투명 모달 라우트 위에 딤(뒤 화면이 비친다) + 아래에서 올라온 패널을 그린다. 시트는 gorhom 이 아니라 평범한
 * View + KeyboardAvoidingView 다 — 입력창이 맨 아래 붙는 채팅이라 시트 스냅·끌어 닫기보다 키보드 회피가 중요하다
 * (끌어 닫기 없음 — 닫기 X·딤 탭). 딤 전면 덮임·키보드가 입력창을 밀어 올리는지는 jest 사각(6-b 실기).
 */

export interface AssistantSheetViewProps {
  state: SheetState;
  /** 컨텍스트 칩 라벨의 입력(surface 별 문구). */
  surface: AssistantSurface;
  contextChip: string | null;
  /** 화면에 그릴 메시지(next action 은 page 가 `displayActions` 로 이미 걸렀다). */
  messages: readonly AssistantMessage[];
  quickReplies: readonly QuickReply[];
  showCapabilitiesChip: boolean;
  draft: string;
  canSend: boolean;
  onChangeDraft: (text: string) => void;
  onSend: () => void;
  onPressQuickReply: (reply: QuickReply) => void;
  onPressCapabilities: () => void;
  onPressAction: (action: NextAction) => void;
  onClose: () => void;
  onRetryOpen: () => void;
  /** quick reply 를 잠시 막는다(턴 진행 중 등). */
  repliesDisabled?: boolean;
  /** 메시지 kind 별 카드(TRIP-1323). */
  renderCard?: (message: AssistantMessage) => ReactNode;
  /** 답 평가 줄(US-ASSIST-09) — 도우미의 답 아래에만 그린다(적용 기록 제외는 목록이 가른다). */
  renderFeedback?: (message: AssistantMessage) => ReactNode;
  /** 목록 맨 위 "이전 대화 더 보기" 행 — null·없음이면 그리지 않는다. */
  older?: OlderMessagesProps | null;
  /** 입력창 바로 위 줄(진행 표시·대기 취소·429 안내, TRIP-1326). */
  statusRow?: ReactNode;
  /** 보내기 버튼 testID(진행 중 `assistant-send-pending`, TRIP-1326). */
  sendTestID?: string;
  /** 헤더 X 왼쪽 부품(이력 토글, TRIP-1325). */
  headerTrailing?: ReactElement | null;
  /** 본문 교체(이력 보기, TRIP-1325) — 주면 대화 목록·quick reply·입력 대신 이것을 그린다. */
  body?: ReactNode;
}

/** Figma b 프레임: 패널 윗변이 상태바 아래 뒤 화면 헤더(≈64)만큼 내려와 뒤 화면이 보인다. */
const PANEL_GAP_BELOW_STATUS = 64;
/** Figma bv3: 패널은 화면 좌우 12 · 아래 12(+홈 인디케이터)에 떠 있고, 높이는 최대 608/844. */
const PANEL_HEIGHT_RATIO = 0.72;
const PANEL_EDGE = 12;
/** 키보드가 떠 있을 때 패널(입력 카드)과 키보드 사이 간격(Figma bv3-입력 (키보드) = 14). */
const KEYBOARD_GAP = 14;
const PANEL_SHADOW = {
  shadowColor: '#000000',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
} as const;

function OpenFailed({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <View testID="assistant-open-failed" className="flex-1 px-lg pt-lg">
      <View className="gap-md rounded-card border border-primary-pale bg-primary-pale px-lg py-lg">
        <View className="flex-row items-center gap-sm">
          <WarningGlyph />
          <Text className="flex-1 font-noto text-body text-ink">
            지금 도우미를 열지 못했어요. 지금 화면은 그대로 쓸 수 있어요.
          </Text>
        </View>
        <Pressable
          testID="assistant-open-retry"
          accessibilityRole="button"
          onPress={onRetry}
          className="flex-row items-center gap-xs self-start rounded-button bg-primary px-lg py-sm"
        >
          <RetryGlyph />
          <Text className="font-noto-bold text-label font-bold text-on-primary">
            다시 시도
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function AssistantSheetView({
  state,
  surface,
  contextChip,
  messages,
  quickReplies,
  showCapabilitiesChip,
  draft,
  canSend,
  onChangeDraft,
  onSend,
  onPressQuickReply,
  onPressCapabilities,
  onPressAction,
  onClose,
  onRetryOpen,
  repliesDisabled = false,
  renderCard,
  renderFeedback,
  older,
  statusRow,
  sendTestID,
  headerTrailing,
  body,
}: AssistantSheetViewProps): ReactElement {
  const insets = useContext(SafeAreaInsetsContext);
  const { height: windowHeight } = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();
  const top = (insets?.top ?? 0) + PANEL_GAP_BELOW_STATUS;
  const opened = state === 'READY' || state === 'NO_CONTEXT';
  // 대화 = 사용자가 한 번이라도 말했나. 서버 인사(ASSISTANT)·적용 기록만 있으면 아직 대화 전이다.
  const hasConversation = messages.some((message) => message.role === 'USER');
  // 키보드 + 대화 전 → 작은 입력 카드만(compact), 키보드 + 대화 중 → 패널이 줄어든다(shrunk).
  // 입력 카드는 모드가 바뀌어도 같은 자리(슬롯)에 있어야 포커스가 안 풀린다 — 아래 조건부 형제는 자리를 유지한다.
  const showChat = opened && !body;
  const mode =
    keyboardVisible && showChat
      ? hasConversation
        ? 'shrunk'
        : 'compact'
      : 'full';
  const compact = mode === 'compact';
  const chipLabel = contextChipLabel(surface, state === 'NO_CONTEXT');
  const chip = {
    label: chipLabel,
    accessibilityLabel: contextChip
      ? `${chipLabel}, ${contextChip}`
      : chipLabel,
  };
  // READY: 일반 질문형은 칩 안 펼침, 카드 위 줄엔 응답 보기만. NO_CONTEXT: 칩 = 능력 보기, 서버 quick reply 는 줄 그대로.
  const noContext = state === 'NO_CONTEXT';
  const { suggestions, choices } = splitQuickReplies(quickReplies);
  const lineReplies = noContext
    ? // 입력 칩이 이미 '능력 보기' — 서버가 준 SHOW_CAPABILITIES 칩도 중복이라 렌더 목록에서만 뺀다.
      quickReplies.filter((r) => r.action !== 'SHOW_CAPABILITIES')
    : choices;

  return (
    <View testID="assistant-sheet-root" className="flex-1">
      <Pressable
        testID="assistant-sheet-scrim"
        accessibilityRole="button"
        accessibilityLabel="도우미 닫기"
        onPress={onClose}
        className="absolute inset-0 bg-scrim/40"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          paddingTop: top,
          paddingHorizontal: PANEL_EDGE,
        }}
      >
        <View
          testID={`assistant-sheet-mode-${mode}`}
          className={`bg-canvas ${compact ? 'rounded-[28px]' : 'rounded-[36px]'}`}
          style={[
            PANEL_SHADOW,
            // 아래 여백은 런타임 값(홈 인디케이터)이라 style. 키보드 위에서는 14 만 띄운다(KAV 가 키보드 높이를 따로 더한다).
            {
              marginBottom: keyboardVisible
                ? KEYBOARD_GAP
                : (insets?.bottom ?? 0) + PANEL_EDGE,
            },
            compact
              ? null
              : { flex: 1, maxHeight: windowHeight * PANEL_HEIGHT_RATIO },
          ]}
        >
          {compact ? null : (
            <View
              testID="assistant-sheet-handle"
              className="items-center py-sm"
            >
              <View className="h-[4px] w-[32px] rounded-[2px] bg-hairline-strong" />
            </View>
          )}
          {compact ? null : (
            <AssistantSheetHeader
              onClose={onClose}
              trailing={opened ? headerTrailing : null}
            />
          )}
          {state === 'LOADING' || state === 'UNAUTHORIZED' ? (
            <View
              testID="assistant-sheet-loading"
              className="flex-1 items-center justify-center"
            >
              <ActivityIndicator color="#FF385C" />
            </View>
          ) : null}
          {state === 'OPEN_FAILED' ? (
            <OpenFailed onRetry={onRetryOpen} />
          ) : null}
          {opened ? body : null}
          {showChat && !compact ? (
            <View className="flex-1">
              <MessageList
                messages={messages}
                onPressAction={onPressAction}
                renderCard={renderCard}
                renderFeedback={renderFeedback}
                noContext={state === 'NO_CONTEXT'}
                older={older}
              />
            </View>
          ) : null}
          {showChat ? statusRow : null}
          {showChat && lineReplies.length > 0 ? (
            <QuickReplyBar
              replies={lineReplies}
              onPick={onPressQuickReply}
              disabled={repliesDisabled}
              stacked={!hasConversation}
            />
          ) : null}
          {showChat ? (
            <View className={compact ? '' : 'px-[13px] pb-[13px]'}>
              <Composer
                value={draft}
                onChange={onChangeDraft}
                onSend={onSend}
                canSend={canSend}
                sendTestID={sendTestID}
                chip={chip}
                suggestions={
                  noContext
                    ? undefined
                    : {
                        replies: suggestions,
                        showCapabilitiesChip,
                        onPick: onPressQuickReply,
                        disabled: repliesDisabled,
                      }
                }
                onPressCapabilities={onPressCapabilities}
              />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
