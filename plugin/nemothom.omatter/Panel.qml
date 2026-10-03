import QtQuick
import QtQuick.Controls as QQC
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Matter lights in the bar. All state comes from `omatter watch`, which
// streams JSON snapshots from omatterd; commands are written back to the same
// process's stdin so dragging a slider doesn't spawn a process per step.
Panel {
  id: root
  moduleName: "nemothom.omatter"
  ipcTarget: "nemothom.omatter"

  property var lights: []
  property var sensors: []
  property var scenes: []
  property var builtinScenes: []
  property string activeScene: ""
  property var favoriteColors: []
  property var recentColors: []
  property string detailsId: ""
  property bool arrangeMode: false
  property var roomOrder: []    // room keys in display order ("" = no room)
  property var deviceOrder: []  // light + sensor ids in display order
  property var details: null
  property bool daemonUp: false
  property string lastError: ""
  property string expandedId: ""
  property real wheelAccumulator: 0
  property var pendingBrightness: null
  property var collapsedRooms: []
  property bool sceneEdit: false
  property string renamingScene: ""
  property string confirmDeleteScene: ""
  property bool pairOpen: false
  property bool pairing: false
  property string pairError: ""
  property string pairMessage: ""

  // Plugs and switches are listed but don't count as "lights on" or join All on/off.
  readonly property var reachableLights: lights.filter(function(l) { return l.reachable && l.kind !== "plug" && l.kind !== "switch" })
  readonly property int litCount: reachableLights.filter(function(l) { return l.on }).length
  readonly property bool anyOn: litCount > 0
  readonly property var groups: groupByRoom(roomOrder, deviceOrder, lights, sensors)
  readonly property var roomNames: groups.map(function(g) { return g.room }).filter(function(r) { return r !== "" })

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  // Icon styles for the bar and panel header. "matter" is drawn (MatterIcon.qml);
  // the others are Nerd Font glyphs for the on / off / daemon-down states.
  readonly property var iconStyles: [
    { id: "house-outline", label: "House", on: 0xF06A1, off: 0xF06A1, down: 0xF1A47 }, // home-outline / home-off-outline
    { id: "house", label: "House (filled)", on: 0xF02DC, off: 0xF02DC, down: 0xF1A46 }, // home / home-off
    { id: "bulb", label: "Lightbulb", on: 0xF0335, off: 0xF0336, down: 0xF0E50 },      // lightbulb / -outline / -off-outline
    { id: "plug", label: "Plug", on: 0xF06A5, off: 0xF1425, down: 0xF06A6 },           // power-plug / -outline / -off
    { id: "matter", label: "Matter", on: 0, off: 0, down: 0 }
  ]
  property string iconStyle: "bulb"
  property bool iconPickerOpen: false
  readonly property bool matterIcon: iconStyle === "matter"
  readonly property var currentStyle: styleFor(iconStyle)
  readonly property string iconGlyph: glyphFor(currentStyle)

  function styleFor(id) {
    for (var i = 0; i < iconStyles.length; i++) if (iconStyles[i].id === id) return iconStyles[i]
    return iconStyles[2]
  }

  function glyphFor(style) {
    if (style.id === "matter") return ""
    return String.fromCodePoint(!root.daemonUp ? style.down : (root.anyOn ? style.on : style.off))
  }

  function chooseIcon(id) {
    root.iconStyle = id // Optimistic; the daemon echoes it back.
    root.iconPickerOpen = false
    send("ui.set", { icon: id })
  }

  // Groups follow the daemon's room order; each group's `devices` interleaves
  // lights and sensors in the user's order.
  function groupByRoom(roomKeys, ids, lightList, sensorList) {
    var byId = {}
    lightList.forEach(function(l) { byId[l.id] = { type: "light", data: l } })
    sensorList.forEach(function(s) { byId[s.id] = { type: "sensor", data: s } })
    var ordered = ids.filter(function(id) { return id in byId }).map(function(id) { return byId[id] })
    // Anything the order doesn't mention yet (e.g. just paired) goes last.
    Object.keys(byId).forEach(function(id) { if (ids.indexOf(id) === -1) ordered.push(byId[id]) })

    var keys = roomKeys.slice()
    ordered.forEach(function(d) { var r = d.data.room || ""; if (keys.indexOf(r) === -1) keys.push(r) })
    return keys.map(function(room) {
      var devices = ordered.filter(function(d) { return (d.data.room || "") === room })
      return {
        room: room,
        devices: devices,
        lights: devices.filter(function(d) { return d.type === "light" }).map(function(d) { return d.data }),
        sensors: devices.filter(function(d) { return d.type === "sensor" }).map(function(d) { return d.data })
      }
    }).filter(function(g) { return g.devices.length > 0 })
  }

  function moveRoom(index, delta) {
    var keys = root.groups.map(function(g) { return g.room })
    var j = index + delta
    if (j < 0 || j >= keys.length) return
    var tmp = keys[index]; keys[index] = keys[j]; keys[j] = tmp
    root.roomOrder = keys // Optimistic; the daemon echoes it back.
    send("order.set", { rooms: keys })
  }

  function moveDevice(groupIndex, index, delta) {
    var lists = root.groups.map(function(g) { return g.devices.map(function(d) { return d.data.id }) })
    var list = lists[groupIndex]
    var j = index + delta
    if (j < 0 || j >= list.length) return
    var tmp = list[index]; list[index] = list[j]; list[j] = tmp
    var flat = [].concat.apply([], lists)
    root.deviceOrder = flat
    send("order.set", { devices: flat })
  }

  function deviceGlyph(d) {
    if (d.type === "sensor") return String.fromCodePoint(0xF0D91)                   // motion-sensor
    if (d.data.kind === "plug") return String.fromCodePoint(0xF06A5)                 // power-plug
    if (d.data.kind === "switch") return String.fromCodePoint(0xF097E)               // light-switch
    return String.fromCodePoint(0xF0335)                                              // lightbulb
  }

  function toggleDetails(id) {
    root.details = null
    root.detailsId = root.detailsId === id ? "" : id
    if (root.detailsId !== "") send("details", { target: id })
  }

  function send(cmd, args) {
    if (!watchProc.running) return
    watchProc.write(JSON.stringify({ cmd: cmd, args: args || {} }) + "\n")
  }

  function setLight(id, args) {
    args.target = id
    send("set", args)
  }

  function handleLine(line) {
    var msg
    try { msg = JSON.parse(line) } catch (e) { return }
    if (msg.event === "daemon") {
      root.daemonUp = msg.up === true
      if (!root.daemonUp) {
        root.lights = []
        if (root.pairing) {
          root.pairing = false
          root.pairError = "Lost connection to omatterd while pairing."
        }
      }
    } else if (msg.event === "state") {
      root.daemonUp = true
      root.lights = msg.lights || []
      root.scenes = msg.scenes || []
      root.sensors = msg.sensors || []
      root.roomOrder = msg.rooms || []
      root.deviceOrder = msg.order || []
      root.builtinScenes = msg.builtinScenes || []
      root.activeScene = msg.activeScene || ""
      root.favoriteColors = (msg.ui && msg.ui.favoriteColors) || []
      root.recentColors = (msg.ui && msg.ui.recentColors) || []
      root.iconStyle = (msg.ui && msg.ui.icon) || "bulb"
      root.collapsedRooms = (msg.ui && msg.ui.collapsedRooms) || []
      root.lastError = ""
    } else if (msg.event === "result" && msg.cmd === "details") {
      if (msg.result && msg.result.id === root.detailsId) root.details = msg.result
    } else if (msg.event === "result" && msg.cmd === "pair") {
      var names = (msg.result || []).map(function(d) { return d.name })
      root.pairing = false
      root.pairOpen = false
      root.pairError = ""
      root.pairMessage = names.length ? "Paired " + names.join(", ") : "Paired, but the device has no lights, plugs or sensors Omatter understands."
      pairMessageTimer.restart()
    } else if (msg.event === "error" && msg.cmd === "pair") {
      root.pairing = false
      root.pairError = msg.error || "Pairing failed"
    } else if (msg.event === "error" && msg.cmd === "details") {
      root.detailsId = ""
    } else if (msg.event === "error") {
      root.lastError = msg.error || ""
      errorTimer.restart()
    }
  }

  function roomKey(room) { return room || "" }
  function isCollapsed(room) { return root.collapsedRooms.indexOf(roomKey(room)) !== -1 }
  function toggleCollapsed(room) {
    var key = roomKey(room)
    var next = root.collapsedRooms.filter(function(r) { return r !== key })
    if (next.length === root.collapsedRooms.length) next.push(key)
    root.collapsedRooms = next // Optimistic; the daemon echoes it back.
    send("ui.set", { collapsedRooms: next })
  }

  function startPairing(code, name, room) {
    code = String(code || "").trim()
    if (code === "" || root.pairing) return
    root.pairError = ""
    root.pairing = true
    var args = { code: code }
    if (String(name).trim() !== "") args.name = String(name).trim()
    if (String(room).trim() !== "") args.room = String(room).trim()
    send("pair", args)
  }

  function finishSceneEdit() {
    root.renamingScene = ""
    root.confirmDeleteScene = ""
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  onOpenedChanged: if (!opened) {
    expandedId = ""
    detailsId = ""
    details = null
    arrangeMode = false
    iconPickerOpen = false
    sceneEdit = false
    renamingScene = ""
    confirmDeleteScene = ""
    // Keep the form open while a pairing is in flight so its result is visible.
    if (!pairing) {
      pairOpen = false
      pairError = ""
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Process {
    id: watchProc
    command: ["omatter", "watch"]
    running: true
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { root.handleLine(line) } }
    onExited: {
      root.daemonUp = false
      restartTimer.start()
    }
  }

  Timer { id: restartTimer; interval: 5000; onTriggered: watchProc.running = true }
  Timer { id: errorTimer; interval: 6000; onTriggered: root.lastError = "" }
  Timer { id: pairMessageTimer; interval: 8000; onTriggered: root.pairMessage = "" }

  // Keep the open details panel fresh ("last seen", signal, state).
  Timer {
    interval: 3000
    repeat: true
    running: root.opened && root.detailsId !== ""
    onTriggered: root.send("details", { target: root.detailsId })
  }

  // Throttle slider drags to ~7 updates/sec; the release always sends.
  Timer {
    id: brightnessTimer
    interval: 140
    onTriggered: {
      if (root.pendingBrightness) root.setLight(root.pendingBrightness.id, { brightness: root.pendingBrightness.value })
      root.pendingBrightness = null
    }
  }

  function requestBrightness(id, value, final) {
    if (final) {
      brightnessTimer.stop()
      root.pendingBrightness = null
      setLight(id, { brightness: value })
      return
    }
    root.pendingBrightness = { id: id, value: value }
    if (!brightnessTimer.running) brightnessTimer.start()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.iconGlyph
    foreground: root.anyOn ? root.barForeground : Qt.darker(root.barForeground, 1.55)
    iconComponent: root.matterIcon ? barMatterIcon : null
    tooltipText: !root.daemonUp ? "Lights: omatterd not running"
      : root.anyOn ? root.litCount + " light" + (root.litCount === 1 ? "" : "s") + " on" : "Lights off"
    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.send("set", { target: "all", toggle: true })
      else root.toggle()
    }
    onWheelMoved: function(delta) {
      var wheel = Util.wheelSteps(root.wheelAccumulator, delta)
      root.wheelAccumulator = wheel.remainder
      if (wheel.steps === 0 || !root.anyOn) return
      var ids = root.reachableLights.filter(function(l) { return l.on }).map(function(l) { return l.id })
      root.send("set", { target: ids.join(","), brightnessDelta: wheel.steps * 10 })
    }
  }

  Component {
    id: barMatterIcon
    Item {
      MatterIcon {
        anchors.centerIn: parent
        iconSize: Style.bar.iconCanvas * 0.85
        color: button.foreground
        opacity: root.daemonUp ? 1 : 0.5
      }
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // ---------- Hero ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, allButton.implicitHeight)

          // Click the header icon to choose the bar icon.
          Item {
            id: heroIcon
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            implicitWidth: Math.max(heroGlyph.implicitWidth, Style.font.display)
            implicitHeight: Math.max(heroGlyph.implicitHeight, Style.font.display)
            width: implicitWidth
            height: implicitHeight

            Rectangle {
              anchors.centerIn: parent
              width: parent.width + Style.space(10)
              height: parent.height + Style.space(6)
              radius: Style.cornerRadius > 0 ? Style.space(8) : 0
              color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, root.iconPickerOpen ? 0.12 : (heroIconMouse.containsMouse ? 0.07 : 0))
              Behavior on color { ColorAnimation { duration: 120 } }
            }

            Text {
              id: heroGlyph
              visible: !root.matterIcon
              anchors.centerIn: parent
              textFormat: Text.PlainText
              text: root.iconGlyph
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }

            MatterIcon {
              visible: root.matterIcon
              anchors.centerIn: parent
              iconSize: Style.font.display * 0.9
              color: root.foreground
            }

            MouseArea {
              id: heroIconMouse
              anchors.fill: parent
              anchors.margins: -Style.space(4)
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.iconPickerOpen = !root.iconPickerOpen
            }

            PanelToolTip {
              visible: heroIconMouse.containsMouse && !root.iconPickerOpen
              text: "Change icon"
            }
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: heroActions.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Lights"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
            }
            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: (!root.daemonUp ? "omatterd not running"
                : root.lights.length + root.sensors.length === 0 ? "No lights paired"
                : root.litCount + " of " + root.reachableLights.length + " on").toUpperCase()
              color: Qt.darker(root.foreground, 1.4)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
            }
          }

          Row {
            id: heroActions
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(6)

            Button {
              id: allButton
              visible: root.reachableLights.length > 0
              anchors.verticalCenter: parent.verticalCenter
              text: root.anyOn ? "All off" : "All on"
              fontSize: Style.font.bodySmall
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.send("set", { target: "all", on: !root.anyOn })
            }

            Button {
              id: arrangeButton
              visible: root.daemonUp && root.lights.length + root.sensors.length > 1
              anchors.verticalCenter: parent.verticalCenter
              height: addButton.height
              iconText: String.fromCodePoint(0xF04E2) // nf-md-swap-vertical
              tooltipText: root.arrangeMode ? "Done arranging" : "Reorder rooms and devices"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              selected: root.arrangeMode
              onClicked: {
                root.arrangeMode = !root.arrangeMode
                if (root.arrangeMode) {
                  root.pairOpen = root.pairing
                  root.sceneEdit = false
                  root.expandedId = ""
                  root.detailsId = ""
                }
              }
            }

            Button {
              id: addButton
              visible: root.daemonUp
              anchors.verticalCenter: parent.verticalCenter
              height: allButton.visible ? allButton.height : implicitHeight
              iconText: String.fromCodePoint(0xF0415) // nf-md-plus
              tooltipText: "Pair a new light"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              selected: root.pairOpen
              onClicked: {
                root.pairOpen = !root.pairOpen
                if (root.pairOpen) {
                  root.pairError = ""
                  root.sceneEdit = false
                  Qt.callLater(function() { pairCode.forceActiveFocus() })
                } else if (!root.pairing) {
                  Qt.callLater(function() { keyCatcher.forceActiveFocus() })
                }
              }
            }
          }
        }

        // ---------- Icon picker ----------
        Column {
          visible: root.iconPickerOpen
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: "ICON"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Row {
            spacing: Style.space(8)

            Repeater {
              model: root.iconStyles

              Rectangle {
                id: choice
                required property var modelData
                readonly property bool current: root.iconStyle === modelData.id
                width: Style.space(44)
                height: width
                radius: Style.cornerRadius > 0 ? Style.space(8) : 0
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, current ? 0.14 : (choiceMouse.containsMouse ? 0.07 : 0))
                border.width: current ? 2 : 1
                border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, current ? 0.9 : 0.25)

                Text {
                  visible: choice.modelData.id !== "matter"
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: choice.modelData.on ? String.fromCodePoint(choice.modelData.on) : ""
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.iconLarge
                }

                MatterIcon {
                  visible: choice.modelData.id === "matter"
                  anchors.centerIn: parent
                  iconSize: Style.font.iconLarge
                  color: root.foreground
                }

                MouseArea {
                  id: choiceMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.chooseIcon(choice.modelData.id)
                }

                PanelToolTip {
                  visible: choiceMouse.containsMouse
                  text: choice.modelData.label
                }
              }
            }
          }

          PanelSeparator { foreground: root.foreground }
        }

        Text {
          visible: root.pairMessage !== ""
          width: parent.width
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          text: String.fromCodePoint(0xF012C) + "  " + root.pairMessage // nf-md-check
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        // ---------- Pair a new light ----------
        Column {
          id: pairForm
          visible: root.pairOpen && root.daemonUp
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: "PAIR A NEW LIGHT"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Text {
            width: parent.width
            wrapMode: Text.Wrap
            textFormat: Text.PlainText
            text: "In Apple Home, open the light, then Settings › Turn On Pairing Mode, and enter the code it shows."
            color: root.foreground
            opacity: 0.7
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          FormField {
            id: pairCode
            placeholderText: "Setup code, e.g. 1234-567-8901"
            inputMethodHints: Qt.ImhPreferNumbers
            onAccepted: pairName.forceActiveFocus()
          }

          FormField {
            id: pairName
            placeholderText: "Name (optional)"
            onAccepted: pairRoom.forceActiveFocus()
          }

          FormField {
            id: pairRoom
            placeholderText: "Room (optional)"
            onAccepted: pairSubmit.submit()
          }

          Flow {
            visible: root.roomNames.length > 0 && !root.pairing
            width: parent.width
            spacing: Style.space(4)
            Repeater {
              model: root.roomNames
              SmallButton {
                required property string modelData
                text: modelData
                selected: pairRoom.text.trim().toLowerCase() === modelData.toLowerCase()
                onClicked: pairRoom.text = modelData
              }
            }
          }

          Text {
            visible: root.pairError !== ""
            width: parent.width
            wrapMode: Text.Wrap
            textFormat: Text.PlainText
            text: root.pairError
            color: root.bar ? root.bar.urgent : Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Item {
            width: parent.width
            implicitHeight: pairSubmit.implicitHeight

            Text {
              visible: root.pairing
              anchors.left: parent.left
              anchors.right: pairButtons.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              wrapMode: Text.Wrap
              textFormat: Text.PlainText
              text: "Pairing… this can take up to two minutes."
              color: root.foreground
              opacity: 0.7
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall

              SequentialAnimation on opacity {
                running: root.pairing
                loops: Animation.Infinite
                NumberAnimation { from: 0.8; to: 0.35; duration: 900; easing.type: Easing.InOutSine }
                NumberAnimation { from: 0.35; to: 0.8; duration: 900; easing.type: Easing.InOutSine }
              }
            }

            Row {
              id: pairButtons
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              SmallButton {
                visible: !root.pairing
                text: "Cancel"
                onClicked: {
                  root.pairOpen = false
                  root.pairError = ""
                  keyCatcher.forceActiveFocus()
                }
              }

              SmallButton {
                id: pairSubmit
                text: root.pairing ? "Pairing…" : "Pair"
                enabled: !root.pairing && pairCode.text.trim() !== ""
                function submit() {
                  if (!enabled) return
                  root.startPairing(pairCode.text, pairName.text, pairRoom.text)
                }
                onClicked: submit()
              }
            }
          }

          // Clear the fields once a pairing succeeds.
          Connections {
            target: root
            function onPairMessageChanged() {
              if (root.pairMessage === "") return
              pairCode.text = ""
              pairName.text = ""
              pairRoom.text = ""
            }
          }

          PanelSeparator { foreground: root.foreground }
        }

        Text {
          visible: root.lastError !== ""
          width: parent.width
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          text: root.lastError
          color: root.bar ? root.bar.urgent : Color.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          visible: !root.daemonUp || root.lights.length + root.sensors.length === 0
          width: parent.width
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          text: !root.daemonUp
            ? "Start the daemon with: systemctl --user start omatterd"
            : "No lights yet. Click + to pair one."
          color: root.foreground
          opacity: 0.7
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        // ---------- Scenes ----------
        Column {
          visible: root.daemonUp && root.lights.length > 0
          width: parent.width
          spacing: Style.space(8)

          Item {
            width: parent.width
            implicitHeight: scenesHeader.implicitHeight

            PanelSectionHeader {
              id: scenesHeader
              text: "SCENES"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            LinkText {
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: root.sceneEdit ? "done" : "edit"
              onClicked: {
                root.sceneEdit = !root.sceneEdit
                root.finishSceneEdit()
              }
            }
          }

          // Apply mode: one chip per scene.
          Flow {
            visible: !root.sceneEdit
            width: parent.width
            spacing: Style.space(6)
            Repeater {
              model: root.scenes
              Button {
                required property string modelData
                readonly property bool isTheme: root.builtinScenes.indexOf(modelData) !== -1 && modelData === "theme"
                iconText: isTheme ? String.fromCodePoint(0xF03D8) : "" // nf-md-palette
                iconSize: Style.font.bodySmall
                text: modelData.charAt(0).toUpperCase() + modelData.slice(1)
                tooltipText: isTheme ? "Colours from your Omarchy theme; follows theme changes while active" : ""
                fontSize: Style.font.bodySmall
                foreground: root.foreground
                fontFamily: root.fontFamily
                bordered: true
                selected: root.activeScene === modelData
                onClicked: root.send("scene.apply", { name: modelData })
              }
            }
          }

          // Edit mode: update / rename / delete each scene, save a new one.
          Column {
            visible: root.sceneEdit
            width: parent.width
            spacing: Style.space(6)

            Repeater {
              model: root.scenes

              Item {
                id: sceneRow
                required property string modelData
                readonly property bool renaming: root.renamingScene === modelData
                readonly property bool confirming: root.confirmDeleteScene === modelData
                width: parent.width
                implicitHeight: Math.max(sceneName.implicitHeight, renameField.implicitHeight, sceneActions.implicitHeight)

                Text {
                  id: sceneName
                  visible: !sceneRow.renaming
                  anchors.left: parent.left
                  anchors.right: sceneActions.left
                  anchors.rightMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: sceneRow.modelData
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideRight
                }

                TextField {
                  id: renameField
                  visible: sceneRow.renaming
                  anchors.left: parent.left
                  anchors.right: sceneActions.left
                  anchors.rightMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  foreground: root.foreground
                  font.pixelSize: Style.font.body
                  verticalPadding: Style.space(3)
                  onVisibleChanged: if (visible) {
                    text = sceneRow.modelData
                    forceActiveFocus()
                    selectAll()
                  }
                  onAccepted: {
                    var name = text.trim()
                    if (name !== "" && name !== sceneRow.modelData)
                      root.send("scene.rename", { name: sceneRow.modelData, to: name })
                    root.finishSceneEdit()
                  }
                  Keys.onEscapePressed: function(event) {
                    root.finishSceneEdit()
                    event.accepted = true
                  }
                }

                Text {
                  visible: root.builtinScenes.indexOf(sceneRow.modelData) !== -1
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: "built-in · follows your theme"
                  color: root.foreground
                  opacity: 0.45
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }

                Row {
                  id: sceneActions
                  visible: root.builtinScenes.indexOf(sceneRow.modelData) === -1
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(4)

                  SmallButton {
                    visible: !sceneRow.confirming
                    text: "Update"
                    tooltipText: "Replace with the lights' current state"
                    onClicked: root.send("scene.save", { name: sceneRow.modelData })
                  }
                  SmallButton {
                    visible: !sceneRow.confirming
                    text: "Rename"
                    onClicked: {
                      root.confirmDeleteScene = ""
                      root.renamingScene = sceneRow.renaming ? "" : sceneRow.modelData
                    }
                  }
                  SmallButton {
                    text: sceneRow.confirming ? "Delete?" : "Delete"
                    foreground: sceneRow.confirming ? (root.bar ? root.bar.urgent : Color.urgent) : root.foreground
                    onClicked: {
                      if (sceneRow.confirming) {
                        root.send("scene.rm", { name: sceneRow.modelData })
                        root.finishSceneEdit()
                      } else {
                        root.renamingScene = ""
                        root.confirmDeleteScene = sceneRow.modelData
                      }
                    }
                  }
                  SmallButton {
                    visible: sceneRow.confirming
                    text: "Cancel"
                    onClicked: root.confirmDeleteScene = ""
                  }
                }
              }
            }

            Item {
              width: parent.width
              implicitHeight: Math.max(newSceneField.implicitHeight, saveSceneButton.implicitHeight)

              TextField {
                id: newSceneField
                anchors.left: parent.left
                anchors.right: saveSceneButton.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                foreground: root.foreground
                font.pixelSize: Style.font.body
                verticalPadding: Style.space(3)
                placeholderText: "New scene from current lights"
                onAccepted: saveSceneButton.save()
                Keys.onEscapePressed: function(event) {
                  text = ""
                  root.finishSceneEdit()
                  event.accepted = true
                }
              }

              SmallButton {
                id: saveSceneButton
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: "Save"
                enabled: newSceneField.text.trim() !== ""
                function save() {
                  var name = newSceneField.text.trim()
                  if (name === "") return
                  root.send("scene.save", { name: name })
                  newSceneField.text = ""
                  root.finishSceneEdit()
                }
                onClicked: save()
              }
            }
          }
        }

        // ---------- Arrange mode: compact rows with up/down arrows ----------
        Column {
          visible: root.arrangeMode
          width: parent.width
          spacing: Style.space(8)

          Item {
            width: parent.width
            implicitHeight: arrangeTitle.implicitHeight

            PanelSectionHeader {
              id: arrangeTitle
              text: "ARRANGE"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            LinkText {
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: "done"
              onClicked: root.arrangeMode = false
            }
          }

          Text {
            width: parent.width
            wrapMode: Text.Wrap
            textFormat: Text.PlainText
            text: "Move rooms with the arrows on their headers, and devices within their room."
            color: root.foreground
            opacity: 0.55
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Flickable {
            id: arrangeView
            width: parent.width
            height: Math.min(contentHeight, Style.space(480))
            contentWidth: width
            contentHeight: arrangeColumn.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height
            QQC.ScrollBar.vertical: QQC.ScrollBar { policy: QQC.ScrollBar.AsNeeded }

            Column {
              id: arrangeColumn
              width: arrangeView.width - (arrangeView.interactive ? Style.space(10) : 0)
              spacing: Style.space(10)

              Repeater {
                model: root.arrangeMode ? root.groups : []

                Column {
                  id: arrangeGroup
                  required property var modelData
                  required property int index
                  width: arrangeColumn.width
                  spacing: Style.space(4)

                  PanelSeparator { foreground: root.foreground }

                  ArrangeRow {
                    width: parent.width
                    bar: root.bar
                    heading: true
                    label: arrangeGroup.modelData.room || "No room"
                    canMoveUp: arrangeGroup.index > 0
                    canMoveDown: arrangeGroup.index < root.groups.length - 1
                    onMoveUp: root.moveRoom(arrangeGroup.index, -1)
                    onMoveDown: root.moveRoom(arrangeGroup.index, 1)
                  }

                  Repeater {
                    model: arrangeGroup.modelData.devices
                    ArrangeRow {
                      required property var modelData
                      required property int index
                      width: arrangeColumn.width
                      bar: root.bar
                      glyph: root.deviceGlyph(modelData)
                      label: modelData.data.name
                      canMoveUp: index > 0
                      canMoveDown: index < arrangeGroup.modelData.devices.length - 1
                      onMoveUp: root.moveDevice(arrangeGroup.index, index, -1)
                      onMoveDown: root.moveDevice(arrangeGroup.index, index, 1)
                    }
                  }
                }
              }
            }
          }
        }

        // ---------- Lights by room (scrolls when long) ----------
        Flickable {
          id: roomsView
          visible: !root.arrangeMode
          width: parent.width
          height: Math.min(contentHeight, Style.space(440))
          contentWidth: width
          contentHeight: roomsColumn.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height
          QQC.ScrollBar.vertical: QQC.ScrollBar { policy: QQC.ScrollBar.AsNeeded }

          Column {
            id: roomsColumn
            width: roomsView.width - (roomsView.interactive ? Style.space(10) : 0)
            spacing: Style.space(12)

            Repeater {
              model: root.groups

              Column {
                id: roomGroup
                required property var modelData
                readonly property bool collapsed: root.isCollapsed(modelData.room)
                readonly property var roomLights: modelData.lights.filter(function(l) { return l.kind !== "plug" && l.kind !== "switch" })
                readonly property int litInRoom: roomLights.filter(function(l) { return l.reachable && l.on }).length
                width: roomsColumn.width
                spacing: Style.space(12)

                PanelSeparator { foreground: root.foreground }

                Item {
                  width: parent.width
                  implicitHeight: roomHeader.implicitHeight

                  Row {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(6)

                    Text {
                      anchors.verticalCenter: parent.verticalCenter
                      textFormat: Text.PlainText
                      text: String.fromCodePoint(roomGroup.collapsed ? 0xF0142 : 0xF0140) // chevron right / down
                      color: root.foreground
                      opacity: 0.7
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }

                    PanelSectionHeader {
                      id: roomHeader
                      anchors.verticalCenter: parent.verticalCenter
                      text: (roomGroup.modelData.room || "Lights").toUpperCase()
                        + (roomGroup.collapsed ? "  ·  " + roomGroup.litInRoom + " ON" : "")
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                    }
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleCollapsed(roomGroup.modelData.room)
                  }

                  LinkText {
                    visible: roomGroup.roomLights.length > 1 || (roomGroup.collapsed && roomGroup.roomLights.length > 0)
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    text: roomGroup.litInRoom > 0 ? "turn off" : "turn on"
                    onClicked: root.send("set", {
                      target: roomGroup.roomLights.map(function(l) { return l.id }).join(","),
                      on: roomGroup.litInRoom === 0
                    })
                  }
                }

                Repeater {
                  model: roomGroup.collapsed ? [] : roomGroup.modelData.devices

                  Item {
                    id: deviceSlot
                    required property var modelData
                    width: roomsColumn.width
                    implicitHeight: deviceLoader.item ? deviceLoader.item.implicitHeight : 0
                    height: implicitHeight

                    Loader {
                      id: deviceLoader
                      width: parent.width
                      sourceComponent: deviceSlot.modelData.type === "sensor" ? sensorComponent : lightComponent
                    }

                    Component {
                      id: lightComponent
                  LightRow {
                    readonly property var modelData: deviceSlot.modelData.data
                    width: roomsColumn.width
                    bar: root.bar
                    light: modelData
                    expanded: root.expandedId === modelData.id
                    onToggleRequested: root.setLight(modelData.id, { toggle: true })
                    onBrightnessRequested: function(value, final) { root.requestBrightness(modelData.id, value, final) }
                    onColorRequested: function(hex) { root.setLight(modelData.id, { color: hex, on: true }) }
                    onTemperatureRequested: function(k) { root.setLight(modelData.id, { kelvin: k, on: true }) }
                    onExpandRequested: root.expandedId = root.expandedId === modelData.id ? "" : modelData.id
                    detailsOpen: root.detailsId === modelData.id
                    details: root.detailsId === modelData.id ? root.details : null
                    favorites: root.favoriteColors
                    recents: root.recentColors
                    onDetailsRequested: root.toggleDetails(modelData.id)
                    onReconnectRequested: root.send("reconnect", { target: modelData.id })
                    onFavoriteAdded: function(hex) { root.send("colors.favorite", { hex: hex }) }
                    onFavoriteRemoved: function(hex) { root.send("colors.favorite", { hex: hex, remove: true }) }
                  }
                    }

                    Component {
                      id: sensorComponent
                  SensorRow {
                    readonly property var modelData: deviceSlot.modelData.data
                    width: roomsColumn.width
                    bar: root.bar
                    sensor: modelData
                    detailsOpen: root.detailsId === modelData.id
                    details: root.detailsId === modelData.id ? root.details : null
                    onDetailsRequested: root.toggleDetails(modelData.id)
                    onReconnectRequested: root.send("reconnect", { target: modelData.id })
                  }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  component LinkText: Text {
    signal clicked()
    textFormat: Text.PlainText
    color: root.foreground
    opacity: linkMouse.containsMouse ? 1 : 0.55
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    MouseArea {
      id: linkMouse
      anchors.fill: parent
      anchors.margins: -Style.space(4)
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: parent.clicked()
    }
  }

  component FormField: TextField {
    width: pairForm.width
    foreground: root.foreground
    font.pixelSize: Style.font.body
    verticalPadding: Style.space(4)
    enabled: !root.pairing
    Keys.onEscapePressed: function(event) {
      if (root.pairing) return
      root.pairOpen = false
      keyCatcher.forceActiveFocus()
      event.accepted = true
    }
  }

  component SmallButton: Button {
    fontSize: Style.font.caption
    foreground: root.foreground
    fontFamily: root.fontFamily
    bordered: true
    horizontalPadding: Style.space(7)
    verticalPadding: Style.space(3)
  }
}
