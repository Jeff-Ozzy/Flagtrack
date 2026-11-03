import type { CapacitorConfig } from '@capacitor/cli';

/** Android app: packages the offline build (data on the device, no server, no account). */
const config: CapacitorConfig = {
  appId: 'com.flagtrack.app',
  appName: 'FlagTrack',
  webDir: 'dist-offline',
  backgroundColor: '#0B0D10',
  android: {
    backgroundColor: '#0B0D10',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_flagtrack',
      iconColor: '#2ED565',
    },
  },
};

export default config;
