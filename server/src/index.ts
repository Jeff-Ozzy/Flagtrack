import { createApp } from './app';
import { config } from './config';
import { startScheduler } from './push';

const app = createApp();
app.listen(config.port, () => {
  console.log(`FlagTrack API ouvindo em http://localhost:${config.port}`);
  startScheduler();
});
