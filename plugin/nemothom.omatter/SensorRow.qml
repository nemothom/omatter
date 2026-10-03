import QtQuick
import qs.Commons

// A sensor: icon, name, current readings and a discreet details button.
Column {
  id: root

  property QtObject bar: null
  property var sensor: ({})
  property bool detailsOpen: false
  property var details: null

  signal detailsRequested()
  signal reconnectRequested()

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property var readings: sensor.readings || {}
  readonly property bool reachable: sensor.reachable === true

  function glyph() {
    var r = readings
    if (r.occupied !== undefined) return String.fromCodePoint(0xF0D91)            // motion-sensor
    if (r.contact !== undefined) return String.fromCodePoint(r.contact ? 0xF081A : 0xF081C) // door / door-open
    if (r.temperature !== undefined) return String.fromCodePoint(0xF050F)         // thermometer
    if (r.humidity !== undefined) return String.fromCodePoint(0xF058E)            // water-percent
    if (r.illuminance !== undefined) return String.fromCodePoint(0xF00DE)         // brightness
    return String.fromCodePoint(0xF0D91)
  }

  function summary() {
    if (!reachable) return "unreachable"
    var r = readings, parts = []
    if (r.temperature !== undefined) parts.push(r.temperature.toFixed(1) + "°")
    if (r.humidity !== undefined) parts.push(r.humidity + "%")
    if (r.occupied !== undefined) parts.push(r.occupied ? "motion" : "clear")
    if (r.illuminance !== undefined) parts.push(r.illuminance + " lx")
    if (r.contact !== undefined) parts.push(r.contact ? "closed" : "open")
    if (sensor.battery !== null && sensor.battery !== undefined && sensor.battery <= 20) parts.push("battery " + sensor.battery + "%")
    return parts.join("  ·  ") || "no readings yet"
  }

  spacing: Style.space(6)
  opacity: reachable ? 1 : 0.4

  Item {
    width: parent.width
    implicitHeight: Math.max(icon.implicitHeight, name.implicitHeight)

    Text {
      id: icon
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(20)
      textFormat: Text.PlainText
      text: root.glyph()
      color: root.foreground
      opacity: root.readings.occupied === true || root.readings.contact === false ? 1 : 0.7
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
    }

    Text {
      id: name
      anchors.left: icon.right
      anchors.right: value.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.sensor.name || "Sensor"
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
    }

    Text {
      id: value
      anchors.right: info.left
      anchors.rightMargin: Style.space(6)
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.summary()
      color: root.foreground
      opacity: 0.75
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    InfoButton {
      id: info
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      bar: root.bar
      active: root.detailsOpen
      onClicked: root.detailsRequested()
    }
  }

  DetailsBlock {
    visible: root.detailsOpen
    width: parent.width
    bar: root.bar
    details: root.details
    onReconnectRequested: root.reconnectRequested()
  }
}
