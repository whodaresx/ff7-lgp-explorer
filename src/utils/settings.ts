import { useState, useCallback } from 'react';

const STORAGE_KEY = 'ff7-lgp-explorer-settings';

export interface Settings {
  previewLayout: 'modal' | 'docked';
  previewMode: 'auto' | 'hex';
  hexColumns: 16 | 24 | 32;
  showAllPalettes: boolean;
  wireframe: boolean;
  vertexColors: boolean;
  smoothShading: boolean;
}

const DEFAULTS: Settings = {
  previewLayout: 'docked',
  previewMode: 'auto',
  hexColumns: 16,
  showAllPalettes: false,
  wireframe: false,
  vertexColors: true,
  smoothShading: true,
};

export function getSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULTS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Error getting settings:', e);
  }
  return { ...DEFAULTS };
}

export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  try {
    const current = getSettings();
    current[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

export function usePersistedState<K extends keyof Settings>(
  key: K,
  defaultValue?: Settings[K]
): [Settings[K], (value: Settings[K]) => void] {
  const initial = getSettings()[key] ?? defaultValue ?? DEFAULTS[key];
  const [value, setValue] = useState<Settings[K]>(initial);

  const setPersistedValue = useCallback((newValue: Settings[K]) => {
    setValue(newValue);
    saveSetting(key, newValue);
  }, [key]);

  return [value, setPersistedValue];
}
