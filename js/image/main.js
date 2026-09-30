// EYAD IMAGE — entry point (loaded only on /studio/image/).
import { ImageApp } from './app.js';

const app = new ImageApp(document.body);
app.init();
// exposed for debugging in the console only; never used by the page itself
Object.defineProperty(window, '__eyadImage', { value: app, enumerable: false });
