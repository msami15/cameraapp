/**
 * @format
 */

import {Buffer} from 'buffer';
// React Native's JS runtime has no Node-style globals; react-native-tcp-socket
// and our own protocol code (GPSocketProtocol.ts, MjpegStream.ts) work with
// raw Buffers, so polyfill the global here before anything else loads.
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
