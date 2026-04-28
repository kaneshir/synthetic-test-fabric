---
name: flutter-test-generator
description: |
  Generate Flutter integration tests from Chrome exploration sessions.
  Converts KEYS_JSON widget-key logs into runnable flutter_test code.
  Triggers: "generate flutter test from exploration", "convert exploration to test",
  "write flutter test for this journey", "create integration test from keys"
allowed-tools: Bash, Read, Write, Glob, mcp__claude-in-chrome__read_console_messages
---

# Flutter Test Generator

Generate Flutter integration tests from Claude Chrome exploration sessions.

## Triggers
- "generate flutter test from exploration"
- "convert exploration to test"
- "write flutter test for this journey"
- "create integration test from keys"

## Description

Converts a Chrome exploration session (using TestKeyDebugService widget keys) into a
runnable Flutter integration test.

## Workflow

### Step 1: Collect Exploration Data
If not provided, ask the user for:
1. Journey name (e.g., `seeker_apply`, `employer_post_job`)
2. The exploration steps performed

Or read directly from Chrome console:
```
mcp__claude-in-chrome__read_console_messages (pattern: "KEYS_JSON")
```

### Step 2: Build Exploration Log
Structure the exploration as:
```json
{
  "journey": "journey_name",
  "steps": [
    {"action": "click", "key": "element_key"},
    {"action": "type", "key": "input_key", "value": "text to enter"},
    {"action": "wait", "duration": 500},
    {"action": "assert", "key": "element_key", "visible": true}
  ]
}
```

### Step 3: Generate Flutter Test

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('{JourneyName} Journey', () {
    testWidgets('{description}', (tester) async {
      // App setup — replace MyApp() with your project's entry point
      await tester.pumpWidget(const MyApp());
      await tester.pumpAndSettle();

      // Generated steps
      {steps}
    });
  });
}
```

### Step 4: Write to File
Save to: `integration_test/generated/{journey_name}_test.dart`

---

## Code Generation Rules

### Click
```dart
await tester.tap(find.byKey(const Key('{key}')));
await tester.pumpAndSettle();
```

### Type
```dart
await tester.enterText(find.byKey(const Key('{key}')), '{value}');
await tester.pumpAndSettle();
```

### Wait
```dart
await tester.pump(const Duration(milliseconds: {duration}));
```

### Scroll
```dart
await tester.scrollUntilVisible(find.byKey(const Key('{key}')), 500.0);
await tester.pumpAndSettle();
```

### Assert visible / not visible
```dart
expect(find.byKey(const Key('{key}')), findsOneWidget);
expect(find.byKey(const Key('{key}')), findsNothing);
expect(find.text('{text}'), findsOneWidget);
```

---

## Example Input → Output

**Input (Exploration Log)**
```json
{
  "journey": "seeker_login",
  "steps": [
    {"action": "type", "key": "login_email_input", "value": "test@example.com"},
    {"action": "type", "key": "login_password_input", "value": "password123"},
    {"action": "click", "key": "login_signin_button"},
    {"action": "wait", "duration": 2000},
    {"action": "assert", "key": "home_screen", "visible": true}
  ]
}
```

**Output (Flutter Test)**
```dart
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  group('Seeker Login Journey', () {
    testWidgets('can login with email and password', (tester) async {
      await tester.pumpWidget(const MyApp());
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('login_email_input')), 'test@example.com');
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('login_password_input')), 'password123');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('login_signin_button')));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 2000));
      expect(find.byKey(const Key('home_screen')), findsOneWidget);
    });
  });
}
```

---

## File Organization

```
integration_test/
├── generated/           # Auto-generated from exploration
│   ├── login_test.dart
│   └── apply_test.dart
├── journeys/            # Manual journey definitions
└── lisa_test.dart       # Main entry point
```

## Notes

- Keys must exist in the app — use `?showKeys=true` to verify before generating
- Generated tests are a starting point; add project-specific imports and auth setup
- Use `pumpAndSettle()` after most actions to wait for animations
