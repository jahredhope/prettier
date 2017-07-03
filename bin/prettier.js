#!/usr/bin/env node

"use strict";

const minimist = require("minimist");
const prettier = eval("require")("../index");

const CLIEngine = require("../src/cli-engine");

const argv = minimist(process.argv.slice(2), {
  boolean: [
    "write",
    "stdin",
    "use-tabs",
    "semi",
    "single-quote",
    "bracket-spacing",
    "jsx-bracket-same-line",
    // The supports-color package (a sub sub dependency) looks directly at
    // `process.argv` for `--no-color` and such-like options. The reason it is
    // listed here is to avoid "Ignored unknown option: --no-color" warnings.
    // See https://github.com/chalk/supports-color/#info for more information.
    "color",
    "list-different",
    "help",
    "version",
    "debug-print-doc",
    "debug-check",
    "with-node-modules",
    // Deprecated in 0.0.10
    "flow-parser"
  ],
  string: [
    "print-width",
    "tab-width",
    "parser",
    "trailing-comma",
    "cursor-offset",
    "range-start",
    "range-end",
    "stdin-filepath"
  ],
  default: {
    semi: true,
    color: true,
    "bracket-spacing": true,
    parser: "babylon"
  },
  alias: { help: "h", version: "v", "list-different": "l" },
  unknown: param => {
    if (param.startsWith("-")) {
      console.warn("Ignored unknown option: " + param + "\n");
      return false;
    }
  }
});

if (argv["version"]) {
  console.log(prettier.version);
  process.exit(0);
}

const filePatterns = argv["_"];
const write = argv["write"];
const stdin = argv["stdin"] || (!filePatterns.length && !process.stdin.isTTY);
const debugPrintDoc = argv["debug-print-doc"];
const debugCheck = argv["debug-check"];
const listDifferent = argv["list-different"];
const ignoreNodeModules = argv["with-node-modules"] === false;

function getParserOption() {
  const optionName = "parser";
  const value = argv[optionName];

  if (value === undefined) {
    return value;
  }

  // For backward compatibility. Deprecated in 0.0.10
  if (argv["flow-parser"]) {
    console.warn("`--flow-parser` is deprecated. Use `--parser flow` instead.");
    return "flow";
  }

  return value;
}

function getIntOption(optionName) {
  const value = argv[optionName];

  if (value === undefined) {
    return value;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  console.error(
    "Invalid --" +
      optionName +
      " value. Expected an integer, but received: " +
      JSON.stringify(value)
  );
  process.exit(1);
}

function getTrailingComma() {
  switch (argv["trailing-comma"]) {
    case undefined:
    case "none":
      return "none";
    case "":
      console.warn(
        "Warning: `--trailing-comma` was used without an argument. This is deprecated. " +
          'Specify "none", "es5", or "all".'
      );
      return "es5";
    case "es5":
      return "es5";
    case "all":
      return "all";
    default:
      throw new Error("Invalid option for --trailing-comma");
  }
}

const options = {
  cursorOffset: getIntOption("cursor-offset"),
  rangeStart: getIntOption("range-start"),
  rangeEnd: getIntOption("range-end"),
  useTabs: argv["use-tabs"],
  semi: argv["semi"],
  printWidth: getIntOption("print-width"),
  tabWidth: getIntOption("tab-width"),
  bracketSpacing: argv["bracket-spacing"],
  singleQuote: argv["single-quote"],
  jsxBracketSameLine: argv["jsx-bracket-same-line"],
  filepath: argv["stdin-filepath"],
  trailingComma: getTrailingComma(),
  parser: getParserOption()
};

if (argv["help"] || (!filePatterns.length && !stdin)) {
  console.log(
    "Usage: prettier [opts] [filename ...]\n\n" +
      "Available options:\n" +
      "  --write                  Edit the file in-place. (Beware!)\n" +
      "  --list-different or -l   Print filenames of files that are different from Prettier formatting.\n" +
      "  --stdin                  Read input from stdin.\n" +
      "  --stdin-filepath         Path to the file used to read from stdin.\n" +
      "  --print-width <int>      Specify the length of line that the printer will wrap on. Defaults to 80.\n" +
      "  --tab-width <int>        Specify the number of spaces per indentation-level. Defaults to 2.\n" +
      "  --use-tabs               Indent lines with tabs instead of spaces.\n" +
      "  --no-semi                Do not print semicolons, except at the beginning of lines which may need them.\n" +
      "  --single-quote           Use single quotes instead of double quotes.\n" +
      "  --no-bracket-spacing     Do not print spaces between brackets.\n" +
      "  --jsx-bracket-same-line  Put > on the last line instead of at a new line.\n" +
      "  --trailing-comma <none|es5|all>\n" +
      "                           Print trailing commas wherever possible. Defaults to none.\n" +
      "  --parser <flow|babylon|typescript|postcss|json>\n" +
      "                           Specify which parse to use. Defaults to babylon.\n" +
      "  --cursor-offset <int>    Print (to stderr) where a cursor at the given position would move to after formatting.\n" +
      "                           This option cannot be used with --range-start and --range-end\n" +
      "  --range-start <int>      Format code starting at a given character offset.\n" +
      "                           The range will extend backwards to the start of the first line containing the selected statement.\n" +
      "                           This option cannot be used with --cursor-offset.\n" +
      "                           Defaults to 0.\n" +
      "  --range-end <int>        Format code ending at a given character offset (exclusive).\n" +
      "                           The range will extend forwards to the end of the selected statement.\n" +
      "                           This option cannot be used with --cursor-offset.\n" +
      "                           Defaults to Infinity.\n" +
      "  --no-color               Do not colorize error messages.\n" +
      "  --with-node-modules      Process files inside `node_modules` directory.\n" +
      "  --version or -v          Print Prettier version.\n" +
      "\n"
  );
  process.exit(argv["help"] ? 0 : 1);
}

const cli = new CLIEngine({
  debugCheck,
  debugPrintDoc,
  filePatterns,
  ignoreNodeModules,
  listDifferent,
  stdin,
  write
});

cli.execute(options);
