# @hifi/bot

Discord gateway process. Long-lived, thin, and deliberately boring.

## Owns
- The mention handler: confirm the channel is bound, the tenant is active and under quota, create the thread, post the status message, download attachments to R2, enqueue. Landing in M2.
- Editing the job status message in place rather than posting a new message per transition.

## Must never
- Do slow work in the gateway handler. Everything real happens in the worker.
- Persist a Discord CDN attachment URL. Those links are signed and expire, which is why attachments are downloaded inside the handler.
- Advance a job status. Only the worker does that.
- Run more than one machine without gateway sharding.
