import { defaultSettings, upgradeSettings, validateSettings } from './model';
import type { Settings } from './types';

export class SettingsStore {
  private readonly key: string;
  private lastValue: string | null = null;
  private loaded = false;
  constructor(account: string, private storage: Storage = window.localStorage) {
    // Keep the original account key so v1 settings migrate without losing data or conflict checks.
    this.key = `send-modes.v1.${encodeURIComponent(account.trim().toLowerCase())}`;
  }
  load(): Settings {
    const value = this.storage.getItem(this.key);
    // Never silently replace corrupt saved data with defaults.
    const result = value === null ? defaultSettings() : upgradeSettings(validateSettings(JSON.parse(value)));
    this.lastValue = value; this.loaded = true;
    return result;
  }
  save(settings: Settings): void {
    if (!this.loaded) throw new Error('設定尚未成功讀取，請先重新開啟工作窗格。');
    if (this.storage.getItem(this.key) !== this.lastValue) throw new Error('另一個工作窗格已更新模式。請先備份目前編輯內容，再重新開啟以載入最新設定。');
    const value = JSON.stringify(validateSettings(settings));
    if (value.length > 1_000_000) throw new Error('模式設定超過 1 MB，請減少內文或模式數量。');
    this.storage.setItem(this.key,value);
    this.lastValue = value;
  }
}
