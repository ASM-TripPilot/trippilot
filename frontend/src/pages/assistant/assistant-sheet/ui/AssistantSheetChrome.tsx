import { useRef, type ReactElement } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SparkleGlyph } from '@/features/open-assistant';
import type { QuickReply } from '../api/assistantContract';
import { COMPOSER_LIMIT } from '../model/composerLimit';
import { CAPABILITIES_LABEL } from '../model/displayActions';
import {
  CloseGlyph,
  ListGlyph,
  ReplyGlyph,
  SendArrowGlyph,
} from './AssistantSheetGlyphs';

/**
 * 시트 테두리 부품(TRIP-1322, 틀 개정 TRIP-1525·1526) — 헤더 · quick reply · 입력 카드(컨텍스트 칩 + 입력 + 전송).
 * 라이브 Figma bv3 프레임을 옮겼다(헤더 = ✦ 원 30 + 더보기 + 닫기 각 44, 입력 카드 r28, 전송 원형 44).
 */

export function AssistantSheetHeader({
  onClose,
  trailing,
}: {
  onClose: () => void;
  trailing?: ReactElement | null;
}): ReactElement {
  return (
    <View className="h-[44px] flex-row items-center justify-between pl-lg pr-sm">
      <View
        testID="assistant-sheet-mark"
        className="h-[30px] w-[30px] items-center justify-center rounded-full bg-primary"
      >
        <SparkleGlyph size={16} />
      </View>
      <View className="flex-row items-center">
        {trailing}
        <Pressable
          testID="assistant-sheet-close"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="h-[44px] w-[44px] items-center justify-center"
        >
          <CloseGlyph size={24} />
        </Pressable>
      </View>
    </View>
  );
}

/** 입력 카드 안 컨텍스트 칩 — 보이는 문구는 surface 별 고정 라벨, 서버 문구(BR-U8-03)는 접근성 라벨에 싣는다. */
function ContextChip({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="assistant-context-chip"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // 시각 높이 37(Figma) — 터치는 위아래 4씩 늘려 45.
      hitSlop={{ top: 4, bottom: 4 }}
      className="min-h-[37px] flex-row items-center gap-[6px] self-start rounded-pill border border-hairline-strong bg-canvas px-md"
    >
      <ListGlyph />
      <Text className="font-noto text-label text-ink">{label}</Text>
    </Pressable>
  );
}

