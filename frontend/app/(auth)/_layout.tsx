import { Stack } from 'expo-router';

import { PRESS_GUARD_SCREEN_LISTENERS } from '@/shared/lib/pressGuard';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false }}
      screenListeners={PRESS_GUARD_SCREEN_LISTENERS}
    />
  );
}
