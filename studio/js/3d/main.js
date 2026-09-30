// EYAD 3D — entry point (loaded only on /studio/3d/).
import { App3D } from './app.js';

const app = new App3D(document.body);
app.init();
// exposed for debugging in the console only; never used by the page itself
Object.defineProperty(window, '__eyad3d', { value: app, enumerable: false });
