# Omatter

Control Matter lights, plugs and sensors from the Omarchy bar and the terminal: on/off,
brightness, colour, white temperature and scenes.

Your computer joins your lights as an **extra controller** (Matter multi-admin). They stay
in your current controller (like Apple Home), and changes made in either place show up in both.

```
bar widget ──stdin/stdout──► omatter watch ─┐
omatter CLI ────────────────────────────────┼─ $XDG_RUNTIME_DIR/omatter.sock ─► omatterd (matter.js) ─► lights
```

*Warning: Omatter was mostly created with Claude. I needed this tool, so I prototyped it, then thought others might be looking for something similar. Be advised that it may not work with your setup, or may introduce unwanted vulnerabilities. No warranty.*

## Requirements

- Omarchy (for the bar widget). The CLI and daemon work on any Linux.
- Node 22.18 or later, since it runs the TypeScript sources directly. Developed on Node 26.
- Matter-over-Wi‑Fi devices on the same network as this PC. Thread devices would need a
  Thread border router; this hasn't been tested.

## Install

```bash
./install.sh
```

The script installs npm dependencies, writes `omatter` and `omatterd` to `~/.local/bin`,
enables the `omatterd` systemd user service, and links the `nemothom.omatter` bar widget
into `~/.config/omarchy/plugins/`.

Re-run `./install.sh` after moving the project folder or upgrading Node (e.g. through
mise). The wrappers and the service contain absolute paths to both.

## Pair a device

1. In your current controller's app (e.g. Apple Home), open the device, then go to **Settings › Turn On Pairing Mode**,
   and copy the setup code.
2. In the bar panel, click **+** and enter the code, plus a name and room if you like. Or
   from a terminal:
   ```bash
   omatter pair 1234-567-8901 --name "Desk lamp" --room Office
   ```

Pairing mode in Apple Home expires after a few minutes. Pairing itself can take up to two
minutes.

## CLI

`target` can be a device name (or a unique prefix of one), a room, an id like `1:1`, a
comma-separated list, or `all`. `all` covers lights only.

```bash
omatter list                         # every device and sensor, in your order
omatter toggle office                # target = light name, room, id, "a,b" or all
omatter on | off [target]
omatter brightness desk 40           # or +10 / -10
omatter color "LED strip" purple     # or #ff8800
omatter temp all warm                # or 2700
omatter scene relax
omatter scene theme                  # colours from the current Omarchy theme
omatter scene save evening           # snapshot current state
omatter scene rename evening cosy
omatter scene rm cosy
omatter rename 1234:1 "Desk lamp"
omatter room "Desk lamp" Office
omatter forget "Desk lamp"           # remove this PC as a controller; Apple Home keeps it
omatter order rooms Kitchen,Bedroom   # room order (order reset to go back to A→Z)
omatter details "Desk lamp"          # firmware, address, Wi-Fi signal, battery, last seen
omatter reconnect "Desk lamp"        # force a reconnect to a flaky device
```

## Bar widget

- **Click:** opens the panel with scenes, rooms, an on/off switch per light, a brightness
  slider, and a colour swatch. Click the swatch to open the hue, white-temperature and
  preset pickers.
- **Rooms:** click a room header to collapse or expand it. The setting is saved, so rooms
  stay collapsed after a restart. "turn on/off" switches the whole room. The light list
  scrolls once it gets long.
- **Scenes:** click **edit** next to SCENES to update a scene from the current light state,
  or to rename or delete it (Delete asks you to confirm). The field at the bottom saves the
  current state as a new scene.
- **Colours:** the picker has presets, **favourites** (+ saves the light's current colour,
  right-click removes one) and your **recent** colours.
- **Details:** the faint ⓘ next to each device opens its status, last-seen time, Wi-Fi
  signal, battery, firmware, address and a Reconnect button.
- **Plugs, switches and sensors:** plugs and wall switches show with their own icon.
  Temperature, humidity, motion, light-level and contact sensors show their readings in
  their room.
- **Arrange (⇅):** reorder rooms with the arrows on their headers, and devices (lights,
  plugs and sensors, in any mix) within their room. The order is saved and `omatter list`
  follows it too.
- **Icon:** click the icon at the top left of the panel to pick the bar icon: house
  (outline or filled), lightbulb, plug, or the Matter logo.
- **Middle-click:** toggles all lights.
- **Scroll:** dims or brightens the lights that are on.

## Scenes and config

The built-in **Theme** scene colours your lights from the active Omarchy theme. Colour
bulbs cycle through the theme's accent and palette colours, made more saturated so they
show well on a bulb. White-only bulbs get a warm or neutral white. While Theme is the
active scene, switching Omarchy themes re-colours the lights. Any manual change to a light
ends that. You can override it by saving your own scene called `theme`.

`all` (and the All on/off button) only covers lights. Plugs and switches might power
things that must stay on, so target them by name or room.

Scenes live in `~/.config/omatter/config.json`, alongside light names and rooms. The file
is re-read on every use, so your edits apply right away. Each scene key can be `*`
(all lights), a room, a light name or a light id. Later keys override earlier ones:

```json
"scenes": {
  "evening": {
    "*": { "on": true, "brightness": 40, "kelvin": 2700 },
    "LED strip": { "color": "#ff4fa0" },
    "Ceiling": { "on": false }
  }
}
```

## Where things live

| What | Where |
|---|---|
| Names, rooms, scenes, widget preferences | `~/.config/omatter/config.json` |
| Matter controller identity (fabric, certificates, paired devices) | `~/.local/share/omatter/`. Back this up; losing it means re-pairing everything. |
| Service | `~/.config/systemd/user/omatterd.service` |
| CLI wrappers | `~/.local/bin/omatter`, `~/.local/bin/omatterd` |
| Bar widget | `~/.config/omarchy/plugins/nemothom.omatter` (symlink to `plugin/`) |

## Troubleshooting

- **The bar shows a crossed-out icon / "omatterd not running":**
  run `systemctl --user status omatterd` and `journalctl --user -u omatterd -f`.
- **A device is unreachable:** click its ⓘ to see when it was last seen, then
  **Reconnect** (or `omatter reconnect <name>`). Check that it still works in Apple Home.
- **Pairing can't find the device:** turn pairing mode on again in Apple Home, and make sure
  this PC is on the same Wi‑Fi. Your firewall must allow UDP 5353 (mDNS) and UDP 5540
  (Matter).
- **Widget changes don't show up:** `omarchy restart shell`.

## Uninstall

```bash
omatter forget all                         # optional: removes this PC from each light (Apple Home keeps them)
systemctl --user disable --now omatterd
rm ~/.config/systemd/user/omatterd.service ~/.local/bin/omatter ~/.local/bin/omatterd
omarchy plugin disable nemothom.omatter && rm ~/.config/omarchy/plugins/nemothom.omatter
rm -r ~/.config/omatter ~/.local/share/omatter
```

`forget all` skips plugs and switches. Forget those by name first.

## Development

See [`CLAUDE.md`](CLAUDE.md) for the architecture, socket protocol, gotchas and workflow.
Quick reference:

```bash
npm run check                         # type-check + unit tests
systemctl --user restart omatterd     # after changing src/
omarchy restart shell                 # after changing plugin/ (no hot reload via the symlink)
node dev/mock-daemon.mjs              # fake devices for widget work (stop omatterd first)
```
