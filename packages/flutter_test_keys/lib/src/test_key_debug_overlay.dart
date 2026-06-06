import 'package:flutter/material.dart';

import 'keyed_widget_info.dart';
import 'test_key_debug_service.dart';

/// A visual overlay that shows key labels above each keyed widget.
///
/// Wrap your app with this widget to see all widget keys visually:
/// ```dart
/// TestKeyDebugOverlay(child: MyApp())
/// ```
///
/// Enable via URL: `?showKeys=true`
class TestKeyDebugOverlay extends StatefulWidget {
  final Widget child;

  const TestKeyDebugOverlay({super.key, required this.child});

  @override
  State<TestKeyDebugOverlay> createState() => _TestKeyDebugOverlayState();
}

class _TestKeyDebugOverlayState extends State<TestKeyDebugOverlay> {
  Map<String, KeyedWidgetInfo> _keys = {};

  @override
  void initState() {
    super.initState();
    _scheduleKeyRefresh();
  }

  void _scheduleKeyRefresh() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && TestKeyDebugService.instance.showOverlay) {
        setState(() {
          _keys = TestKeyDebugService.instance.getAllKeys();
        });
        // Keep refreshing to catch navigation changes
        Future.delayed(const Duration(milliseconds: 500), _scheduleKeyRefresh);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!TestKeyDebugService.instance.enabled ||
        !TestKeyDebugService.instance.showOverlay) {
      return widget.child;
    }

    // Self-sufficient Directionality: consumers commonly wrap this ABOVE
    // MaterialApp (e.g. TestKeyDebugOverlay(child: MyApp())) where no
    // Directionality ancestor exists yet — without this the Stack throws
    // "No Directionality widget found" and the whole app renders the
    // red error screen whenever ?showKeys=true is used.
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Stack(
        children: [
          widget.child,
          // Overlay layer - ignore pointer so it doesn't block interactions
          IgnorePointer(
            child: CustomPaint(
              painter: _KeyOverlayPainter(_keys),
              size: Size.infinite,
            ),
          ),
        ],
      ),
    );
  }
}

class _KeyOverlayPainter extends CustomPainter {
  final Map<String, KeyedWidgetInfo> keys;

  _KeyOverlayPainter(this.keys);

  @override
  void paint(Canvas canvas, Size size) {
    final labelPaint = Paint()
      ..color = const Color(0xE6FFEB3B) // Yellow with 90% opacity
      ..style = PaintingStyle.fill;

    final borderPaint = Paint()
      ..color = const Color(0x80FF5722) // Orange border, 50% opacity
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.5; // Thin as possible

    final textStyle = TextStyle(
      color: Colors.black87,
      fontSize: 7, // Small as possible while readable
      fontWeight: FontWeight.w500,
      fontFamily: 'monospace',
    );

    for (final entry in keys.entries) {
      final key = entry.key;
      final info = entry.value;

      // Skip internal/scaffold keys
      if (key.startsWith('_') || key.contains('Scaffold')) continue;

      // Draw border around widget
      canvas.drawRect(info.bounds, borderPaint);

      // Draw label background
      final textSpan = TextSpan(text: key, style: textStyle);
      final textPainter = TextPainter(
        text: textSpan,
        textDirection: TextDirection.ltr,
      )..layout();

      final labelRect = Rect.fromLTWH(
        info.bounds.left,
        info.bounds.top - 10,
        textPainter.width + 4,
        9,
      );

      canvas.drawRRect(
        RRect.fromRectAndRadius(labelRect, const Radius.circular(2)),
        labelPaint,
      );

      // Draw label text
      textPainter.paint(
        canvas,
        Offset(info.bounds.left + 2, info.bounds.top - 9),
      );
    }
  }

  @override
  bool shouldRepaint(_KeyOverlayPainter oldDelegate) {
    return oldDelegate.keys != keys;
  }
}
