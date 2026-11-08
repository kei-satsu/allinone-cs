import type { ComponentRef, RefObject, ReactNode } from 'react';
import { BlurTargetView } from 'expo-blur';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';

type BlurTarget = RefObject<ComponentRef<typeof View> | null>;

type TabBlurContextValue = {
  targets: Record<string, BlurTarget>;
  registerTarget: (routeKey: string, target: BlurTarget | null) => void;
};

const TabBlurContext = createContext<TabBlurContextValue | null>(null);

export function TabBlurProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Record<string, BlurTarget>>({});
  const registerTarget = useCallback((routeKey: string, target: BlurTarget | null) => {
    setTargets((current) => {
      if (target) return { ...current, [routeKey]: target };
      const { [routeKey]: _removed, ...remaining } = current;
      return remaining;
    });
  }, []);

  return (
    <TabBlurContext.Provider value={{ targets, registerTarget }}>
      {children}
    </TabBlurContext.Provider>
  );
}

export function TabBlurTarget({
  routeKey,
  children,
}: {
  routeKey: string;
  children: ReactNode;
}) {
  const context = useContext(TabBlurContext);
  const registerTarget = context?.registerTarget;
  const targetRef = useRef<ComponentRef<typeof View> | null>(null);

  useEffect(() => {
    if (!registerTarget) return;
    registerTarget(routeKey, targetRef);
    return () => registerTarget(routeKey, null);
  }, [registerTarget, routeKey]);

  if (!context) throw new Error('TabBlurTarget must be used inside TabBlurProvider.');

  return (
    <BlurTargetView ref={targetRef} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}

export function useTabBlurTarget(routeKey?: string) {
  const context = useContext(TabBlurContext);
  if (!context) throw new Error('useTabBlurTarget must be used inside TabBlurProvider.');
  return routeKey ? context.targets[routeKey] : undefined;
}