function ReplyChip({
  testID,
  label,
  onPress,
  disabled,
  stacked,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled: boolean;
  stacked: boolean;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // 시각 높이 36 전후 — 터치는 위아래 4씩 늘려 44 이상. 글자 크기가 커지면 min-h 로 칩이 함께 커진다.
      hitSlop={{ top: 4, bottom: 4 }}
      className={
        (stacked
          ? 'min-h-[36px] flex-row items-center gap-sm self-start rounded-pill bg-surface-strong pl-[14px] pr-lg'
          : 'rounded-pill border border-hairline-strong bg-canvas px-[14px] py-[9px]') +
        (disabled ? ' opacity-40' : '')
      }
    >
      {stacked ? <ReplyGlyph /> : null}
      <Text
        className={`font-noto ${stacked ? 'text-body' : 'text-label'} text-ink`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 서버 발급 quick reply + 상시 "내가 할 수 있는 것 보기"(BR-U8-04 — 클라가 만드는 유일한 칩).
 * 대화가 없으면 세로 스택(답장 아이콘 + 면 칩), 있으면 가로 스크롤 줄(외곽선 칩).
 */
export function QuickReplyBar({
  replies,
  showCapabilitiesChip,
  onPick,
  onPressCapabilities,
  disabled = false,
  stacked,
}: {
  replies: readonly QuickReply[];
  showCapabilitiesChip: boolean;
  onPick: (reply: QuickReply) => void;
  onPressCapabilities: () => void;
  disabled?: boolean;
  stacked: boolean;
}): ReactElement {
  // 상시 칩을 맨 앞에 둔다(TRIP-1436 Q-134) — 서버 칩이 늘면 맨 뒤 칩이 화면 밖으로 밀려 BR-U8-04 상시 노출이 깨졌다.
  // 서버가 SHOW_CAPABILITIES 를 목록 맨 끝에 직접 넣어 보내는 경우(실서버)에도 앞으로 보낸다(안정 정렬).
  const chips = (
    <>
      {showCapabilitiesChip ? (
        <ReplyChip
          testID="assistant-quick-reply-capabilities"
          label={CAPABILITIES_LABEL}
          disabled={disabled}
          stacked={stacked}
          onPress={onPressCapabilities}
        />
      ) : null}
      {[...replies]
        .sort(
          (a, b) =>
            Number(b.action === 'SHOW_CAPABILITIES') -
            Number(a.action === 'SHOW_CAPABILITIES')
        )
        .map((reply) => (
          <ReplyChip
            key={reply.id}
            testID={`assistant-quick-reply-${reply.id}`}
            label={reply.label}
            disabled={disabled}
            stacked={stacked}
            onPress={() => onPick(reply)}
          />
        ))}
    </>
  );
  if (stacked) {
    return (
      <View
        testID="assistant-quick-replies-stack"
        className="items-start gap-sm px-md pb-sm"
      >
        {chips}
      </View>
    );
  }
  return (
    <ScrollView
      testID="assistant-quick-replies-row"
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // 세로 flex 컨테이너에서 ScrollView 기본 flexGrow:1 이 남는 높이를 먹어 칩이 늘어난다 — 내용 높이만.
      className="flex-none grow-0"
      contentContainerClassName="gap-sm px-lg py-sm"
    >
      {chips}
    </ScrollView>
  );
}

/** 입력 카드 — 위 컨텍스트 칩 + 입력 행(입력 · 전송 원형). READY 칩은 입력 포커스, 능력 보기 칩은 SHOW_CAPABILITIES. */
export function Composer({
  value,
  onChange,
  onSend,
  canSend,
  sendTestID = 'assistant-send',
  chip,
  onPressCapabilities,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  canSend: boolean;
  sendTestID?: string;
  chip: { label: string; accessibilityLabel: string; capabilities: boolean };
  onPressCapabilities: () => void;
}): ReactElement {
  const inputRef = useRef<TextInput>(null);
  return (
    // 카드 반경 28 은 킷 토큰에 없다(Figma 입력 카드 r28) — 브래킷.
    <View className="gap-sm rounded-[28px] border border-hairline-strong bg-canvas px-md pb-[13px] pt-[15px]">
      <ContextChip
        label={chip.label}
        accessibilityLabel={chip.accessibilityLabel}
        onPress={
          chip.capabilities
            ? onPressCapabilities
            : () => inputRef.current?.focus()
        }
      />
      <View className="flex-row items-center gap-sm">
        <TextInput
          ref={inputRef}
          testID="assistant-input"
          value={value}
          onChangeText={onChange}
          placeholder="무엇이든 물어보세요…"
          placeholderTextColor="#9AA1AB"
          maxLength={COMPOSER_LIMIT}
          multiline
          className="max-h-[96px] min-h-[44px] flex-1 font-noto text-body text-ink"
        />
        <Pressable
          testID={sendTestID}
          accessibilityRole="button"
          accessibilityLabel="보내기"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => {
            // 보내면 키보드를 내린다(TRIP-1436 Q-134 결정 2=A) — 열린 채 답이 도착해 화면 절반을 덮던 것. 이어 물으려면 입력칸을 다시 누른다.
            Keyboard.dismiss();
            onSend();
          }}
          className={`h-[44px] w-[44px] items-center justify-center rounded-full ${canSend ? 'bg-primary' : 'bg-surface-strong'}`}
        >
          <SendArrowGlyph color={canSend ? '#FFFFFF' : '#9AA1AB'} />
        </Pressable>
      </View>
    </View>
  );
}

/** 「일정 보기」를 누른 뒤 목적지를 정하는 동안의 한 줄(TRIP-1566) — 확인 중이거나 조회 실패(다시 누르면 재조회). */
export function ItineraryStatusRow({
  state,
}: {
  state: 'CHECKING' | 'FAILED';
}): ReactElement {
  const failed = state === 'FAILED';
  return (
    <View
      testID={
        failed ? 'assistant-itinerary-failed' : 'assistant-itinerary-checking'
      }
      className="px-lg py-xs"
    >
      <Text
        className={`font-noto text-caption ${failed ? 'text-primary-text' : 'text-muted'}`}
      >
        {failed
          ? '일정을 불러오지 못했어요. 다시 눌러 주세요'
          : '일정을 확인하고 있어요'}
      </Text>
    </View>
  );
}

/**
 * 입력창 위 한 줄(TRIP-1326) — 보내는 중(진행 + [대기 취소], 15s 넘으면 강조) · 보내지 못함([다시 보내기]) ·
 * 429(남은 초). 하나도 아니면 그리지 않는다.
 */
export function TurnStatusRow({
  sending,
  slow,
  failed,
  rateLimitedSeconds,
  onCancel,
  onResend,
}: {
  sending: boolean;
  slow: boolean;
  failed: boolean;
  rateLimitedSeconds: number;
  onCancel: () => void;
  onResend: () => void;
}): ReactElement | null {
  if (rateLimitedSeconds > 0) {
    return (
      <View testID="assistant-rate-limited" className="px-lg py-xs">
        <Text className="font-noto text-caption text-primary-text">
          잠시 후 다시 시도해 주세요 ({rateLimitedSeconds}초)
        </Text>
      </View>
    );
  }
  if (sending) {
    return (
      <View
        testID="assistant-progress"
        className="flex-row items-center justify-between px-lg py-xs"
      >
        <Text
          testID={slow ? 'assistant-progress-slow' : undefined}
          className={`font-noto text-caption ${slow ? 'text-primary-text' : 'text-muted'}`}
        >
          {slow ? '응답이 늦어지고 있어요' : '답을 준비하고 있어요…'}
        </Text>
        <Pressable
          testID="assistant-progress-cancel"
          accessibilityRole="button"
          onPress={onCancel}
          hitSlop={8}
          className={`rounded-button px-md py-xs ${slow ? 'bg-primary' : 'bg-surface-strong'}`}
        >
          <Text
            className={`font-noto-bold text-caption font-bold ${slow ? 'text-on-primary' : 'text-ink'}`}
          >
            대기 취소
          </Text>
        </Pressable>
      </View>
    );
  }
  if (failed) {
    return (
      <View className="flex-row items-center justify-between px-lg py-xs">
        <Text className="font-noto text-caption text-primary-text">
          보내지 못했어요 · 임시 보관 중
        </Text>
        <Pressable
          testID="assistant-resend"
          accessibilityRole="button"
          onPress={onResend}
          hitSlop={8}
          className="rounded-button bg-surface-strong px-md py-xs"
        >
          <Text className="font-noto-bold text-caption font-bold text-ink">
            다시 보내기
          </Text>
        </Pressable>
      </View>
    );
  }
  return null;
}
