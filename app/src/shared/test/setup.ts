/* Loaded before every test file (see vitest.config.ts). */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { features } from '../switches';
import { resetSessionForTests } from '../session';

// Listen and the language switch are off in the app for now; the tests keep them on.
features.listen = true;
features.languageSwitch = true;
features.games = true;

afterEach(() => {
  cleanup();
  resetSessionForTests();
  window.history.replaceState(null, '', '/');
});

// jsdom has no scrollTo; the router calls it after navigation.
window.scrollTo = () => {};
