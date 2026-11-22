// App-wide wiring. Kept out of importCore.ts so tests never pull in native modules.
import * as Crypto from 'expo-crypto';

import { BASE_URL } from './config';
import { deleteCopy } from './files/importFile';
import { asyncStorage } from './storage/asyncStorage';
import { createRnTransport } from './transport/rn';
import { ImportCore } from './core/importCore';

export const importCore = new ImportCore({
  storage: asyncStorage,
  transport: createRnTransport(BASE_URL),
  uuid: () => Crypto.randomUUID(),
  deleteCopy,
});
