# Channel Plugin Template (Future Capability)

This template is for the upcoming plugin capability when Jihn adds first-class `channel` plugins.

## Planned plugin manifest extension

```json
{
  "id": "telegram-channel",
  "name": "Telegram Channel",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.mjs",
  "enabled": true,
  "priority": 10,
  "capabilities": ["channel"]
}
```

## Planned lifecycle surface

- `onStart(context)`
- `onStop(context)`
- `onHealthCheck(context)`
- `onMessage(context)`

## Security expectations

- explicit outbound host allowlist
- per-plugin rate limits and message budgets
- capability-based tool exposure
- default fail-closed in production policy mode

Until this capability ships, implement channels as dedicated adapters under `apps/`.
