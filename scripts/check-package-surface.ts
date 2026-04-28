import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface PackFile {
  path: string;
}

interface PackResult {
  files: PackFile[];
}

const blocked = [
  /\bBlueSkil\b/i,
  /\bFirebase\b/i,
  /\bFirestore\b/i,
  /\bNestJS\b/i,
  /\bStripe\b/i,
  /\bbackend-api\b/i,
  /\bflutter-e2e\b/i,
  /\bdev_infra\b/i,
  /\bToknize\b/i,
  /\bprimary_seeker\b/i,
  /\bprimary_employer\b/i,
  /\baccount\.primary_seeker\b/i,
  /\baccount\.primary_employer\b/i,
  /\bpackages\/blu-cli\b/i,
  /\bblu test\b/i,
  /\btest-seeker@blueskil\.test\b/i,
  /\btest-employer@blueskil\.test\b/i,
];

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const [pack] = JSON.parse(raw) as PackResult[];
const failures: string[] = [];

for (const file of pack.files) {
  const filePath = path.resolve(file.path);
  if (!fs.existsSync(filePath)) continue;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const pattern of blocked) {
    if (pattern.test(text)) {
      failures.push(`${file.path}: ${pattern.source}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Published package surface contains blocked product-specific strings:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Package surface check passed. Scanned ${pack.files.length} packed file(s).`);
