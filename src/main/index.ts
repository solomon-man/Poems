import './legacyProfile';
import { app } from 'electron';

// A second launch only needs to notify the running player.
if (app.requestSingleInstanceLock()) {
  require('./runtime.js');
} else {
  app.quit();
}
