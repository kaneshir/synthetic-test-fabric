import 'dart:ui' show Rect;

/// Information about a widget with a Key, including its bounds.
class KeyedWidgetInfo {
  /// The key value as a string.
  final String key;

  /// The widget's bounds in screen coordinates.
  final Rect bounds;

  /// The widget's runtime type name.
  final String widgetType;

  /// Creates a new KeyedWidgetInfo.
  const KeyedWidgetInfo({
    required this.key,
    required this.bounds,
    required this.widgetType,
  });

  /// Converts this info to a JSON-serializable map.
  Map<String, dynamic> toJson() => {
        'key': key,
        'type': widgetType,
        'bounds': {
          'x': bounds.left,
          'y': bounds.top,
          'width': bounds.width,
          'height': bounds.height,
        },
      };

  /// Creates a KeyedWidgetInfo from a JSON map.
  factory KeyedWidgetInfo.fromJson(Map<String, dynamic> json) {
    final bounds = json['bounds'] as Map<String, dynamic>;
    return KeyedWidgetInfo(
      key: json['key'] as String,
      widgetType: json['type'] as String,
      bounds: Rect.fromLTWH(
        (bounds['x'] as num).toDouble(),
        (bounds['y'] as num).toDouble(),
        (bounds['width'] as num).toDouble(),
        (bounds['height'] as num).toDouble(),
      ),
    );
  }

  /// The center point of this widget's bounds.
  ({double x, double y}) get center => (
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      );

  @override
  String toString() =>
      'KeyedWidgetInfo(key: $key, type: $widgetType, bounds: $bounds)';
}
