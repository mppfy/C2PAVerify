// VENDOR: copied from mppfy/platform — extract to @mppfy/platform-core after M6.
// See src/_vendor/VENDOR.md for sync policy. Do not modify in-place.

import type { ServiceDefinition } from './types';

/**
 * Типизированная фабрика для определения MPP-сервиса.
 * 
 * В будущих версиях сюда можно добавить:
 * - Валидацию ID (snake-case, unique)
 * - Автоматическую генерацию schema из Zod
 * - Rate limiting per agent
 * - Автоматический кеш поверх KV
 * 
 * Пока просто возвращает определение как есть.
 */
export function defineService(def: ServiceDefinition): ServiceDefinition {
  // Базовая валидация
  if (!/^[a-z0-9][a-z0-9-]*$/.test(def.id)) {
    throw new Error(
      `Invalid service id "${def.id}": must be lowercase alphanumeric with hyphens`
    );
  }
  
  if (parseFloat(def.price.amount) < 0) {
    throw new Error(`Service "${def.id}" has negative price`);
  }
  
  return def;
}
