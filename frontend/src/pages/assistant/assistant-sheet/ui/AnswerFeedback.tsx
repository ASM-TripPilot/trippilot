import type { ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  FEEDBACK_COMMENT_LIMIT,
  FEEDBACK_REASONS,
  type FeedbackRating,
  type FeedbackReason,
} from '../api/assistantContract';
import {
  canSubmitComment,
  FEEDBACK_THANKS,
  type FeedbackPanel,
} from '../model/answerFeedback';
import { ThumbGlyph } from './AssistantSheetGlyphs';

/**
 * 답 평가 줄(US-ASSIST-09) — 도우미 답 아래 엄지 둘, 싫어요 뒤엔 이유 칩 셋 + "직접 적기"(300자 입력 + 보내기),
 * 보낸 뒤 고마워요 안내, 실패 안내. 순수 뷰다 — 토글 판정·낙관 갱신·롤백은 page 쪽 `useAnswerFeedback` 이 하고
 * 여기는 받은 값만 그려 누름을 올린다. Figma 없음 — 사용자 결정(엄지 아이콘 두 개로 먼저 구현, Figma 는 나중에
 * 맞춤). 문구는 FE 고유다. 목록 안 입력창이 키보드에 가리는지는 jest 사각(6-b 실기).
 */

export interface AnswerFeedbackProps {
  messageId: string;
  rating: FeedbackRating | null;
  /** 싫어요 뒤 펼친 칸 — null 이면 접힘. */
  panel: FeedbackPanel | null;
  /** 이 답의 평가를 보내는 중 — 엄지·칩·보내기를 잠시 막고 흐리게 그린다. */
  busy: boolean;
  /** 실패 안내(되돌린 뒤). */
  error: string | null;
  onPressThumb: (rating: FeedbackRating) => void;
  onPickReason: (reason: FeedbackReason) => void;
  onOpenComment: () => void;
  onChangeComment: (text: string) => void;
  onSubmitComment: () => void;
}

const THUMBS: readonly { rating: FeedbackRating; label: string }[] = [
  { rating: 'UP', label: '좋아요' },
  { rating: 'DOWN', label: '싫어요' },
];

const REASON_LABEL: Record<FeedbackReason, string> = {
  WRONG: '틀렸어요',
  NOT_HELPFUL: '도움이 안 돼요',
  NOT_WHAT_I_WANTED: '원한 답이 아니에요',
};

function Chip({
  testID,
  label,
  selected,
  disabled,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      // 터치 = 이 상자(높이 44), 알약(26)은 안쪽 View 가 그린다. hitSlop 으로 넓히면 평가 줄(부모) 밖으로 나간
      // 부분이 안 눌린다 — 새 아키텍처는 부모가 그 점을 품어야 자식에게 묻는다. 흐림 = 지금 못 누름(보내는 중) —
      // 고른 칸은 비활성이어도 흐리지 않는다(쓰는 중의 "직접 적기"는 모드 표시다).
      className={`min-h-[44px] justify-center${disabled && !selected ? ' opacity-40' : ''}`}
    >
      <View
        className={`rounded-button border px-md py-xs ${selected ? 'border-ink bg-surface-strong' : 'border-hairline-strong bg-canvas'}`}
      >
        <Text className="font-noto text-caption text-ink">{label}</Text>
      </View>
    </Pressable>
  );
}

export function AnswerFeedback({
  messageId,
  rating,
  panel,
  busy,
  error,
  onPressThumb,
  onPickReason,
  onOpenComment,
  onChangeComment,
  onSubmitComment,
}: AnswerFeedbackProps): ReactElement {
  const writing = panel?.step === 'WRITING' ? panel : null;
  const sendable = writing !== null && canSubmitComment(writing) && !busy;
  return (
    <View testID={`assistant-feedback-${messageId}`} className="gap-xs">
      {/* 엄지는 44×44 상자(글리프 20 + 사방 12)로 누른다 — hitSlop 은 부모 밖에서 안 눌린다(칩 주석). 둘을 붙여
          글리프 사이 24 는 그대로 두고, 상자가 여백을 품으니 줄 사이(gap)는 xs 로 줄였다. */}
      <View className="flex-row items-center">
        {THUMBS.map((thumb) => (
          <Pressable
            key={thumb.rating}
            testID={`assistant-feedback-${thumb.rating.toLowerCase()}-${messageId}`}
            accessibilityRole="button"
            accessibilityLabel={thumb.label}
            accessibilityState={{
              selected: rating === thumb.rating,
              disabled: busy,
            }}
            disabled={busy}
            onPress={() => onPressThumb(thumb.rating)}
            className={`h-[44px] w-[44px] items-center justify-center${busy ? ' opacity-40' : ''}`}
          >
            <ThumbGlyph
              rating={thumb.rating}
              selected={rating === thumb.rating}
            />
          </Pressable>
        ))}
      </View>

      {panel?.step === 'REASONS' || writing ? (
        <View className="flex-row flex-wrap gap-x-sm">
          {FEEDBACK_REASONS.map((reason) => (
            <Chip
              key={reason}
              testID={`assistant-feedback-reason-${reason}-${messageId}`}
              label={REASON_LABEL[reason]}
              selected={writing?.reason === reason}
              disabled={busy}
              onPress={() => onPickReason(reason)}
            />
          ))}
          {/* 쓰는 중엔 할 일이 없는 버튼이다 — 고른 채 비활성(심사 2.1: 아무것도 안 하는 버튼 금지). */}
          <Chip
            testID={`assistant-feedback-comment-${messageId}`}
            label="직접 적기"
            selected={writing !== null}
            disabled={busy || writing !== null}
            onPress={onOpenComment}
          />
        </View>
      ) : null}

      {writing ? (
        <View className="flex-row items-end gap-sm">
          <TextInput
            testID={`assistant-feedback-comment-input-${messageId}`}
            value={writing.comment}
            onChangeText={onChangeComment}
            placeholder="어떤 점이 아쉬웠는지 적어 주세요"
            placeholderTextColor="#9AA1AB"
            maxLength={FEEDBACK_COMMENT_LIMIT}
            multiline
            autoFocus
            className="max-h-[96px] min-h-[40px] flex-1 rounded-input border border-hairline-strong bg-canvas px-md py-sm font-noto text-label text-ink"
          />
          <Pressable
            testID={`assistant-feedback-comment-send-${messageId}`}
            accessibilityRole="button"
            // 입력창 [보내기](Composer "보내기")와 스크린리더 이름이 겹치지 않게.
            accessibilityLabel="의견 보내기"
            accessibilityState={{ disabled: !sendable }}
            disabled={!sendable}
            onPress={onSubmitComment}
            // 터치 = 높이 44 상자, 알약(34)은 그 바닥에 붙여 입력창 아랫선과 맞춘다(hitSlop 은 부모 밖에서 안 눌린다).
            className={`min-h-[44px] justify-end${sendable ? '' : ' opacity-40'}`}
          >
            <View className="rounded-button bg-primary px-md py-sm">
              <Text className="font-noto-bold text-label font-bold text-on-primary">
                보내기
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {panel?.step === 'THANKS' ? (
        <Text
          testID={`assistant-feedback-thanks-${messageId}`}
          className="font-noto text-caption text-muted"
        >
          {FEEDBACK_THANKS}
        </Text>
      ) : null}

      {error ? (
        <Text
          testID={`assistant-feedback-error-${messageId}`}
          className="font-noto text-caption text-primary-text"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
