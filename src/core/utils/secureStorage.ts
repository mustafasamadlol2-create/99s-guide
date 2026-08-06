import { Preferences } from '@capacitor/preferences';

export const SecureStorage = {
  async set(key: string, value: string) {
    await Preferences.set({ key, value });
  },
  async get(key: string) {
    let val = localStorage.getItem(key);
    if (val) {
      await this.set(key, val);
      localStorage.removeItem(key);
    } else {
      const { value } = await Preferences.get({ key });
      val = value;
    }
    return val;
  },
  async remove(key: string) {
    await Preferences.remove({ key });
    localStorage.removeItem(key);
  }
};
