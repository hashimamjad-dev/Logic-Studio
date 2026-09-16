/**
 * Entry point.
 *
 * Everything here runs locally. There is no network call anywhere in the application
 * once the bundle has loaded, which is what makes packaging it as an offline desktop
 * app later a matter of wrapping the same build.
 */

import { Workbench } from './app/Workbench';

const host = document.getElementById('app');
if (!host) throw new Error('ProtoLab could not find its mount point.');

const workbench = new Workbench(host);

// Open on the worked 7400 experiment so the first thing anyone sees is a real
// circuit rather than an empty grid. File > New offers a blank board.
workbench.loadExample('nand-7400');

// Handy for debugging in the console, and for driving the app from a smoke test.
declare global {
  interface Window {
    protolab?: Workbench;
  }
}
window.protolab = workbench;
