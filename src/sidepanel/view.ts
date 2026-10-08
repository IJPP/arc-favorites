import type { AppSnapshot, FavoriteView } from '../core/types';

export function favoriteState(favorite: FavoriteView): string {
  if (!favorite.runtime) return '未打开';
  if (favorite.runtime.discarded) return '已休眠';
  if (favorite.runtime.loading) return '加载中';
  if (favorite.runtime.audible) return '正在播放';
  return favorite.active ? '当前打开' : '正在运行';
}

// Internal timestamps must never dismiss a menu or move keyboard focus.
export function snapshotKey(snapshot: AppSnapshot): string {
  return JSON.stringify(snapshot, (key, value) => key === 'updatedAt' ? undefined : value);
}
