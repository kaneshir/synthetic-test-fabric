import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import 'keyed_widget_info.dart';
import 'test_key_debug_service_bridge.dart'
    if (dart.library.js_interop) 'test_key_debug_service_web.dart';

/// A debug service that walks Flutter's widget tree and extracts
/// all widgets with Keys along with their screen coordinates/bounds.
///
/// This service is designed for AI-assisted testing, allowing external
/// tools (like Claude with Chrome automation) to identify interactive
/// elements by their keys and click at the correct coordinates.
///
/// Example usage:
/// ```dart
/// // Enable the service (typically in dev/test builds only)
/// TestKeyDebugService.instance.enabled = true;
///
/// // Get all keyed widgets
/// final keys = TestKeyDebugService.instance.getAllKeys();
/// print('Found ${keys.length} keyed widgets');
///
/// // Export to JSON for external consumption
/// final json = TestKeyDebugService.instance.toJson();
/// ```

/// Prefix used for console dumps, allowing Claude to filter logs.
const String keysJsonPrefix = 'KEYS_JSON:';

class TestKeyDebugService {
  /// Singleton instance.
  static final instance = TestKeyDebugService._();

  TestKeyDebugService._();

  /// Whether the service is enabled.
  /// When disabled, [getAllKeys] returns an empty map for performance.
  bool enabled = false;

  /// Whether to show visual overlay labels above keyed widgets.
  /// Requires [enabled] to also be true.
  bool showOverlay = false;

  /// Whether to dump keys JSON to console on [dumpKeys] calls.
  /// Requires [enabled] to also be true.
  bool dumpToConsole = false;

  /// Optional callback to get the current route name.
  /// Set this to customize how the route is determined.
  String Function()? getCurrentRoute;

  /// Initializes from URL parameters (for web).
  /// Call this early in your app initialization.
  ///
  /// Recognizes:
  /// - `?showKeys=true` - enables both service and visual overlay
  /// - `?dumpKeys=true` - enables service and console dumps
  void initFromUri(Uri uri) {
    final showKeys = uri.queryParameters['showKeys'] == 'true';
    final dumpKeys = uri.queryParameters['dumpKeys'] == 'true';

    if (showKeys || dumpKeys) {
      enabled = true;
      showOverlay = showKeys;
      dumpToConsole = dumpKeys;
    }
  }

  /// Walks the widget tree and returns all keyed widgets with bounds.
  ///
  /// Only captures widgets with [ValueKey] - ignores [ObjectKey], [UniqueKey], etc.
  /// Returns an empty map if [enabled] is false.
  Map<String, KeyedWidgetInfo> getAllKeys() {
    if (!enabled) return {};

    final results = <String, KeyedWidgetInfo>{};
    final binding = WidgetsBinding.instance;

    void visit(Element element) {
      final key = element.widget.key;
      if (key != null && key is ValueKey) {
        final renderObject = element.renderObject;
        if (renderObject is RenderBox && renderObject.hasSize) {
          try {
            final position = renderObject.localToGlobal(Offset.zero);
            final keyValue = key.value?.toString() ?? '';
            if (keyValue.isNotEmpty) {
              results[keyValue] = KeyedWidgetInfo(
                key: keyValue,
                bounds: Rect.fromLTWH(
                  position.dx,
                  position.dy,
                  renderObject.size.width,
                  renderObject.size.height,
                ),
                widgetType: element.widget.runtimeType.toString(),
              );
            }
          } catch (e) {
            // Widget not yet laid out or detached - skip it
            if (kDebugMode) {
              debugPrint('TestKeyDebugService: Skipped ${key.value}: $e');
            }
          }
        }
      }
      element.visitChildren(visit);
    }

    final rootElement = binding.rootElement;
    if (rootElement != null) {
      rootElement.visitChildren(visit);
    }

    return results;
  }

  /// Gets the current route name.
  String _getCurrentRoute() {
    if (getCurrentRoute != null) {
      return getCurrentRoute!();
    }
    // Default: try to extract from the navigator
    return 'unknown';
  }

