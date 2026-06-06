// Web-specific JS bridge implementation for TestKeyDebugService.
// This file exposes Dart functions to JavaScript for browser automation.
//
// After calling TestKeyDebugService.instance.setupJsBridge(), these become available:
// - window.__flutter_tap('keyName') -> boolean
// - window.__flutter_type('keyName', 'text') -> boolean (injects text directly!)
// - window.__flutter_keys() -> JSON string of all keys
// - window.__flutter_sequence([...]) -> JSON string with results

import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'test_key_debug_service.dart';

/// Extension on TestKeyDebugService to add web-specific JS bridge setup.
extension TestKeyDebugServiceWebExt on TestKeyDebugService {
  /// Set up the JavaScript bridge by exposing functions on window object.
  void setupWebBridge() {
    final window = globalContext;

    // Expose __flutter_tap(keyName) -> bool
    window['__flutter_tap'] = ((JSString keyName) {
      final result = tapByKey(keyName.toDart);
      return result.toJS;
    }).toJS;

    // Expose __flutter_type(keyName, text) -> bool
    // Now actually injects text into TextFields!
    window['__flutter_type'] = ((JSString keyName, JSString text) {
      final result = typeByKey(keyName.toDart, text.toDart);
      return result.toJS;
    }).toJS;

    // Expose __flutter_keys() -> JSON string
    window['__flutter_keys'] = (() {
      final json = toJson();
      return json.toJS;
    }).toJS;

    // Expose __flutter_sequence(actionsJson) -> JSON string
    // Execute multiple actions in ONE call!
    // Input: JSON array like [{"action":"type","key":"email","text":"a@b.com"},{"action":"tap","key":"btn"}]
    window['__flutter_sequence'] = ((JSString actionsJson) {
      try {
        final List<dynamic> actions = jsonDecode(actionsJson.toDart);
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
                results.add({
                  'success': false,
                  'error': 'type action requires text',
                  'key': keyName
                });
                continue;
              }
              success = typeByKey(keyName, text);
              break;
            default:
              results.add({'success': false, 'error': 'unknown action: $actionType'});
              continue;
          }

          results.add({'key': keyName, 'action': actionType, 'success': success});
        }

        return jsonEncode({
          'executed': results.length,
          'results': results,
        }).toJS;
      } catch (e) {
        return jsonEncode({'error': e.toString()}).toJS;
      }
    }).toJS;

    // Expose __flutter_dumpKeys() -> bool
    // Returns false if service disabled, true if dump scheduled.
    // Chrome MCP should ALWAYS call this after navigation regardless of route value.
    window['__flutter_dumpKeys'] = (() {
      if (!enabled || !dumpToConsole) return false.toJS;
      dumpKeysAfterFrame(delay: const Duration(milliseconds: 300));
      return true.toJS;
    }).toJS;

    // Expose __flutter_getRoute() -> string
    // Returns 'unknown' if app doesn't set TestKeyDebugService.getCurrentRoute callback.
    // This is informational only - MCP should call __flutter_dumpKeys() regardless.
    window['__flutter_getRoute'] = (() {
      final callback = getCurrentRoute;
      return (callback != null ? callback() : 'unknown').toJS;
    }).toJS;

    // Expose ready flag
    window['__flutter_bridge_ready'] = true.toJS;

    // Log that bridge is ready
    // ignore: avoid_print
    print('Flutter JS Bridge ready! Available functions:');
    // ignore: avoid_print
    print('  - __flutter_tap(keyName) -> bool');
    // ignore: avoid_print
    print('  - __flutter_type(keyName, text) -> bool (injects text!)');
    // ignore: avoid_print
    print('  - __flutter_keys() -> JSON string');
    // ignore: avoid_print
    print('  - __flutter_sequence(actionsJson) -> JSON (batch actions!)');
    // ignore: avoid_print
    print('  - __flutter_dumpKeys() -> bool (trigger KEYS_JSON dump)');
    // ignore: avoid_print
    print('  - __flutter_getRoute() -> string (current route)');
  }
}
// Force recompile: Fri Dec 26 20:47:25 PST 2025
