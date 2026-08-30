import { useQueryClient } from '@tanstack/react-query';

import {
  getGetMeNotificationSettingsQueryKey,
  patchMeNotificationSettingsKind,
  useGetMeNotificationSettings,
} from '@/shared/api/generated/notification/notification';
import type {
  NotificationToggle,
  NotificationToggleKind,
  NotificationToggleList,
  UpdateToggleRequest,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-607 · l02 알림 설정 — 7행 조회(useGetMeNotificationSettings) + kind×채널 낙관 갱신 훅.
 *
 * `toggle(kind, channel, next)` 는 서버 응답을 기다리지 않고 그 kind 의 해당 채널만 캐시에서 먼저
 * 바꾸고(낙관), PATCH 는 **바뀐 필드만** 보낸다(다른 필드는 바디에 싣지 않는다 — null=변경없음).
 * 실패하면 그 kind×채널만 이전 값으로 되돌리고(kind×채널 단위 롤백, useVisitCheck 선례) 실패를
 * 호출자에게 알린다(INV-4 침묵 금지). 실패 경로에서는 무효화하지 않는다(재요청이 롤백을 덮으면
 * "되돌렸나"를 관측할 수 없다 — savedPlaces 규율).
 *
 * ⚠ 이 파일은 [테스트 작성]이 낸 red-phase 스텁이다 — 구현은 implementer 몫(throw 로 red 보장).
 */

export type ToggleChannel = 'push' | 'inapp';

export type ToggleOutcome = { kind: 'ok' } | { kind: 'failed' };

export interface UseTogglesResult {
  /** GET 응답의 7종(COMMUNITY 포함) — 화면이 그중 6종만 그린다. */
  items: NotificationToggle[];
  isLoading: boolean;
  isError: boolean;
  toggle: (
    kind: NotificationToggleKind,
    channel: ToggleChannel,
    next: boolean
  ) => Promise<ToggleOutcome>;
}

export function useToggles(): UseTogglesResult {
  const queryClient = useQueryClient();
  const query = useGetMeNotificationSettings();
  const key = getGetMeNotificationSettingsQueryKey();

  /** 그 kind 의 한 채널만 캐시에서 바꾼다(다른 kind·다른 채널은 불변 — kind×채널 단위). */
  function patchChannel(
    kind: NotificationToggleKind,
    channel: ToggleChannel,
    value: boolean
  ): void {
    queryClient.setQueryData<NotificationToggleList>(key, (current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) =>
          item.kind === kind
            ? {
                ...item,
                ...(channel === 'push'
                  ? { pushEnabled: value }
                  : { inAppEnabled: value }),
              }
            : item
        ),
      };
    });
  }

  async function toggle(
    kind: NotificationToggleKind,
    channel: ToggleChannel,
    next: boolean
  ): Promise<ToggleOutcome> {
    // 롤백용 이전 값을 낙관 반영 전에 캐시에서 읽어 둔다.
    const item = queryClient
      .getQueryData<NotificationToggleList>(key)
      ?.items.find((i) => i.kind === kind);
    const previous =
      channel === 'push' ? item?.pushEnabled : item?.inAppEnabled;

    // 낙관 — 서버 응답 전에 그 채널만 먼저 바꾼다.
    patchChannel(kind, channel, next);

    // 바뀐 필드 하나만 싣는다 — 다른 필드는 키 자체를 넣지 않는다(null=변경없음이라
    // 동봉하면 다른 쪽을 덮는다, openapi UpdateToggleRequest).
    const data: UpdateToggleRequest =
      channel === 'push' ? { pushEnabled: next } : { inAppEnabled: next };

    try {
      await patchMeNotificationSettingsKind(kind, data);
      // 성공 — 서버 정본으로 다시 받아 온다.
      void queryClient.invalidateQueries({ queryKey: key });
      return { kind: 'ok' };
    } catch {
      // 실패 — 그 kind×채널만 이전 값으로 되돌린다(통짜 스냅숏 복원 아님 — 동시 토글 보존).
      // 무효화하지 않는다: 재요청이 롤백을 덮으면 "되돌렸나"를 관측할 수 없다(INV-4·savedPlaces 규율).
      if (previous !== undefined) patchChannel(kind, channel, previous);
      return { kind: 'failed' };
    }
  }

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    toggle,
  };
}
