import * as fs from 'fs';
import * as path from 'path';
import {
  buildReport,
  evaluateCase,
  formatReportTable,
  runPipeline,
} from '../../src/modules/career/resume-golden/career-resume-eval.util';
import {
  EvalPipelineMode,
  GoldenResumeCase,
} from '../../src/modules/career/resume-golden/career-resume-eval.types';

const CASES_DIR = path.join(__dirname, 'cases');
const REPORT_DIR = path.join(__dirname, 'reports');

function loadCases(): GoldenResumeCase[] {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  return files
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf8')) as GoldenResumeCase);
}

function parseMode(argv: string[]): EvalPipelineMode {
  const flag = argv.find((a) => a.startsWith('--pipeline='));
  const value = flag?.split('=')[1] ?? 'heuristic';
  if (value === 'heuristic' || value === 'merged' || value === 'ai-only') {
    return value;
  }
  console.error(`Unknown pipeline "${value}". Use heuristic | merged | ai-only`);
  process.exit(1);
}

function main(): void {
  const mode = parseMode(process.argv.slice(2));
  const writeJson = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');
  const minScore = 0.75;

  const cases = loadCases();
  if (cases.length === 0) {
    console.error('No golden cases found in scripts/resume-golden/cases/');
    process.exit(1);
  }

  const results = cases.map((caseDef) => {
    const parsed = runPipeline(caseDef, mode);
    return evaluateCase(caseDef, parsed, mode);
  });

  const report = buildReport(results, mode);
  const table = formatReportTable(report);

  console.log(table);

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const stamp = report.runAt.replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `baseline-${mode}-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('');
  console.log(`Report written: ${reportPath}`);

  if (writeJson) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (strict && report.aggregates.overallScore < minScore) {
    console.error(`\nFAIL: overall ${pct(report.aggregates.overallScore)} < ${pct(minScore)}`);
    process.exit(1);
  }
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

main();
