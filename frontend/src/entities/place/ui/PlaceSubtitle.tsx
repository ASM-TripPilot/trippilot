import type { ReactElement } from 'react';
import { Text } from 'react-native';

/**
 * TRIP-806 · AC-M2 — 장소 "부제 조각"(3-a 결정).
 *
 * `parts` 를 ' · ' 로 **잇기만** 한다 — 어떤 조각을 넣을지는 화면이 정한다(d04·d06 `카테고리·지역` /
 * i10 `tags` / h13 `#tags·카테고리`). 나이브 통합으로 세 화면 표시가 바뀌는 걸 막는 설계다.
 *
 * 스타일(`className`)·`numberOfLines` 는 소비처가 자기 자리(사진 위 흰 글씨·회색 부제 등)에 맞춰
 * 주입한다 — 표시 텍스트(조인 결과)는 어디서 쓰든 같다.
 */
export interface PlaceSubtitleProps {
  parts: string[];
  className?: string;
  numberOfLines?: number;
}

export function PlaceSubtitle({
  parts,
  className = 'font-noto text-label text-muted',
  numberOfLines,
}: PlaceSubtitleProps): ReactElement {
  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {parts.join(' · ')}
    </Text>
  );
}
