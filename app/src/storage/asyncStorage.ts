import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Storage } from '../core/ports';
import type { ImportOp } from '../core/types';

const KEY = 'subscope.importOp.v1';

export const asyncStorage: Storage = {
  async load() {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ImportOp) : null;
  },
  save: (op) => (op ? AsyncStorage.setItem(KEY, JSON.stringify(op)) : AsyncStorage.removeItem(KEY)),
};
