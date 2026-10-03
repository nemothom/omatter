import QtQuick
import QtQuick.Shapes

// The Matter symbol (three-part mark from the Matter connectivity standard
// logo), drawn as a vector so it takes the bar's colour and stays crisp.
// Path taken from the symbol part of "Logo of Matter connectivity standard.svg"
// on Wikimedia Commons (viewBox cropped to 0 0 74.4 72.7). Matter is a
// trademark of the Connectivity Standards Alliance.
Item {
  id: root

  property real iconSize: 16
  property color color: "white"

  implicitWidth: iconSize
  implicitHeight: iconSize
  width: iconSize
  height: iconSize

  readonly property real viewWidth: 74.4
  readonly property real viewHeight: 72.7
  readonly property real fit: Math.min(width / viewWidth, height / viewHeight)

  Shape {
    width: root.viewWidth
    height: root.viewHeight
    anchors.centerIn: parent
    scale: root.fit
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      fillColor: root.color
      strokeWidth: -1
      PathSvg {
        path: "M65.715 32.905c-7.996 2.19-15.164 7.406-19.636 15.152s-5.407 16.568-3.306 24.587l7.835-4.526a23.9 23.9 0 0 1 1.105-11.836l18.309 10.569 4.303-2.487v-4.967L56.016 48.829a23.92 23.92 0 0 1 9.699-6.879zm-57.108 0v9.045a23.91 23.91 0 0 1 9.699 6.879L0 59.398v4.967l4.303 2.487 18.306-10.569c1.39 3.868 1.726 7.938 1.108 11.836l7.832 4.526c2.101-8.02 1.167-16.841-3.306-24.587A32.52 32.52 0 0 0 8.607 32.905zM37.161 0l-4.303 2.484v21.138c-4.046-.731-7.736-2.476-10.804-4.961l-7.838 4.522c5.895 5.83 14 9.429 22.946 9.429s17.051-3.599 22.946-9.429l-7.835-4.522a23.92 23.92 0 0 1-10.807 4.961V2.484z"
      }
    }
  }
}
