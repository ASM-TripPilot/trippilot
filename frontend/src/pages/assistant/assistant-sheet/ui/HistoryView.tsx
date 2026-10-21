import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type {
  ActionLogPayload,
  AssistantMessage,
  AssistantSessionSummary,
} from '../api/assistantContract';
import { ActionLogRow } from './AssistantCards';
import { AssistantBubble } from './MessageList';

/**
 * b06 이력 보기(TRIP-1325 · BR-U8-17~21) — 별도 라우트가 아니라 시트 안 보기 전환(페이지 로컬 `CHAT|HISTORY`).
 * 세션의 ACTION_LOG(도우미가 실제로 바꾼 것)만 모아 보이고, [대화 이어서]·[이력 지우기]를 둔다. 지워도 이미
 * 적용된 일정 변경·change log·리비전은 남는다(BR-U8-20 — 이력은 보조 기록). 보존 기간은 미결(O-U8-1)이라
 * 표기하지 않는다.
 *
 * 이력 지우기 확인은 라이브러리 없는 오버레이 다이얼로그다 — 실제 덮임·터치 차단은 jest 사각(6-b 실기).
 */

export interface HistoryViewProps {
  logs: readonly AssistantMessage[];
  /** 다른 여행(또는 일반) 대화 — 다시 열 수 있다(BR-U8-18). */
  otherSessions: readonly AssistantSessionSummary[];
  confirmingClear: boolean;
  clearing: boolean;
  onContinue: () => void;
  onRequestClear: () => void;
  onConfirmClear: () => void;
  onCancelClear: () => void;
  onOpenSession: (session: AssistantSessionSummary) => void;
}

function ActionButton({
  testID,
  label,
  onPress,
  disabled = false,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="rounded-button border border-hairline-strong bg-canvas px-[14px] py-sm"
    >
      <Text className="font-noto text-label text-ink">{label}</Text>
    </Pressable>
  );
}

export function HistoryView({
  logs,
  otherSessions,
  confirmingClear,
  clearing,
  onContinue,
  onRequestClear,
  onConfirmClear,
  onCancelClear,
  onOpenSession,
}: HistoryViewProps): ReactElement {
  return (
    <View testID="assistant-history" className="flex-1">
      <ScrollView contentContainerClassName="gap-md px-lg py-lg">
        <AssistantBubble text="이번 여행에서 도우미와 한 대화·변경이에요." />
        {logs.length === 0 ? (
          <Text
            testID="assistant-history-empty"
            className="font-noto text-label text-muted"
          >
            아직 도우미로 바꾼 것이 없어요
          </Text>
        ) : (
          logs.map((log) => (
            <ActionLogRow
              key={log.id}
              testID={`assistant-history-row-${log.id}`}
              payload={log.payload as ActionLogPayload}
            />
          ))
        )}
        <Text className="font-noto text-micro text-muted">
          * 대화는 보조 기록 · 일정 확정값은 솔버 검증 결과
        </Text>
        {otherSessions.length > 0 ? (
          <View className="gap-sm pt-sm">
            <Text className="font-noto-bold text-caption font-bold text-muted-soft">
              이전 대화
            </Text>
            {otherSessions.map((item) => (
              <Pressable
                key={item.id}
                testID={`assistant-history-session-${item.id}`}
                accessibilityRole="button"
                onPress={() => onOpenSession(item)}
                className="rounded-card border border-hairline bg-canvas px-lg py-md"
              >
                <Text className="font-noto text-label text-ink">
                  {item.tripTitle ?? '여행 없이 한 대화'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View className="flex-row gap-sm px-lg py-sm">
        <View className="absolute inset-x-0 top-0 h-px bg-hairline" />
        <ActionButton
          testID="assistant-history-continue"
          label="대화 이어서"
          onPress={onContinue}
        />
        <ActionButton
          testID="assistant-history-clear"
          label="이력 지우기"
          onPress={onRequestClear}
          disabled={clearing}
        />
      </View>

      {confirmingClear ? (
        <View
          testID="assistant-history-clear-dialog"
          className="absolute inset-0 items-center justify-center bg-scrim/40 px-2xl"
        >
          <View className="w-full gap-lg rounded-card bg-canvas px-xl py-xl">
            <View className="gap-sm">
              <Text className="font-noto-bold text-section font-bold text-ink">
                대화 이력을 지울까요?
              </Text>
              <Text className="font-noto text-label text-muted">
                이미 반영한 일정 변경은 그대로 남아요.
              </Text>
            </View>
            <View className="flex-row gap-sm">
              <Pressable
                testID="assistant-history-clear-cancel"
                accessibilityRole="button"
                onPress={onCancelClear}
                className="flex-1 items-center rounded-button border border-hairline-strong bg-canvas py-[13px]"
              >
                <Text className="font-noto-bold text-label font-bold text-ink">
                  취소
                </Text>
              </Pressable>
              <Pressable
                testID="assistant-history-clear-confirm"
                accessibilityRole="button"
                accessibilityState={{ disabled: clearing }}
                disabled={clearing}
                onPress={onConfirmClear}
                className="flex-1 items-center rounded-button bg-primary py-[13px]"
              >
                <Text className="font-noto-bold text-label font-bold text-on-primary">
                  지우기
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
