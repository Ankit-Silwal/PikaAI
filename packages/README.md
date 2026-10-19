# Shared packages

`queues` exports the BullMQ queue name and document job payload type used by
`apps/api` and `apps/worker`. It contains no application configuration or database
connections. Each app has its own entry point and runtime dependencies.
