import 'package:flutter/widgets.dart';

import 'test_key_debug_service.dart';

/// A NavigatorObserver that automatically dumps keys after each navigation.
///
/// Add this to your MaterialApp's navigatorObservers:
/// ```dart
/// MaterialApp(
///   navigatorObservers: [
///     if (TestKeyDebugService.instance.dumpToConsole)
///       TestKeyNavigatorObserver(),
///   ],
/// )
/// ```
///
/// Or for GoRouter:
/// ```dart
/// GoRouter(
///   observers: [
///     if (TestKeyDebugService.instance.dumpToConsole)
///       TestKeyNavigatorObserver(),
///   ],
/// )
/// ```
class TestKeyNavigatorObserver extends NavigatorObserver {
  /// Delay before dumping keys after navigation.
  /// Allows time for animations and widget tree to settle.
  final Duration delay;

  TestKeyNavigatorObserver({
    this.delay = const Duration(milliseconds: 300),
  });

  void _dumpKeysAfterDelay() {
    if (!TestKeyDebugService.instance.enabled) return;

    Future.delayed(delay, () {
      TestKeyDebugService.instance.dumpKeys();
    });
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _dumpKeysAfterDelay();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    _dumpKeysAfterDelay();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    _dumpKeysAfterDelay();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didRemove(route, previousRoute);
    _dumpKeysAfterDelay();
  }
}
