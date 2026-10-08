import { describe, it, expect } from 'vitest';
import { favoriteState, snapshotKey } from '../src/popup/view';
import type { FavoriteView } from '../src/core/types';

const favorite: FavoriteView = {
  id: 'mail', title: 'Mail', homeUrl: 'https://mail.test/', siteKey: 'mail.test',
  order: 0, createdAt: 0, guardEnabled: true, active: false,
  runtime: { favoriteId: 'mail', tabId: 1, windowId: 1, currentUrl: 'https://mail.test/', currentTitle: 'Mail', updatedAt: 1 },
};
describe('popup live state', () => {
  it('distinguishes a closed instance, memory saver, loading, and background audio', () => {
    expect(favoriteState({ ...favorite, runtime: undefined })).toBe('未打开');
    expect(favoriteState({ ...favorite, runtime: { ...favorite.runtime!, discarded: true, loading: true } })).toBe('已休眠');
    expect(favoriteState({ ...favorite, runtime: { ...favorite.runtime!, loading: true } })).toBe('加载中');
    expect(favoriteState({ ...favorite, runtime: { ...favorite.runtime!, audible: true } })).toBe('正在播放');
  });
  it('ignores runtime timestamps but refreshes when a tab goes to sleep', () => {
    const key = (item: FavoriteView) => snapshotKey({ favorites: [item], maxFavorites: 12 });
    expect(key(favorite)).toBe(key({ ...favorite, runtime: { ...favorite.runtime!, updatedAt: 999 } }));
    expect(key(favorite)).not.toBe(key({ ...favorite, runtime: { ...favorite.runtime!, discarded: true } }));
  });
});
