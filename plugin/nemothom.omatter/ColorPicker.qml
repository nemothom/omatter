import QtQuick
import qs.Commons

// Hue strip, white-temperature strip and quick swatches for one light.
// Emits colour as "#rrggbb" or temperature in Kelvin.
Column {
  id: root

  property QtObject bar: null
  property bool supportsColor: true
  property bool supportsTemperature: true
  property int minKelvin: 2000
  property int maxKelvin: 6500
  property var favorites: []
  property var recents: []
  property string currentColor: ""  // the light's colour, offered as a new favourite

  signal colorPicked(string hex)
  signal temperaturePicked(int kelvin)
  signal favoriteAdded(string hex)
  signal favoriteRemoved(string hex)

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property var swatches: ["#ff0000", "#ff7a00", "#ffe600", "#00ff3c", "#00e5ff", "#1e3cff", "#8c1eff", "#ff00d4"]
  readonly property var recentOnly: recents.filter(function(h) { return favorites.indexOf(h) === -1 }).slice(0, 8)
  readonly property bool canAddFavorite: currentColor !== "" && favorites.indexOf(currentColor.toLowerCase()) === -1

  spacing: Style.space(8)

  function hexFor(c) {
    function h(v) { var s = Math.round(v * 255).toString(16); return s.length < 2 ? "0" + s : s }
    return "#" + h(c.r) + h(c.g) + h(c.b)
  }

  StripPicker {
    visible: root.supportsColor
    gradient: Gradient {
      orientation: Gradient.Horizontal
      GradientStop { position: 0.0; color: Qt.hsva(0.0, 1, 1, 1) }
      GradientStop { position: 1 / 6; color: Qt.hsva(1 / 6, 1, 1, 1) }
      GradientStop { position: 2 / 6; color: Qt.hsva(2 / 6, 1, 1, 1) }
      GradientStop { position: 3 / 6; color: Qt.hsva(3 / 6, 1, 1, 1) }
      GradientStop { position: 4 / 6; color: Qt.hsva(4 / 6, 1, 1, 1) }
      GradientStop { position: 5 / 6; color: Qt.hsva(5 / 6, 1, 1, 1) }
      GradientStop { position: 1.0; color: Qt.hsva(0.999, 1, 1, 1) }
    }
    onPicked: function(f) { root.colorPicked(root.hexFor(Qt.hsva(Math.min(f, 0.999), 1, 1, 1))) }
  }

  StripPicker {
    visible: root.supportsTemperature
    gradient: Gradient {
      orientation: Gradient.Horizontal
      GradientStop { position: 0.0; color: "#ff8b14" }
      GradientStop { position: 0.25; color: "#ffb46b" }
      GradientStop { position: 0.55; color: "#ffd9b6" }
      GradientStop { position: 1.0; color: "#e9efff" }
    }
    onPicked: function(f) { root.temperaturePicked(Math.round(root.minKelvin + f * (root.maxKelvin - root.minKelvin))) }
  }

  Row {
    visible: root.supportsColor
    spacing: Style.space(6)
    Repeater {
      model: root.swatches
      Swatch { onPicked: function(hex) { root.colorPicked(hex) } }
    }
  }

  // Favourites: click to apply, right-click to remove, + saves the light's colour.
  SwatchRow {
    visible: root.supportsColor
    label: "FAVOURITES"
    hint: root.favorites.length ? "right-click to remove" : (root.canAddFavorite ? "" : "pick a colour, then +")

    Repeater {
      model: root.favorites
      Swatch {
        onPicked: function(hex) { root.colorPicked(hex) }
        onRemoved: function(hex) { root.favoriteRemoved(hex) }
      }
    }

    Rectangle {
      visible: root.canAddFavorite
      width: Style.space(22)
      height: width
      radius: width / 2
      color: "transparent"
      border.width: 1
      border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, addMouse.containsMouse ? 0.9 : 0.4)
      Text {
        anchors.centerIn: parent
        text: "+"
        color: root.foreground
        font.pixelSize: Style.font.body
      }
      MouseArea {
        id: addMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.favoriteAdded(root.currentColor)
      }
    }
  }

  SwatchRow {
    visible: root.supportsColor && root.recentOnly.length > 0
    label: "RECENT"
    Repeater {
      model: root.recentOnly
      Swatch { onPicked: function(hex) { root.colorPicked(hex) } }
    }
  }

  component SwatchRow: Column {
    property string label: ""
    property string hint: ""
    default property alias swatches: swatchFlow.children
    width: root.width
    spacing: Style.space(4)

    Row {
      spacing: Style.space(8)
      Text {
        textFormat: Text.PlainText
        text: parent.parent.label
        color: root.foreground
        opacity: 0.55
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1.1
      }
      Text {
        textFormat: Text.PlainText
        text: parent.parent.hint
        color: root.foreground
        opacity: 0.35
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.caption
      }
    }

    Flow {
      id: swatchFlow
      width: parent.width
      spacing: Style.space(6)
    }
  }

  component Swatch: Rectangle {
    id: swatch
    required property string modelData
    signal picked(string hex)
    signal removed(string hex)
    width: Style.space(22)
    height: width
    radius: width / 2
    color: modelData
    border.width: swatchMouse.containsMouse ? 2 : 0
    border.color: root.foreground
    MouseArea {
      id: swatchMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      acceptedButtons: Qt.LeftButton | Qt.RightButton
      onClicked: function(mouse) {
        if (mouse.button === Qt.RightButton) swatch.removed(swatch.modelData)
        else swatch.picked(swatch.modelData)
      }
    }
  }

  component StripPicker: Rectangle {
    id: strip
    signal picked(real fraction)
    width: root.width
    height: Style.space(14)
    radius: height / 2
    border.width: 1
    border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.2)

    Rectangle {
      visible: stripMouse.containsMouse
      x: Math.max(0, Math.min(strip.width - width, stripMouse.mouseX - width / 2))
      width: Style.space(4)
      height: strip.height
      radius: width / 2
      color: root.foreground
    }

    MouseArea {
      id: stripMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      function fraction(x) { return Math.max(0, Math.min(1, x / strip.width)) }
      // One command per pick: sending on press and again on release made the
      // bulb restart its transition mid-fade.
      onReleased: function(mouse) { strip.picked(fraction(mouse.x)) }
    }
  }
}
