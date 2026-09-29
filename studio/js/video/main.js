// EYAD VIDEO — entry point (loaded only on /studio/video/).
import { VideoApp } from './app.js';

const app = new VideoApp(document.body);
app.init();
Object.defineProperty(window, '__eyadVideo', { value: app, enumerable: false });
