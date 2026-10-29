// Imported first by scripts that load AppModule without connecting to anything:
// config validation runs when AppModule is imported, so these must be set beforehand.
process.env.DATABASE_URL ??= 'postgres://preview:preview@localhost:5432/preview';
process.env.OUTBOX_RELAY_ENABLED = 'false';
process.env.EVENTS_LOGGER_ENABLED = 'false';
