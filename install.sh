#!/usr/bin/env bash
# Installs omatter: CLI wrappers in ~/.local/bin, the omatterd user service,
# and the Omarchy bar widget plugin.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
NODE="$(readlink -f "$NODE")"
BIN="$HOME/.local/bin"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
PLUGIN_ID="nemothom.omatter"
PLUGIN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/$PLUGIN_ID"

echo "› Installing npm dependencies"
(cd "$ROOT" && npm install --no-fund --no-audit --silent)

echo "› Writing CLI wrappers to $BIN"
mkdir -p "$BIN"
for name in omatter omatterd; do
  script=$([ "$name" = omatter ] && echo cli.ts || echo daemon.ts)
  printf '#!/usr/bin/env bash\nexec "%s" --no-warnings "%s/src/%s" "$@"\n' "$NODE" "$ROOT" "$script" > "$BIN/$name"
  chmod +x "$BIN/$name"
done

echo "› Installing systemd user service"
mkdir -p "$UNIT_DIR"
sed -e "s|@NODE@|$NODE|" -e "s|@ROOT@|$ROOT|" "$ROOT/systemd/omatterd.service.in" > "$UNIT_DIR/omatterd.service"
systemctl --user daemon-reload
systemctl --user enable --now omatterd.service

echo "› Linking bar widget into $PLUGIN_DIR"
mkdir -p "$(dirname "$PLUGIN_DIR")"
if [ -e "$PLUGIN_DIR" ] && [ ! -L "$PLUGIN_DIR" ]; then
  echo "  $PLUGIN_DIR exists and is not a symlink; leaving it alone" >&2
else
  ln -sfn "$ROOT/plugin/$PLUGIN_ID" "$PLUGIN_DIR"
fi
if command -v omarchy-shell >/dev/null; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  omarchy plugin enable "$PLUGIN_ID" >/dev/null 2>&1 || omarchy-shell shell enablePlugin "$PLUGIN_ID" '{}' >/dev/null 2>&1 || true
fi

echo
echo "Done. Pair a device: in Apple Home open it › Settings › Turn On Pairing Mode, then"
echo "click + in the bar panel, or run:"
echo "  omatter pair <code> --name \"Desk lamp\" --room Office"
