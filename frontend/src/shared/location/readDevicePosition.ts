import * as Location from 'expo-location';

/** 권한 조회부터 측위까지 합산 한도 — 넘으면 포기하고 늦게 온 좌표는 버린다(TRIP-979 Seed Q2). */
const TIMEOUT_MS = 5_000;
/** 캐시 위치 신선도 한도 — 5분보다 오래된 lastKnown 은 쓰지 않는다(Seed Q1). */
const LAST_KNOWN_MAX_AGE_MS = 300_000;

async function readOnce(): Promise<{ lat: number; lng: number } | null> {
  // 조회만 한다 — 권한 팝업(request)은 띄우지 않는다.
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const position =
    (await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
    })) ??
    // Android 에서 기기 위치가 꺼져 있어도 시스템 설정 대화상자를 띄우지 않는다(다시 묻지 않음, Seed Q4).
    (await Location.getCurrentPositionAsync({
      mayShowUserSettingsDialog: false,
    }));
  if (!position) return null;
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

/**
 * 단말 위치를 1회 읽는다(권한 조회 → 5분 이내 lastKnown → current). 권한 없음·실패·5초 초과는
 * 전부 `null` 로 resolve 한다 — 호출부를 막지 않는다(reject 하지 않음).
 */
export async function readDevicePosition(): Promise<{
  lat: number;
  lng: number;
} | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  });
  try {
    return await Promise.race([readOnce().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
