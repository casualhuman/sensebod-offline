# Sensebod Offline backend

The backend of Sensebod Offline: one Node.js + Express process, one worker process and a maintenance timer, on a Raspberry Pi with no internet. It implements `docs/system/openapi.yaml` and follows `docs/system/SYSTEM-ARCHITECTURE.md`. What is built, what is not, and what was only checked on a laptop is in [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md).

## Run it on a laptop

Needs Node.js 23.6 or newer (the code is TypeScript that Node runs directly; a bag gets the compiled build with a pinned Node 24 LTS).

```sh
cd backend
npm ci
npm run dev:init                      # creates dev/data: databases, keys, the portals and the sample lessons
printf 'a-long-password' | SENSEBOD_OFFLINE_DEV=1 node bin/sensebod-offline-admin.ts create-hub-manager \
  --config dev/sensebod-offline.dev.toml --username admin --display-name "Me" --password-stdin
npm run dev                           # API on http://127.0.0.1:8000/api/v1
npm run dev:worker                    # background jobs (uploads, exports), in a second terminal
npm run dev:maint                     # one maintenance run (snapshots, retention, expiry)
npm test                              # 91 tests, real SQLite files and real child processes
npm run typecheck
```

The `[dev]` table in `dev/sensebod-offline.dev.toml` makes the API serve `/media/` and the built frontend itself and pretends the root helpers ran. It is refused unless `SENSEBOD_OFFLINE_DEV=1`; a bag's configuration has no `[dev]` table.

## Processes

| Program | What | On a bag |
|---|---|---|
| `bin/sensebod-offline-boot-recover` | Once per boot, before everything else: checks both databases, goes back to a saved copy if one is damaged, ends sessions, settles interrupted jobs, exports and uploads | `sensebod-offline-boot-recover.service` (oneshot) |
| `bin/sensebod-offline-api` | The HTTP API on `127.0.0.1:8000`, behind nginx | `sensebod-offline-api.service` |
| `bin/sensebod-offline-worker` | Background jobs in three lanes (media, data, usb), each job in its own child process | `sensebod-offline-worker.service` |
| `bin/sensebod-offline-maint` | One run of retention, snapshots, expiry, garbage collection, health sample | `sensebod-offline-maint.timer` (1 min after boot, then every 15 min) |
| `bin/sensebod-offline-admin` | Technician commands: `init`, `create-hub-manager`, `reset-password`, `restore`, `new-epoch`, `migrate`, `status`, `selfcheck` | by hand, over SSH |
| `bin/sensebod-offline-selfcheck` | Release self-check (R-11) | run by the updater and at P-1 |

## Layout

```
migrations/main, migrations/counts   numbered SQL, exactly the DDL of docs/system/DATABASE.md §6
src/config.ts                        sensebod-offline.toml, refuses unknown keys
src/core/        db, write gate, migrations, ids, errors, HTTP rules, idempotency, log filter, replace_live_database
src/identity/    passwords, sessions, sign-in, accounts, override code
src/catalog/     content tree, lessons, placement, questions, Try it, content packs
src/learners/    learners, progress, anonymous Child protection counts, retention rules
src/media/       uploads, file types, media store, conversions, zip reader
src/exports/     export routes, tickets, zip/tar/CSV writers, export jobs, USB, snapshots
src/system/      boot recovery, maintenance, status, clock, power-off, restore, self-check
src/worker/      supervisor, job runner, queue
seed/content.json                    portals, groups and sample lessons (from the frontend mock)
test/                                node:test; nothing is mocked
```

## Rules the code keeps

- **One writer.** Every write is one short `BEGIN IMMEDIATE` transaction with no `await`, file or network work inside. API writes go through `ctx.write()`, the single-flight write gate; a lock held by another process never blocks the event loop, and after 5 s the request answers `503 busy`.
- **Files first, row second.** A file is fsynced, renamed into place and its directory fsynced before the transaction that makes it visible.
- **Uploads are streamed.** No body parser runs on upload routes; a chunk is fsynced before its bytes are counted.
- **Child protection is never linked to a learner.** Counts live in a separate database file with no sequence number and no time of day.
- **Logs hold route templates only**, and a filter redacts learner ids and Child protection lesson ids from every line.
- **No native modules.** SQLite is `node:sqlite`, hashing and encryption are `node:crypto`, compression is `node:zlib`. The only dependencies are `express` and `smol-toml`.
- **Nothing needs the internet**, at start or later.
