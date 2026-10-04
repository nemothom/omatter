# Omatter: developer notes

These notes are for anyone (person or agent) changing this project. The user-facing docs
are in `README.md`.

Omatter controls Matter-over-Wi‑Fi lights, plugs and sensors from Linux. The PC joins the
devices as an extra Matter controller (**multi-admin**) next to Apple Home. It has three
parts:

```
bar widget (QML, Omarchy shell) ──stdin/stdout──► `omatter watch` ─┐
omatter CLI ───────────────────────────────────────────────────────┼─► $XDG_RUNTIME_DIR/omatter.sock ─► omatterd ─► devices
```

- **`omatterd`** (`src/daemon.ts`) is a long-running Node process and the only part that
  talks Matter, through matter.js. It owns the fabric, keeps subscriptions alive, and
  serves a newline-delimited JSON socket. It runs as the systemd user service `omatterd`.
- **`omatter`** (`src/cli.ts`) is a thin client for that socket. `omatter watch` streams state
  snapshots and also forwards JSON commands from its stdin. The widget uses it as its only
  connection, so moving a slider doesn't spawn a process per step.
- **Bar widget** (`plugin/nemothom.omatter/`) is an Omarchy shell (Quickshell) plugin.
  `install.sh` symlinks it into `~/.config/omarchy/plugins/`.

## Files

| Path | What it does |
|---|---|
| `src/matter.ts` | `LightManager`: controller setup, commissioning (`pair`), endpoint discovery (recursing into bridges), state → `Light`/`Sensor`, commands (`apply`), `details`, `reconnect`, `forget` |
| `src/daemon.ts` | Socket server, the command handlers table, snapshot/broadcast, scene application, theme file watcher |
| `src/cli.ts` | CLI argument parsing, printing, `watch` (reconnecting stream + stdin forwarding) |
| `src/ipc.ts` | NDJSON helpers and the one-shot `request()` |
| `src/config.ts` | `~/.config/omatter/config.json` load/save (atomic), paths, default scenes, `UiPrefs`, `ICON_STYLES` |
| `src/color.ts` | hex/name ↔ CIE xy, hue/sat, Kelvin/mireds, level ↔ percent |
| `src/targets.ts` | Resolves `"all"`, ids, names, rooms, prefixes and `a,b` lists to ids |
| `src/scenes.ts` | Expands a scene to per-light changes; snapshots current state into a scene |
| `src/theme.ts` | Built-in `theme` scene: reads the Omarchy palette and assigns it to lights |
| `src/order.ts` | Room/device ordering from `ui.roomOrder` / `ui.deviceOrder` |
| `src/startup.ts` | Startup guards: removes stale matter.js storage locks, waits for a real network interface |
| `plugin/.../Panel.qml` | Bar button and popup: state, `send()`, grouping, every section (hero, icon picker, pairing form, scenes, arrange mode, rooms) |
| `plugin/.../LightRow.qml` | One light/plug row: switch, slider, swatch, picker, details |
| `plugin/.../SensorRow.qml`, `ColorPicker.qml`, `DetailsBlock.qml`, `InfoButton.qml`, `ArrangeRow.qml`, `MatterIcon.qml` | The smaller pieces |
| `dev/mock-daemon.mjs` | Fake daemon with fixed data for widget work |
| `test/*.test.ts` | `node --test` unit tests for the pure modules |

## Socket protocol

- Request: `{"id": n, "cmd": "...", "args": {...}}`
- Response: `{"id": n, "ok": true, "result": ...}` or `{"id": n, "ok": false, "error": "..."}`
- `subscribe` registers the connection for pushes: `{"event": "state", ...}`. A snapshot is
  sent right away and again after every change. Changes are debounced by 80 ms in
  `LightManager.#changed`.
- `omatter watch` relabels replies for the widget: `{"event": "result", "cmd", "result"}` and
  `{"event": "error", "cmd", "error"}`. It also emits `{"event": "daemon", "up": bool}`.

**Commands** (the `handlers` table in `daemon.ts`):
`status`, `set` (`target`, `on`, `toggle`, `brightness`, `brightnessDelta`, `color`, `kelvin`),
`scene.apply`, `scene.save`, `scene.rm`, `scene.rename`, `scene.list`, `colors.favorite`,
`details`, `reconnect`, `order.set`, `ui.set` (`collapsedRooms`, `icon`), `pair`, `rename`,
`room`, `forget`.

**Snapshot fields:** `lights`, `sensors` (each sorted by the user's order), `rooms` (room
keys in order, `""` = no room), `order` (light and sensor ids interleaved in display order),
`scenes`, `builtinScenes`, `activeScene`, `ui`.

Device ids are `"<nodeId>:<endpoint>"`. Config entries (`lights`, `ui.deviceOrder`) are keyed
by those ids, and the same `lights` map also holds sensor names and rooms.

## Behaviour that's easy to break

- **`"all"` means lights only** (`kind === "light"`; sensors have no `kind`, so device-level
  commands like `forget all` include them). Plugs and switches can power things that
  must stay on, so they are only reached by name or room. Scenes with `"*"`, All on/off,
  middle-click and scroll-to-dim all rely on this.
- **No redundant commands.** `apply()` skips `On` when the light is already on, and the colour
  strip sends only on mouse release. Bulbs restart their fade on every command, so extra ones
  made colour picks stutter.
