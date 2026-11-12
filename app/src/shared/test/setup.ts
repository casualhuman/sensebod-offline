/* Loaded before every test file (see vitest.config.ts). */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetSessionForTests } from '../session';

afterEach(() => {
  cleanup();
  resetSessionForTests();
  window.history.replaceState(null, '', '/');
});

// jsdom has no scrollTo; the router calls it after navigation.
window.scrollTo = () => {};
