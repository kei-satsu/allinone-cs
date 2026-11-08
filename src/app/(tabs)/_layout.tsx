import { Tabs } from 'expo-router';

import { BottomDock } from '@/components/BottomDock';
import { TabBlurProvider, TabBlurTarget } from '@/components/TabBlurContext';

export default function TabLayout() {
  return (
    <TabBlurProvider>
      <Tabs
        tabBar={(props) => <BottomDock {...props} />}
        screenLayout={({ route, children }) => (
          <TabBlurTarget routeKey={route.key}>{children}</TabBlurTarget>
        )}
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            position: 'absolute',
            height: 100,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
          },
          sceneStyle: {
            backgroundColor: '#090909',
          },
          animation: 'shift',
          transitionSpec: {
            animation: 'spring',
            config: {
              stiffness: 220,
              damping: 24,
              mass: 0.8,
            },
          },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
          }}
        />
        <Tabs.Screen
          name="pickups"
          options={{
            title: 'Pickups',
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: 'Explore',
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
          }}
        />
      </Tabs>
    </TabBlurProvider>
  );
}
