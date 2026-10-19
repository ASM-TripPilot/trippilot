import { useContext, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type {
  AssistantMessage,
  NextAction,
  QuickReply,
} from '../api/assistantContract';
import type { SheetState } from '../model/resolveSheetState';
import {
  AssistantSheetHeader,
  Composer,
  ContextChip,
  QuickReplyBar,
} from './AssistantSheetChrome';
import { RetryGlyph, WarningGlyph } from './AssistantSheetGlyphs';
import { MessageList } from './MessageList';

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
  statusRow,
  sendTestID,
  headerTrailing,
  body,
}: AssistantSheetViewProps): ReactElement {
  const insets = useContext(SafeAreaInsetsContext);
  const top = (insets?.top ?? 0) + PANEL_GAP_BELOW_STATUS;
  const bottom = insets?.bottom ?? 0;
  const opened = state === 'READY' || state === 'NO_CONTEXT';

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
        style={{ flex: 1, paddingTop: top }}
      >
        <View
          testID="assistant-sheet"
          className="flex-1 rounded-t-sheet-top bg-canvas"
          style={{ paddingBottom: bottom }}
        >
          <View className="items-center pb-sm pt-[10px]">
            <View className="h-[5px] w-[40px] rounded-pill bg-hairline-strong" />
          </View>
          <AssistantSheetHeader
            onClose={onClose}
            trailing={opened ? headerTrailing : null}
          />
          {state === 'LOADING' || state === 'UNAUTHORIZED' ? (
            <View
              testID="assistant-sheet-loading"
              className="flex-1 items-center justify-center"
            >
              <ActivityIndicator color="#FF385C" />
            </View>
          ) : state === 'OPEN_FAILED' ? (
            <OpenFailed onRetry={onRetryOpen} />
          ) : (
            <>
              <ContextChip text={contextChip} />
              <View className="h-px bg-hairline" />
              {body ?? (
                <>
                  <View className="flex-1">
                    <MessageList
                      messages={messages}
                      onPressAction={onPressAction}
                      renderCard={renderCard}
                      renderFeedback={renderFeedback}
                    />
                  </View>
                  {statusRow}
                  <QuickReplyBar
                    replies={quickReplies}
                    showCapabilitiesChip={showCapabilitiesChip}
                    onPick={onPressQuickReply}
                    onPressCapabilities={onPressCapabilities}
                    disabled={repliesDisabled}
                  />
                  <Composer
                    value={draft}
                    onChange={onChangeDraft}
                    onSend={onSend}
                    canSend={canSend}
                    sendTestID={sendTestID}
                  />
                </>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
