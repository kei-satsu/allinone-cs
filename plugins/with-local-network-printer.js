const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLocalNetworkPrinter(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('Android manifest is missing the application element.');
    }

    application.$ = {
      ...application.$,
      'android:usesCleartextTraffic': 'true',
    };
    return modConfig;
  });
};
