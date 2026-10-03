import QtQuick
import qs.Commons
import qs.Ui

// Device health shown under a row when its ⓘ button is open.
Column {
  id: root

  property QtObject bar: null
  property var details: null   // DeviceDetails from omatterd, or null while loading

  signal reconnectRequested()

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function ago(ms) {
    if (ms === null || ms === undefined) return "never"
    if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + " s ago"
    if (ms < 3600000) return Math.round(ms / 60000) + " min ago"
    return Math.round(ms / 3600000) + " h ago"
  }

  function signalText(rssi) {
    if (rssi === null || rssi === undefined) return "—"
    var label = rssi >= -55 ? "excellent" : rssi >= -67 ? "good" : rssi >= -75 ? "fair" : "weak"
    return rssi + " dBm · " + label
  }

  function stateLabel(state) {
    return { connected: "Connected", reconnecting: "Reconnecting…", waiting: "Waiting for device", disconnected: "Disconnected" }[state] || state
  }

  readonly property var rows: details ? [
    ["Status", stateLabel(details.state)],
    ["Last seen", ago(details.lastSeenMs)],
    ["Wi-Fi", signalText(details.rssi)],
    ["Battery", details.battery === null ? "" : details.battery + "%"],
    ["Device", details.product.indexOf(details.vendor) === 0 ? details.product : details.vendor + " " + details.product],
    ["Firmware", details.firmware + (details.hardware && details.hardware !== "Unknown" ? "  ·  hw " + details.hardware : "")],
    ["Address", (details.addresses || []).join("\n") || "—"],
    ["Serial", details.serial || ""],
    ["Id", details.id]
  ].filter(function(r) { return r[1] !== "" }) : []

  spacing: Style.space(6)

  Rectangle {
    width: parent.width
    implicitHeight: body.implicitHeight + Style.space(16)
    radius: Style.cornerRadius > 0 ? Style.space(8) : 0
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.05)
    border.width: 1
    border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.1)

    Column {
      id: body
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.margins: Style.space(8)
      spacing: Style.space(3)

      Text {
        visible: !root.details
        textFormat: Text.PlainText
        text: "Loading…"
        color: root.foreground
        opacity: 0.6
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      Repeater {
        model: root.rows
        Row {
          required property var modelData
          width: body.width
          spacing: Style.space(8)

          Text {
            width: Style.space(70)
            textFormat: Text.PlainText
            text: modelData[0]
            color: root.foreground
            opacity: 0.55
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
          Text {
            width: body.width - Style.space(78)
            textFormat: Text.PlainText
            text: modelData[1]
            color: root.foreground
            wrapMode: Text.WrapAnywhere
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }

      Item {
        visible: !!root.details
        width: body.width
        implicitHeight: reconnect.implicitHeight + Style.space(4)

        Button {
          id: reconnect
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          text: "Reconnect"
          fontSize: Style.font.caption
          foreground: root.foreground
          fontFamily: root.fontFamily
          bordered: true
          horizontalPadding: Style.space(7)
          verticalPadding: Style.space(3)
          onClicked: root.reconnectRequested()
        }
      }
    }
  }
}
