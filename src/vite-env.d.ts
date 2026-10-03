/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPACETIMEDB_HOST?: string;
  readonly VITE_SPACETIMEDB_DB_NAME?: string;
  /** Public base URL for the QR code when the display runs on localhost. */
  readonly VITE_PUBLIC_URL?: string;
}
