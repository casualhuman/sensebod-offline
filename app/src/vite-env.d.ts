/// <reference types="vite/client" />

/** Hash of the repository's illustrations/ folder, set by build/illustrationsPlugin.ts. */
declare const __ILLUSTRATIONS_VERSION__: string;

interface ImportMetaEnv {
  /** Base path of the API. Default "/api/v1" (same origin). Set only if the Pi serves the API elsewhere. */
  readonly VITE_API_BASE?: string;
}
