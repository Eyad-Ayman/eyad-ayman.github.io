// EYAD VECTOR — entry point (loaded only on /studio/vector/).
import { VectorApp } from './app.js';

const app = new VectorApp(document.body);
app.init();
// exposed for debugging in the console only; never used by the page itself
Object.defineProperty(window, '__eyadVector', { value: app, enumerable: false });