  /// Exports all keys to JSON format.
  ///
  /// Format:
  /// ```json
  /// {
  ///   "timestamp": "2024-12-19T10:30:00Z",
  ///   "route": "/jobs",
  ///   "elements": [
  ///     {"key": "job-card-0", "type": "JobCard", "bounds": {...}},
  ///     ...
  ///   ]
  /// }
  /// ```
  String toJson() {
    final keys = getAllKeys();
    return jsonEncode({
      'timestamp': DateTime.now().toIso8601String(),
      'route': _getCurrentRoute(),
      'elements': keys.values.map((k) => k.toJson()).toList(),
    });
  }

  /// Exports all keys to a pretty-printed JSON format (for debugging).
  String toPrettyJson() {
    final keys = getAllKeys();
    final encoder = const JsonEncoder.withIndent('  ');
    return encoder.convert({
      'timestamp': DateTime.now().toIso8601String(),
      'route': _getCurrentRoute(),
      'elements': keys.values.map((k) => k.toJson()).toList(),
    });
  }

  /// Finds a widget by its key value.
  /// Returns null if not found or service is disabled.
  KeyedWidgetInfo? findByKey(String keyValue) {
    return getAllKeys()[keyValue];
  }

  /// Finds all widgets matching a pattern (case-insensitive contains).
  List<KeyedWidgetInfo> findByPattern(String pattern) {
    final lowercasePattern = pattern.toLowerCase();
    return getAllKeys()
        .values
        .where((info) => info.key.toLowerCase().contains(lowercasePattern))
        .toList();
  }

  /// Finds all widgets of a specific type.
  List<KeyedWidgetInfo> findByType(String typeName) {
    return getAllKeys()
        .values
        .where((info) => info.widgetType == typeName)
        .toList();
  }

  /// Finds the Element for a widget by its key value.
  /// Returns null if not found.
  Element? findElementByKey(String keyValue) {
    if (!enabled) return null;

    final binding = WidgetsBinding.instance;
    Element? result;

    void visit(Element element) {
      if (result != null) return; // Already found
      final key = element.widget.key;
      if (key is ValueKey && key.value?.toString() == keyValue) {
        result = element;
        return;
      }
      element.visitChildren(visit);
    }

    final rootElement = binding.rootElement;
    if (rootElement != null) {
      rootElement.visitChildren(visit);
    }

    return result;
  }

  /// Finds an EditableTextState within an element's subtree.
  /// Used for text injection into TextFields.
  EditableTextState? _findEditableTextState(Element element) {
    EditableTextState? result;

    void visit(Element e) {
      if (result != null) return;
      if (e is StatefulElement && e.state is EditableTextState) {
        result = e.state as EditableTextState;
        return;
      }
      e.visitChildren(visit);
    }

    visit(element);
    return result;
  }

  /// Dumps the current keys to console with the [keysJsonPrefix].
  ///
  /// Call this after navigation or frame settle. Claude can read this
  /// using `mcp__claude-in-chrome__read_console_messages` with pattern `KEYS_JSON:`.
  ///
  /// Only dumps if [enabled] and [dumpToConsole] are both true.
  void dumpKeys() {
    if (!enabled || !dumpToConsole) return;

    // Use print() which goes to browser console on web
    // ignore: avoid_print
    print('$keysJsonPrefix${toJson()}');
  }

