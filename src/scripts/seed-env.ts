// Imported first by the seed script: config is validated when AppModule is imported.
// The seed is a one-off process, so no background loops and quiet logs.
process.env.OUTBOX_RELAY_ENABLED = 'false';
process.env.EVENTS_LOGGER_ENABLED = 'false';
process.env.FX_REFRESH_INTERVAL_MS = '0';
process.env.LOG_LEVEL ??= 'warn';
