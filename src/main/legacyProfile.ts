import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Preserve the previous desktop library and settings when an existing user upgrades.
const previousProfile = join(app.getPath('appData'), '唱诗歌');
if (
  app.isPackaged &&
  !app.commandLine.hasSwitch('user-data-dir') &&
  existsSync(previousProfile) &&
  !existsSync(join(app.getPath('userData'), 'Preferences'))
) {
  app.setPath('userData', previousProfile);
}
