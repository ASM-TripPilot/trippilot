import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PencilGlyph } from './SettingsGlyphs';

/**
 * TRIP-604 · l03 프로필 카드 — 순수 프레젠테이션(props 만). 아바타(닉네임 이니셜)·닉네임·이메일·
 * 편집 버튼 + 여행 상태 카운트 3칸(예정·진행 중·종료). 카운트는 `bucketTrips` 길이라 페이지가
 * 계산해 내린다(분류 권위는 순수 함수에, 여긴 표시만).
 *
 * 폴백(Seed Q3): `nickname` null/미도착 → 아바타 공백 + 이름 자리 스켈레톤 바(안전 degrade),
 * `email` null → 이메일 행 생략. 서버가 없는 값을 지어내지 않는다.
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
    <View className="flex-1 items-center gap-[2px]">
      <Text className="font-noto-bold text-[20px] font-bold text-ink">
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
}: ProfileCardProps): ReactElement {
  const initial = nickname ? Array.from(nickname)[0] : '';

  return (
    <View
      testID="my-profile-card"
      className="w-full gap-[14px] rounded-card border border-hairline bg-canvas p-[14px]"
    >
      <View className="flex-row items-center gap-md">
        {/* 아바타 — 이니셜 텍스트(사진 아님). 닉네임 없으면 공백 원. */}
        <View className="h-[60px] w-[60px] items-center justify-center rounded-[30px] bg-primary-pale">
          <Text className="font-noto-bold text-hero font-bold text-primary-text">
            {initial}
          </Text>
        </View>

        <View className="flex-1 gap-[2px]">
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

        <Pressable
          testID="my-profile-edit"
          accessibilityRole="button"
          onPress={onPressEdit}
          className="flex-row items-center gap-[3px] rounded-pill border border-hairline-strong px-md py-[6px]"
        >
          <PencilGlyph size={13} />
          <Text className="font-noto text-label text-body">편집</Text>
        </Pressable>
      </View>

      {/* 상태 카운트 3칸 */}
      <View className="flex-row items-center border-t border-hairline pt-[14px]">
        <StatCell count={counts.upcoming} label="예정" />
        <StatCell count={counts.active} label="진행 중" />
        <StatCell count={counts.ended} label="종료" />
      </View>
    </View>
  );
}