- **Colour commands use `executeIfOff`**, so a colour can be set before turning the light on.
  The transition is 0.4 s (`TRANSITION`).
- **`activeScene`** is set by `scene.apply` and cleared by any `set`. The theme watcher only
  re-applies while `activeScene === "theme"`.
- **Group toggle:** if any target is on, all go off; otherwise all go on. Toggling never
  flips each light individually.
- **Pairing** accepts 11/21-digit manual codes and `MT:` QR payloads, and does on-network
  discovery only (no BLE). Only one pairing runs at a time. Errors are rewritten into plain
  language in `explainPairingError`.
- **`forget`** decommissions only this PC's fabric. Apple Home keeps the device.
- **Startup after an unclean shutdown:** matter.js keeps `matter.lock` + `matter.pid` in
  `~/.local/share/omatter/omatter/` and only checks that the PID is alive. After a power cut
  the PID is often reused by another program, which blocks startup for good. Before starting
  matter.js, `clearStaleLocks()` removes the lock unless its PID is a running omatterd. This
  is only safe because `clearStaleSocket()` runs first and exits if another omatterd is
  serving.
- **Startup before Wi‑Fi:** user units can't wait for `network-online.target`, so
  `waitForNetwork()` polls for up to 60 s. Virtual interfaces (Docker, VPNs) don't count.
  Without it, mDNS fails with `addMembership ENODEV`.
- **Config is re-read on every access**, so hand edits apply immediately. Always write it
  through `updateConfig`.

## Conventions and gotchas

- **TypeScript runs directly** through Node's type stripping (Node 26), with no build step.
  Use only erasable syntax (`tsconfig` enforces `erasableSyntaxOnly`): no `enum`, no
  `namespace`, no constructor parameter properties. Imports must use the `.ts` extension.
- **Check before finishing:** `npm run check` (tsc + tests). There are no tests for
  `matter.ts` or the QML. Use the mock daemon and real devices for those.
- **matter.js 0.17.9** is pinned. The legacy controller API is `CommissioningController` /
  `PairedNode`. State is read with `endpoint.maybeStateOf(XClient)`, commands are sent with
  `endpoint.commandsOf(XClient)`, and clients come from `@matter/main/behaviors/<cluster>`.
  The warning "Using test vendor ID 0xfff1" at startup is expected.
- **`install.sh` bakes absolute paths** to `node` (resolved through mise) and to the repo
  into `~/.local/bin` and the systemd unit. Re-run it after a Node upgrade or a move.
- **Socket paths** must stay under about 108 characters (a Unix limit). Use a short
  `OMATTER_SOCKET` when testing.
- Overrides for testing: `OMATTER_SOCKET`, `OMATTER_CONFIG`, `OMATTER_DATA`,
  `OMATTER_LOG_LEVEL`.

### QML / Omarchy shell

- **Edits don't hot-reload** through the plugin symlink. Run `omarchy restart shell`. Bump
  `manifest.json` `version` when shipping a change.
- **Reading the shell log:** the plain `quickshell log` command can show a stale instance. Use
  `quickshell list --all` to find the current id, then
  `quickshell log -i <id> | grep nemothom.omatter/`.
- Import `QtQuick.Controls` as `QQC`. Its `Button` would otherwise shadow the Omarchy
  `qs.Ui` `Button`.
- `signal` is reserved in QML, so a function can't be named `signal(...)`.
- **Icons** are Nerd Font Material Design glyphs, written as
  `String.fromCodePoint(0xF....)`. Look up codes in the Nerd Fonts `glyphnames.json`.
  There's no Matter glyph, which is why `MatterIcon.qml` draws it with `Shape`/`PathSvg`.
- **Screenshot workflow:** temporarily set a default (e.g. `property bool arrangeMode: true`)
  and run `omarchy restart shell`. Then run `omarchy-shell nemothom.omatter open`, take a
  screenshot with `grim`, crop it with `magick … -crop 600x900+1960+40` (the panel is at the
  top right of a 2560×1440 screen), and revert the default.
- For widget work without devices, stop `omatterd`, run `node dev/mock-daemon.mjs`, then
  restart the shell.

## Where to look when…

- **A device type isn't recognised:** see `deviceKind()` / `PLUG_TYPES` / `SWITCH_TYPES`
  and `SENSOR_CLIENTS` in `matter.ts`.
- **A new widget action is needed:** add a handler in `daemon.ts`, call it with
  `root.send(cmd, args)` in QML, and handle `event: "result"` / `"error"` with that `cmd` in
  `handleLine` if the reply matters.
- **A new user preference is needed:** add it to `UiPrefs` (`config.ts`), accept it in
  `ui.set`, and read it from `msg.ui` in `Panel.qml`.

## Ideas not done yet

From the brainstorm, not built:
- instant (optimistic) UI updates
- bar icon tinted with the lights' colour
- OSD when scrolling
- live colour preview while dragging
- room brightness slider
- keyboard navigation in the panel
- Hyprland keybindings
- schedules / sunrise
- following lock, idle and suspend
- slow scene fades
- effects (candle, colour loop, notification flash)
- groups that span rooms
- rename/move devices from the widget
- backup/restore of `~/.local/share/omatter`
