import QtQuick
import qs.Commons
import qs.Ui

// Compact row used in arrange mode: glyph, label and up/down arrows.
Item {
  id: root

  property QtObject bar: null
  property string glyph: ""
  property string label: ""
  property bool heading: false     // room rows read as section headers
  property bool canMoveUp: true
  property bool canMoveDown: true

  signal moveUp()
  signal moveDown()

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  implicitHeight: Math.max(labelText.implicitHeight, upButton.height)

  Text {
    id: glyphText
    visible: root.glyph !== ""
    anchors.left: parent.left
    anchors.leftMargin: root.heading ? 0 : Style.space(12)
    anchors.verticalCenter: parent.verticalCenter
    width: visible ? Style.space(20) : 0
    textFormat: Text.PlainText
    text: root.glyph
    color: root.foreground
    opacity: 0.6
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Text {
    id: labelText
    anchors.left: glyphText.visible ? glyphText.right : parent.left
    anchors.leftMargin: glyphText.visible ? 0 : (root.heading ? 0 : Style.space(12))
    anchors.right: arrows.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    textFormat: Text.PlainText
    text: root.heading ? root.label.toUpperCase() : root.label
    color: root.foreground
    opacity: root.heading ? 0.75 : 1
    font.family: root.fontFamily
    font.pixelSize: root.heading ? Style.font.caption : Style.font.body
    font.bold: root.heading
    font.letterSpacing: root.heading ? 1.2 : 0
    elide: Text.ElideRight
  }

  Row {
    id: arrows
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    PanelActionButton {
      id: upButton
      iconText: String.fromCodePoint(0xF0143) // chevron-up
      tooltipText: root.heading ? "Move room up" : "Move up"
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      enabled: root.canMoveUp
      opacity: enabled ? 1 : 0.2
      onClicked: root.moveUp()
    }
    PanelActionButton {
      iconText: String.fromCodePoint(0xF0140) // chevron-down
      tooltipText: root.heading ? "Move room down" : "Move down"
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      enabled: root.canMoveDown
      opacity: enabled ? 1 : 0.2
      onClicked: root.moveDown()
    }
  }
}
