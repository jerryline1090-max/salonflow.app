import { resolveAuthSecrets } from "./authSecrets";

// Imported immediately after dotenv, before application/provider imports.
// A thrown, value-free configuration error stops startup before listen/jobs.
resolveAuthSecrets();
