import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { openAppSettings } from '@/shared/external-link';

import { readPhotoAccess, resolvePhotoUri } from './index';

/**
 * TRIP-1803 · 사진 주소 쿼리 옵션과 권한 안내 — j01·앨범·회고·표지가 함께 쓴다.
 * `./index` 를 물어 웹은 `index.web` 으로 풀린다(웹은 권한이 늘 `all` 이라 안내가 안 그려진다).
 *
 * (개념) `staleTime` 에 함수를 주면 받아 온 값을 보고 낡음을 정한다. 못 푼 사진(`null`)만 바로 낡은 값이라 앱 복귀 때 다시 묻고
 * (설정에서 권한을 넓혔을 수 있다), 풀린 사진은 다시 안 묻는다(하루치 수십 장이 복귀마다 iCloud 내려받기를 부르지 않게).
 */
export function photoUriQueryOptions(localAssetId: string) {
  return queryOptions({
    queryKey: ['photo-uri', localAssetId],
    queryFn: () => resolvePhotoUri(localAssetId),
    staleTime: (query) => (query.state.data === null ? 0 : Infinity),
  });
}

const ACCESS_COPY = {
  limited:
    '사진 접근이 "선택한 사진만"으로 제한돼 있어요. 접근 범위는 설정에서 바꿀 수 있어요',
  denied: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
} as const;

/**
 * 못 푼 사진이 있는 화면이 그린다 — 권한이 limited·거부일 때만 안내 + 사용자가 누르는 [설정 열기](요청 팝업 0, BR-U5-14).
 * 전체 허용·아직 안 물어봄·응답 전엔 아무것도 안 그린다. 권한 조회는 네트워크와 무관해 오프라인에도 돈다(`networkMode`).
 */
export function PhotoAccessNotice({
  testID,
}: {
  testID: string;
}): ReactElement | null {
  const { data: access } = useQuery({
    queryKey: ['photo-access'],
    queryFn: () => readPhotoAccess(),
    staleTime: 0,
    networkMode: 'always',
  });
  if (access === undefined || access === 'all') return null;

  return (
    <View testID={testID} className="gap-xs">
      <Text className="font-noto text-caption text-muted">
        {ACCESS_COPY[access]}
      </Text>
      <Pressable
        testID={`${testID}-settings`}
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => void openAppSettings()}
        className="self-start"
      >
        <Text className="font-noto-bold text-caption text-primary">
          설정 열기
        </Text>
      </Pressable>
    </View>
  );
}
