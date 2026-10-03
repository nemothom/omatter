import QtQuick
import qs.Commons

// The discreet ⓘ that opens a device's details. Barely visible until hovered.
Text {
  id: root

  property QtObject bar: null
  property bool active: false

  signal clicked()

  readonly property color foreground: bar ? bar.foreground : Color.foreground

  textFormat: Text.PlainText
  text: String.fromCodePoint(active ? 0xF02FC : 0xF02FD) // information / information-outline
  color: foreground
  opacity: active ? 0.9 : (mouse.containsMouse ? 0.8 : 0.25)
  font.family: bar ? bar.fontFamily : Style.font.family
  font.pixelSize: Style.font.bodySmall

  Behavior on opacity { NumberAnimation { duration: 120 } }

  MouseArea {
    id: mouse
    anchors.fill: parent
    anchors.margins: -Style.space(5)
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }
}
