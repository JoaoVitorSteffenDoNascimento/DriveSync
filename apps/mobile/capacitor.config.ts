import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.drivesync.mobile',
  appName: 'DriveSync',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
