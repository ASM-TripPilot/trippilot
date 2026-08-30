import { type ReactElement, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ChevronRightGlyph } from './SettingsGlyphs';
import { RowBody } from './SettingsRow';

/**
 * 계정 닉네임 행 — **행 인라인 확장** 편집(Q5). 트리거를 누르면 같은 행 안에서 TextInput +
 * [저장]이 펼쳐진다(별도 시트/화면 아님, 더 게으름).
 *
 * 요약값(닉네임)은 **확장 중에도 상시 Text 로** 보인다 — AC-2(200 뒤 갱신)·AC-8(409 뒤 미변경)이
 * `getByText(닉네임)` 으로 잡히려면 입력값(TextInput value 는 getByText 에 안 걸린다)이 아니라
 * 요약 Text 를 봐야 한다. 그래서 `value` 는 페이지가 쥔 최신 닉네임 prop 을 그대로 그린다.
 *
 * 검증(길이)·서버 오류 판정은 페이지 몫이다 — 저장 press 는 현재 초안을 `onSubmit` 으로 올릴 뿐이고,
 * 오류 문구는 `error` prop 으로 내려와 인라인 표시된다(비면 미표시 — 침묵 금지의 반대 짝).
 */
export function NicknameEditRow({
  value,
  error,
  onSubmit,
}: {
  value: string;
  error?: string | null;
  onSubmit: (draft: string) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <View testID="settings-row">
      <Pressable
        testID="settings-nickname-edit"
        onPress={() => {
          if (!expanded) setDraft(value);
          setExpanded((prev) => !prev);
        }}
      >
        <RowBody
          rowKey="nickname"
          label="닉네임·이메일"
          right={
            <View className="flex-row items-center gap-sm">
              <Text className="font-noto text-body text-muted">{value}</Text>
              <ChevronRightGlyph />
            </View>
          }
        />
      </Pressable>

      {expanded ? (
        <View className="gap-sm px-lg pb-lg">
          <View className="flex-row items-center gap-sm">
            <TextInput
              testID="settings-nickname-input"
              value={draft}
              onChangeText={setDraft}
              autoCapitalize="none"
              placeholder="새 닉네임"
              placeholderTextColor="#9AA1AB"
              className="h-11 flex-1 rounded-input border border-hairline-strong px-md font-noto text-body text-ink"
            />
            <Pressable
              testID="settings-nickname-save"
              onPress={() => onSubmit(draft)}
              className="h-11 items-center justify-center rounded-button bg-ink px-lg"
            >
              <Text className="font-noto-bold text-body text-canvas">저장</Text>
            </Pressable>
          </View>
          {error ? (
            <Text
              testID="settings-nickname-error"
              className="font-noto text-caption text-primary-text"
            >
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
