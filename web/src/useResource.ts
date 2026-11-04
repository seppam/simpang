import { shallowRef, ref, type Ref, type ShallowRef } from 'vue';
import { ApiError } from './api';

export type Resource<T> = {
  data: Readonly<ShallowRef<T | null>>;
  error: Readonly<Ref<string | null>>;
  loading: Readonly<Ref<boolean>>;
  load: () => Promise<void>;
};

// Loads one API resource with explicit loading and error state. A newer load wins over an
// older one still in flight, so a quick period change cannot show stale numbers.
export function useResource<T>(fetcher: () => Promise<T>): Resource<T> {
  const data = shallowRef<T | null>(null);
  const error = ref<string | null>(null);
  // Starts as loading, so a page never flashes its empty state before the first request.
  const loading = ref(true);
  let latest = 0;

  async function load(): Promise<void> {
    const attempt = ++latest;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetcher();
      if (attempt === latest) data.value = result;
    } catch (cause) {
      if (attempt === latest) error.value = describeError(cause);
    } finally {
      if (attempt === latest) loading.value = false;
    }
  }

  return { data, error, loading, load };
}

export function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return 'Unexpected error. Reload the page and try again.';
}