  /// Schedules a key dump after the current frame settles.
  ///
  /// Use this when you want to dump keys after a navigation or state change
  /// has finished rendering.
  ///
  /// [delay] - Optional delay after the frame callback before dumping.
  /// Useful for waiting for animations to complete (e.g., 300ms for route transitions).
  void dumpKeysAfterFrame({Duration delay = Duration.zero}) {
    if (!enabled || !dumpToConsole) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (delay == Duration.zero) {
        dumpKeys();
      } else {
        Future.delayed(delay, dumpKeys);
      }
    });
  }

  // ============================================================
  // JS Bridge for Chrome MCP automation (Option B)
  // Allows key-based taps from JavaScript without coordinates
  // ============================================================

  /// Set up JavaScript bridge for browser automation.
  /// Call this during app initialization to enable `__flutter_tap(keyName)` etc.
  void setupJsBridge() {
    // ignore: avoid_print
    print('setupJsBridge called, kIsWeb=$kIsWeb');
    if (!kIsWeb) return;
    // ignore: avoid_print
    print('setupJsBridge: calling setupWebBridge...');
    // Uses extension from conditional import - explicit 'this' required
    this.setupWebBridge();
    // ignore: avoid_print
    print('setupJsBridge: setupWebBridge completed');
  }

  /// Tap a widget by its key name.
  /// Returns true if key was found and tapped, false otherwise.
  bool tapByKey(String keyName) {
    final info = findByKey(keyName);
    if (info == null) {
      debugPrint('tapByKey: key "$keyName" not found');
      return false;
    }
    final center = info.center;
    _dispatchTap(center.x, center.y);
    debugPrint('tapByKey: tapped "$keyName" at (${center.x}, ${center.y})');
    return true;
  }

  /// Type text into a widget by its key name.
  /// Finds the EditableTextState and injects text directly.
  /// Returns true if text was successfully injected, false otherwise.
  bool typeByKey(String keyName, String text) {
    final element = findElementByKey(keyName);
    if (element == null) {
      debugPrint('typeByKey: key "$keyName" not found');
      return false;
    }

    final editableState = _findEditableTextState(element);
    if (editableState == null) {
      // Fallback: tap to focus, let Chrome type
      debugPrint('typeByKey: no EditableTextState for "$keyName", falling back to tap');
      final info = findByKey(keyName);
      if (info != null) {
        _dispatchTap(info.center.x, info.center.y);
      }
      return false;
    }

    // Inject text directly into the EditableTextState
    final newValue = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    editableState.updateEditingValue(newValue);
    debugPrint('typeByKey: injected "$text" into "$keyName"');
    return true;
  }

  /// Execute a sequence of actions in a single call.
  /// Each action is a map with 'action' (tap/type/focus) and 'key'.
  /// For 'type', also include 'text' with the value to inject.
  ///
  /// Example:
  /// ```dart
  /// executeSequence([
  ///   {'action': 'type', 'key': 'email_input', 'text': 'user@example.com'},
  ///   {'action': 'type', 'key': 'password_input', 'text': 'secret123'},
  ///   {'action': 'tap', 'key': 'login_button'},
  /// ])
  /// ```
  Future<Map<String, dynamic>> executeSequence(
      List<Map<String, dynamic>> actions) async {
    final results = <Map<String, dynamic>>[];
    for (final action in actions) {
      final actionType = action['action'] as String?;
      final keyName = action['key'] as String?;
      final text = action['text'] as String?;

      if (keyName == null) {
        results.add({'success': false, 'error': 'missing key'});
        continue;
      }

      bool success = false;
      switch (actionType) {
        case 'tap':
        case 'focus':
          success = tapByKey(keyName);
          break;
        case 'type':
          if (text == null) {
            results.add({'success': false, 'error': 'type action requires text', 'key': keyName});
            continue;
          }
          success = typeByKey(keyName, text);
          break;
        default:
          results.add({'success': false, 'error': 'unknown action: $actionType'});
          continue;
      }

      results.add({'key': keyName, 'action': actionType, 'success': success});

      // Small delay between actions for UI to update
      await Future.delayed(const Duration(milliseconds: 50));
    }

    return {
      'executed': results.length,
      'results': results,
    };
  }

  /// Dispatch a tap at the given coordinates using GestureBinding.
  void _dispatchTap(double x, double y) {
    final binding = GestureBinding.instance;
    final position = Offset(x, y);
    final pointerId = DateTime.now().microsecondsSinceEpoch % 0x7FFFFFFF;

    binding.handlePointerEvent(
      PointerDownEvent(
        pointer: pointerId,
        position: position,
        kind: PointerDeviceKind.touch,
      ),
    );
    binding.handlePointerEvent(
      PointerUpEvent(
        pointer: pointerId,
        position: position,
        kind: PointerDeviceKind.touch,
      ),
    );
  }
}
