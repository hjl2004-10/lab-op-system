import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from "react";

/**
 * Read a nested property from a single localStorage key.
 * Uses a module-level cache to ensure batch writes are consistent.
 */
const cache: Record<string, Record<string, unknown>> = {};

export function useLocalStorage<T>(
  storageKey: string,
  initialValue: T,
  propertyKey: string
): [T, Dispatch<SetStateAction<T>>] {
  const readValue = useCallback((): T => {
    try {
      // Check cache first (ensures consistency across batch writes)
      if (cache[storageKey]?.[propertyKey] !== undefined) {
        return cache[storageKey][propertyKey] as T;
      }
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed[propertyKey] !== undefined) {
          // Sync to cache
          if (!cache[storageKey]) cache[storageKey] = {};
          cache[storageKey][propertyKey] = parsed[propertyKey];
          return parsed[propertyKey] as T;
        }
      }
    } catch {
      // ignore
    }
    return initialValue;
  }, [storageKey, propertyKey, initialValue]);

  const [value, setValue] = useState<T>(readValue);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const setStoredValue = useCallback<Dispatch<SetStateAction<T>>>(
    (newValueOrFn: SetStateAction<T>) => {
      setValue((prev) => {
        const nextValue =
          typeof newValueOrFn === "function"
            ? (newValueOrFn as (prev: T) => T)(prev)
            : newValueOrFn;

        try {
          // Read from cache first (ensures batch consistency)
          if (!cache[storageKey]) {
            const stored = localStorage.getItem(storageKey);
            cache[storageKey] = stored ? JSON.parse(stored) : {};
          }
          cache[storageKey][propertyKey] = nextValue;
          localStorage.setItem(storageKey, JSON.stringify(cache[storageKey]));
        } catch {
          // ignore storage errors
        }

        return nextValue;
      });
    },
    [storageKey, propertyKey]
  );

  return [value, setStoredValue];
}
