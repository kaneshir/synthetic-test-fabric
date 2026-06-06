// Stub implementation for non-web platforms.
// The actual JS bridge is in test_key_debug_service_web.dart

import 'test_key_debug_service.dart';

/// Extension on TestKeyDebugService - stub for non-web platforms.
extension TestKeyDebugServiceWebExt on TestKeyDebugService {
  /// No-op on non-web platforms.
  void setupWebBridge() {
    // JS bridge is only available on web
  }
}
