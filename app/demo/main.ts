/*
 * Entry point of the online demo build (`npm run build:demo`). The Pi build
 * starts at src/app/main.tsx and never sees this folder.
 *
 * Order matters: the in-browser API must be in place before the app makes its
 * first request, so it is imported first.
 */
import './installDemoApi.ts';
import './banner.ts';
import '../src/app/main.tsx';
