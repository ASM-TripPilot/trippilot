import { Text, View } from 'react-native';

export function SplashScreen() {
  return (
    <View
      testID="shell-splash-root"
      className="flex-1 items-center justify-center bg-white"
    >
      <View
        testID="shell-splash-logo"
        className="h-20 w-20 rounded-2xl bg-black"
      />
      <Text testID="shell-splash-wordmark" className="mt-6 text-3xl font-bold">
        TripPilot
      </Text>
      <Text
        testID="shell-splash-slogan"
        className="mt-2 text-base text-gray-600"
      >
        여행의 처음부터 끝까지, 한 곳에서
      </Text>
      <View
        testID="shell-splash-progress"
        className="mt-10 h-2 w-16 flex-row items-center justify-center gap-1"
      />
    </View>
  );
}
