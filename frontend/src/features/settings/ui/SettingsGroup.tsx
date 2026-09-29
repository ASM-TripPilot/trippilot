import { Children, type ReactElement, type ReactNode } from 'react';
import { Text, View } from 'react-native';

/**
 * 설정 그룹 — 라벨 + 카드(흰 bg·hairline 테두리·rounded-card). 카드 안 행 사이엔 인셋 hairline
 * 구분선을 넣는다. testID 는 그룹 계수용 공통 `settings-group`.
 *
 * 라벨은 별도 Text 라 `within(group).getByText('위치정보')` 가 그룹 라벨을 완전일치로 잡는다
 * (행 라벨 'GPS 이동경로 기록'과 갈린다 — 문자열 매처는 완전일치). 라벨이 null 이면 머리글 없는
 * 카드만 그린다(TRIP-1051 취향 그룹 — 빈 Text 도 남기지 않는다, gap-sm 높이가 남기 때문).
 */
export function SettingsGroup({
  label,
  children,
}: {
  label: string | null;
  children: ReactNode;
}): ReactElement {
  const rows = Children.toArray(children);
  return (
    <View testID="settings-group" className="gap-sm">
      {label !== null ? (
        <Text className="px-xs font-noto-bold text-label text-muted">
          {label}
        </Text>
      ) : null}
      <View className="rounded-card border border-hairline bg-canvas">
        {rows.map((row, index) => (
          <View key={index}>
            {row}
            {index < rows.length - 1 ? (
              <View className="mx-lg h-px bg-hairline" />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
