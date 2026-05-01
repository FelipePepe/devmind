import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api.js';

interface FeatureFlag {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);

  useEffect(() => {
    apiFetch<FeatureFlag[]>('/api/flags').then(setFlags).catch(() => null);

    const id = setInterval(() => {
      apiFetch<FeatureFlag[]>('/api/flags').then(setFlags).catch(() => null);
    }, REFRESH_INTERVAL);

    // MUST return cleanup to prevent interval accumulation on remount (W22)
    return () => clearInterval(id);
  }, []);

  const getFlag = (key: string): unknown => {
    const flag = flags.find((f) => f.key === key);
    if (!flag) return undefined;
    try {
      return JSON.parse(flag.value) as unknown;
    } catch {
      return flag.value;
    }
  };

  return { flags, getFlag };
}
