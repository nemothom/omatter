import QtQuick
import qs.Commons
import qs.Ui

// One light: name + switch, brightness slider + colour swatch, and an
// expandable colour/temperature picker.
Column {
  id: root

  property QtObject bar: null
  property var light: ({})
  property bool expanded: false
  property bool detailsOpen: false
  property var details: null
  property var favorites: []
  property var recents: []

  signal toggleRequested()
  signal brightnessRequested(int value, bool final)
  signal colorRequested(string hex)
  signal temperatureRequested(int kelvin)
  signal expandRequested()
  signal detailsRequested()
  signal reconnectRequested()
  signal favoriteAdded(string hex)
  signal favoriteRemoved(string hex)

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property bool reachable: light.reachable === true
  readonly property bool hasColorControls: light.caps && (light.caps.color || light.caps.ct)
  readonly property color swatchColor: {
    if (!light.on) return Qt.rgba(foreground.r, foreground.g, foreground.b, 0.15)
    if (light.mode === "color" && light.color) return light.color
    if (light.mode === "ct" && light.kelvin) return kelvinColor(light.kelvin)
    return "#ffe6b8"
  }

  function kelvinColor(k) {
    var t = Math.max(0, Math.min(1, (k - 2000) / 4500))
    return Qt.rgba(1, 0.55 + 0.4 * t, 0.08 + 0.92 * t, 1)
  }

  spacing: Style.space(6)

  Item {
    width: parent.width
    implicitHeight: Math.max(nameColumn.implicitHeight, toggle.implicitHeight)
    opacity: root.reachable ? 1 : 0.4

    // Plugs and wall switches get a glyph so they read differently from bulbs.
    Text {
      id: kindIcon
      visible: root.light.kind === "plug" || root.light.kind === "switch"
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      width: visible ? Style.space(20) : 0
      textFormat: Text.PlainText
      text: String.fromCodePoint(root.light.kind === "plug" ? 0xF06A5 : 0xF097E) // power-plug / light-switch
      color: root.foreground
      opacity: root.light.on ? 1 : 0.6
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.body
    }

    Column {
      id: nameColumn
      anchors.left: kindIcon.right
      anchors.right: info.left
      anchors.rightMargin: Style.space(10)
      anchors.verticalCenter: parent.verticalCenter

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: root.light.name || "Light"
        color: root.foreground
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.body
        font.bold: root.light.on === true
        elide: Text.ElideRight
      }
      Text {
        visible: !root.reachable
        textFormat: Text.PlainText
        text: "UNREACHABLE"
        color: root.foreground
        opacity: 0.6
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1.1
      }
    }

    InfoButton {
      id: info
      anchors.right: toggle.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      bar: root.bar
      active: root.detailsOpen
      onClicked: root.detailsRequested()
    }

    ToggleSwitch {
      id: toggle
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      checked: root.light.on === true
      interactive: root.reachable
      cursorRing: false
      foreground: root.foreground
      onToggled: root.toggleRequested()
    }
  }

  Item {
    visible: root.reachable && (root.light.caps && root.light.caps.dim || root.hasColorControls)
    width: parent.width
    implicitHeight: Math.max(slider.implicitHeight, swatch.height)

    PanelSlider {
      id: slider
      visible: root.light.caps && root.light.caps.dim
      anchors.left: parent.left
      anchors.right: percent.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      bar: root.bar
      minimum: 1
      maximum: 100
      step: 1
      integer: true
      value: root.light.on ? (root.light.brightness || 0) : 0
      onMoved: function(v) { root.brightnessRequested(Math.round(v), false) }
      onReleased: function(v) { root.brightnessRequested(Math.round(v), true) }
    }

    Text {
      id: percent
      visible: slider.visible
      anchors.right: swatch.visible ? swatch.left : parent.right
      anchors.rightMargin: swatch.visible ? Style.space(10) : 0
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(34)
      horizontalAlignment: Text.AlignRight
      textFormat: Text.PlainText
      text: root.light.on ? Math.round(slider.liveValue) + "%" : "off"
      color: root.foreground
      opacity: 0.7
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    Rectangle {
      id: swatch
      visible: root.hasColorControls
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(22)
      height: width
      radius: width / 2
      color: root.swatchColor
      border.width: root.expanded || swatchMouse.containsMouse ? 2 : 1
      border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, root.expanded ? 0.9 : 0.35)

      MouseArea {
        id: swatchMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.expandRequested()
      }
    }
  }

  ColorPicker {
    visible: root.expanded && root.reachable && root.hasColorControls
    width: parent.width
    bar: root.bar
    supportsColor: root.light.caps && root.light.caps.color === true
    supportsTemperature: root.light.caps && root.light.caps.ct === true
    minKelvin: root.light.caps ? root.light.caps.ctMin : 2000
    maxKelvin: root.light.caps ? root.light.caps.ctMax : 6500
    favorites: root.favorites
    recents: root.recents
    currentColor: root.light.on && root.light.mode === "color" ? (root.light.color || "") : ""
    onColorPicked: function(hex) { root.colorRequested(hex) }
    onTemperaturePicked: function(k) { root.temperatureRequested(k) }
    onFavoriteAdded: function(hex) { root.favoriteAdded(hex) }
    onFavoriteRemoved: function(hex) { root.favoriteRemoved(hex) }
  }

  DetailsBlock {
    visible: root.detailsOpen
    width: parent.width
    bar: root.bar
    details: root.details
    onReconnectRequested: root.reconnectRequested()
  }
}
