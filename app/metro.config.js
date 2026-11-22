// https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Generated native dirs (CNG) hold ~1.5 GB of Gradle/CMake output; crawling them made exports take 10+ min.
const escape = (p) => p.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
config.resolver.blockList = ['android', 'ios'].map((d) => new RegExp(`^${escape(path.join(__dirname, d))}[\\\\/].*`));

module.exports = config;
