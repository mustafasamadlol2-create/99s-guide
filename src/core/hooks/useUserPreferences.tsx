import { SecureStorage } from "../utils/secureStorage";
import { apiClient } from '../api/apiClient';
import { useState, useEffect, useRef, useCallback } from "react";
import { NativeBridge } from '../device/capacitor/nativeBridge';

type ThemeType = 'light' | 'dark' | 'system';

interface UserPreferences {
  theme: ThemeType;
  language: 'en' | 'ar';
  pushAlerts: boolean;
}

export function useUserPreferences(initialPreferences: UserPreferences) {
  const [preferences, setPreferences] = useState<UserPreferences>(initialPreferences);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousPreferencesRef = useRef<UserPreferences>(initialPreferences);
  const isInitialMount = useRef(true);

  // Theme resolution
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    try {
      if (initialPreferences.theme === 'system') {
        if (typeof window !== 'undefined' && window.matchMedia) {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light';
      }
      return initialPreferences.theme;
    } catch {
      return 'light';
    }
  });

  const updatePreference = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences(prev => {
      previousPreferencesRef.current = prev;
      return { ...prev, [key]: value };
    });
  }, []);

  // Sync theme visual changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (preferences.theme === 'system') {
        setResolvedTheme(e.matches ? 'dark' : 'light');
      }
    };

    if (preferences.theme === 'system') {
      setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
    } else {
      setResolvedTheme(preferences.theme);
    }

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [preferences.theme]);

  useEffect(() => {
    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      NativeBridge.setStatusBarStyle('dark');
    } else {
      document.documentElement.classList.remove('dark');
      NativeBridge.setStatusBarStyle('light');
    }
  }, [resolvedTheme]);

  // Sync language visual changes (direction)
  useEffect(() => {
    document.documentElement.dir = preferences.language === 'ar' ? 'rtl' : 'ltr';
  }, [preferences.language]);

  // Debounced API sync
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Capture the preferences value at scheduling time so the closure is stable.
    const preferencesSnapshot = preferences;

    timeoutRef.current = setTimeout(async () => {
      // Guard against completing after unmount (avoids state update on dead component).
      let cancelled = false;
      try {
        const token = await SecureStorage.get("auth_token");
        if (cancelled || !token) return; // Skip API sync if not authenticated

        const response = await apiClient('/api/user/preferences', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(preferencesSnapshot),
        });

        if (cancelled) return;
        if (!response.ok) {
          throw new Error('Failed to update preferences');
        }
      } catch (error) {
        // Only log, do not revert local UI state (theme/language are fine to stay local)
      }
      return () => { cancelled = true; };
    }, 500);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [preferences]);

  return { preferences, updatePreference, resolvedTheme };
}
