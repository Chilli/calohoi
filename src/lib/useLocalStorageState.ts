import { useEffect, useState } from 'react'

type Options<T> = {
  key: string
  defaultValue: T
  validate?: (value: unknown) => value is T
}

export function useLocalStorageState<T>({ key, defaultValue, validate }: Options<T>) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return defaultValue
      const parsed: unknown = JSON.parse(raw)
      if (validate && !validate(parsed)) return defaultValue
      return parsed as T
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // ignore write failures (private mode / quota)
    }
  }, [key, state])

  return [state, setState] as const
}
