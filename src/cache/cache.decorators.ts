import { SetMetadata } from '@nestjs/common';
import { CacheGroup } from './cache.service';

export const CACHED_GROUPS_KEY = 'cache:groups';
export const INVALIDATED_GROUPS_KEY = 'cache:invalidates';

/**
 * Caches the JSON response of a public GET handler. `groups` lists the data
 * the response is built from; it is dropped when any of them changes.
 */
export const CachedResponse = (...groups: CacheGroup[]) =>
  SetMetadata(CACHED_GROUPS_KEY, groups);

/** After the handler succeeds, drops every cached response of `groups`. */
export const InvalidatesCache = (...groups: CacheGroup[]) =>
  SetMetadata(INVALIDATED_GROUPS_KEY, groups);
