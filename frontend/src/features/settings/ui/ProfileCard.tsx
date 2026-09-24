import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CARD_SHADOW } from './cardShadow';
import { InfoChip } from './InfoChip';

/**
 * TRIP-604 · l03 프로필 카드 — 순수 프레젠테이션(props 만). 아바타(닉네임 이니셜)·닉네임·이메일·
 * 편집 버튼 + 여행 상태 카운트 3칸(예정·진행 중·종료). 카운트는 `bucketTrips` 길이라 페이지가
 * 계산해 내린다(분류 권위는 순수 함수에, 여긴 표시만).
 *
 * 폴백(Seed Q3): `nickname` null/미도착 → 아바타 공백 + 이름 자리 스켈레톤 바(안전 degrade),
 * `email` null → 이메일 행 생략. 서버가 없는 값을 지어내지 않는다.
 *
 * TRIP-775(Figma 1602:2388): 태그 줄(`tags` — 페이지가 정식 분석 descriptors 만 내린다, 서버가 이미
 * `#` 를 붙여 주므로 그대로) · [편집] 아이콘 제거 · 카운트 칸 사이 세로선 2개 · 윗줄과 카운트 사이 가로선.
 * 구분선은 한 변 border 가 아니라 막대 View 다(repo-traps 「테두리」 — border-hairline 은 네 변 두께를 함께 건드린다).
 */

export interface ProfileCardCounts {
  upcoming: number;
  active: number;
  ended: number;
}

export interface ProfileCardProps {
  nickname: string | null;
  email: string | null;
  counts: ProfileCardCounts;
  /** 편집 진입 — 목적지 라우트(l02) 미존재라 미배선일 수 있다(Q6). */
  onPressEdit?: () => void;
  /** 프로필 태그(서버 문자열 그대로). 없거나 빈 배열이면 태그 줄을 그리지 않는다. */
  tags?: string[];
}

/** 카운트 한 칸(숫자 + 라벨) — 3칸이 같은 모양이라 한 번만 짠다. */
function StatCell({
  count,
  label,
}: {
  count: number;
  label: string;
}): ReactElement {
  return (
    <View className="flex-1 items-center gap-xs">
      <Text className="font-inter-bold text-[20px] font-bold text-ink">
        {count}
      </Text>
      <Text className="font-noto text-caption text-muted">{label}</Text>
    </View>
  );
}

export function ProfileCard({
  nickname,
  email,
  counts,
  onPressEdit,
  tags,
}: ProfileCardProps): ReactElement {
  const initial = nickname ? Array.from(nickname)[0] : '';

  return (
    <View
      testID="my-profile-card"
      style={CARD_SHADOW}
      className="w-full gap-[14px] rounded-[12px] border border-hairline bg-canvas p-lg"
    >
      <View className="flex-row items-center gap-[14px]">
        {/* 아바타 — 이니셜 텍스트(사진 아님). 닉네임 없으면 공백 원. */}
        <View className="h-[60px] w-[60px] items-center justify-center rounded-[30px] bg-primary-pale">
          <Text className="font-noto-bold text-hero font-bold text-primary-text">
            {initial}
          </Text>
        </View>

        <View className="flex-1 gap-[3px]">
          {nickname ? (
            <Text
              numberOfLines={1}
              className="font-noto-bold text-[18px] font-bold text-ink"
            >
              {nickname}
            </Text>
          ) : (
            <View className="h-[18px] w-1/2 rounded-input bg-surface-soft" />
          )}
          {email !== null ? (
            <Text numberOfLines={1} className="font-noto text-label text-muted">
              {email}
            </Text>
          ) : null}
        </View>

        {/* 편집 목적지가 없으면 [편집]을 그리지 않는다(TRIP-939 B-3). */}
        {onPressEdit ? (
          <Pressable
            testID="my-profile-edit"
            accessibilityRole="button"
            onPress={onPressEdit}
            className="rounded-[8px] border border-hairline-strong bg-canvas px-[13px] py-[7px]"
          >
            <Text className="font-noto-bold text-[12.5px] font-bold text-ink">
              편집
            </Text>
          </Pressable>
        ) : null}
      </View>

      {tags && tags.length > 0 ? (
        <View className="flex-row flex-wrap gap-sm">
          {tags.map((tag) => (
            <InfoChip key={tag} label={tag} testID="my-profile-tag" />
          ))}
        </View>
      ) : null}

      <View className="h-px bg-hairline" />

      {/* 상태 카운트 3칸 — 칸 사이 세로선 */}
      <View className="flex-row items-center">
        <StatCell count={counts.upcoming} label="예정" />
        <View
          testID="my-profile-count-divider"
          className="h-[30px] w-px bg-hairline"
        />
        <StatCell count={counts.active} label="진행 중" />
        <View
          testID="my-profile-count-divider"
          className="h-[30px] w-px bg-hairline"
        />
        <StatCell count={counts.ended} label="종료" />
      </View>
    </View>
  );
}
