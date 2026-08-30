import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph } from './SettingsGlyphs';
import { RowBody } from './SettingsRow';

/**
 * 데이터 내보내기 행 — 누르면 페이지가 `GET /me/export` 를 지연 조회해 요약을 만들고 내장 Share 로
 * 넘긴다. `truncatedLabel` 이 있으면(상한에 걸려 잘린 몫이 있으면) 그 목록을 **표면화**한다 —
 * 조용히 삼키지 않는다(AC-5, INV-4). 비면 고지를 안 그린다(반대 짝).
 *
 * `errorLabel` 은 조회 자체가 실패(data 미도착)했을 때의 안내다 — `truncatedLabel` 과 별개 자리라
 * 둘 다 표시 가능하되, 실패 시엔 잘림 고지 없이 오류만 뜬다(TRIP-620 [608], INV-4).
 */
export function ExportRow({
  onPress,
  truncatedLabel,
  errorLabel,
}: {
  onPress: () => void;
  truncatedLabel?: string | null;
  errorLabel?: string | null;
}): ReactElement {
  return (
    <View testID="settings-row">
      <Pressable testID="settings-export-row" onPress={onPress}>
        <RowBody
          rowKey="export"
          label="데이터 내보내기"
          right={<ChevronRightGlyph />}
        />
      </Pressable>
      {truncatedLabel ? (
        <Text
          testID="settings-export-truncated"
          className="px-lg pb-md font-noto text-caption text-primary-text"
        >
          {truncatedLabel}
        </Text>
      ) : null}
      {errorLabel ? (
        <Text
          testID="settings-export-error"
          className="px-lg pb-md font-noto text-caption text-primary-text"
        >
          {errorLabel}
        </Text>
      ) : null}
    </View>
  );
}
