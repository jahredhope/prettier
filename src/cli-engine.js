"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const chalk = require("chalk");
const getStream = require("get-stream");
const glob = require("glob");
const cleanAST = require("../src/clean-ast.js").cleanAST;
const prettier = eval("require")("../index");

function formatContent(input, opt, debugOptions) {
  const debugPrintDoc = debugOptions && debugOptions.debugPrintDoc;
  const debugCheck = debugOptions && debugOptions.debugCheck;
  if (debugPrintDoc) {
    const doc = prettier.__debug.printToDoc(input, opt);
    return prettier.__debug.formatDoc(doc);
  }

  if (debugCheck) {
    function diff(a, b) {
      return require("diff").createTwoFilesPatch("", "", a, b, "", "", {
        context: 2
      });
    }

    const pp = prettier.format(input, opt);
    const pppp = prettier.format(pp, opt);
    if (pp !== pppp) {
      throw "prettier(input) !== prettier(prettier(input))\n" + diff(pp, pppp);
    } else {
      const ast = cleanAST(prettier.__debug.parse(input, opt));
      const past = cleanAST(prettier.__debug.parse(pp, opt));

      if (ast !== past) {
        const MAX_AST_SIZE = 2097152; // 2MB
        const astDiff = ast.length > MAX_AST_SIZE || past.length > MAX_AST_SIZE
          ? "AST diff too large to render"
          : diff(ast, past);
        throw "ast(input) !== ast(prettier(input))\n" +
          astDiff +
          "\n" +
          diff(input, pp);
      }
    }
    return { formatted: opt.filepath || "(stdin)\n" };
  }

  return prettier.formatWithCursor(input, opt);
}

function handleError(filename, e) {
  const isParseError = Boolean(e && e.loc);
  const isValidationError = /Validation Error/.test(e && e.message);

  // For parse errors and validation errors, we only want to show the error
  // message formatted in a nice way. `String(e)` takes care of that. Other
  // (unexpected) errors are passed as-is as a separate argument to
  // `console.error`. That includes the stack trace (if any), and shows a nice
  // `util.inspect` of throws things that aren't `Error` objects. (The Flow
  // parser has mistakenly thrown arrays sometimes.)
  if (isParseError) {
    console.error(filename + ": " + String(e));
  } else if (isValidationError) {
    console.error(String(e));
    // If validation fails for one file, it will fail for all of them.
    process.exit(1);
  } else {
    console.error(filename + ":", e.stack || e);
  }

  // Don't exit the process if one file failed
  process.exitCode = 2;
}

module.exports = class CLIEngine {
  constructor(cliOptions) {
    this.debugCheck = cliOptions.debugCheck;
    this.debugPrintDoc = cliOptions.debugPrintDoc;
    this.filePatterns = cliOptions.filePatterns;
    this.ignoreNodeModules = cliOptions.ignoreNodeModules;
    this.listDifferent = cliOptions.listDifferent;
    this.stdin = cliOptions.stdin;
    this.writeToFiles = cliOptions.write;
  }
  check(prettierOptions) {
    this.write = false;
    this.listDifferent = true;
    return this.execute(prettierOptions);
  }
  write(prettierOptions) {
    this.write = true;
    return this.execute(prettierOptions);
  }
  execute(prettierOptions) {
    const debugCheck = this.debugCheck;
    const debugPrintDoc = this.debugPrintDoc;
    const listDifferent = this.listDifferent;
    const ignoreNodeModules = this.ignoreNodeModules;
    const stdin = this.stdin;
    const filePatterns = this.filePatterns;
    const writeToFiles = this.writeToFiles;

    prettierOptions = prettierOptions || {};

    if (writeToFiles && debugCheck) {
      console.error("Cannot use --write and --debug-check together.");
      process.exit(1);
    }

    function writeOutput(result) {
      // Don't use `console.log` here since it adds an extra newline at the end.
      process.stdout.write(result.formatted);

      if (prettierOptions.cursorOffset) {
        process.stderr.write(result.cursorOffset + "\n");
      }
    }

    function handleFile(filename) {
      if (writeToFiles) {
        // Don't use `console.log` here since we need to replace this line.
        process.stdout.write(filename);
      }

      let input;
      try {
        input = fs.readFileSync(filename, "utf8");
      } catch (e) {
        // Add newline to split errors from filename line.
        process.stdout.write("\n");

        console.error("Unable to read file: " + filename + "\n" + e);
        // Don't exit the process if one file failed
        process.exitCode = 2;
        return;
      }

      if (listDifferent) {
        if (
          !prettier.check(
            input,
            Object.assign({}, prettierOptions, { filepath: filename })
          )
        ) {
          if (!writeToFiles) {
            console.log(filename);
          }
          process.exitCode = 1;
        }
      }

      const start = Date.now();

      let result;
      let output;

      try {
        result = formatContent(
          input,
          Object.assign({}, prettierOptions, { filepath: filename }),
          { debugCheck, debugPrintDoc }
        );
        output = result.formatted;
      } catch (e) {
        // Add newline to split errors from filename line.
        process.stdout.write("\n");

        handleError(filename, e);
        return;
      }

      if (writeToFiles) {
        // Remove previously printed filename to log it with duration.
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0, null);

        // Don't write the file if it won't change in order not to invalidate
        // mtime based caches.
        if (output === input) {
          if (!listDifferent) {
            console.log(chalk.grey("%s %dms"), filename, Date.now() - start);
          }
        } else {
          if (listDifferent) {
            console.log(filename);
          } else {
            console.log("%s %dms", filename, Date.now() - start);
          }

          try {
            fs.writeFileSync(filename, output, "utf8");
          } catch (err) {
            console.error("Unable to write file: " + filename + "\n" + err);
            // Don't exit the process if one file failed
            process.exitCode = 2;
          }
        }
      } else if (debugCheck) {
        if (output) {
          console.log(output);
        } else {
          process.exitCode = 2;
        }
      } else if (!listDifferent) {
        writeOutput(result);
      }
    }

    const globOptions = {
      ignore: ignoreNodeModules && ["**/node_modules/**", "./node_modules/**"],
      dot: true
    };

    function eachFilename(patterns, callback) {
      patterns.forEach(pattern => {
        if (!glob.hasMagic(pattern)) {
          if (shouldIgnorePattern(pattern)) {
            return;
          }
          callback(pattern);
          return;
        }

        glob(pattern, globOptions, (err, filenames) => {
          if (err) {
            console.error(
              "Unable to expand glob pattern: " + pattern + "\n" + err
            );
            // Don't exit the process if one pattern failed
            process.exitCode = 2;
            return;
          }

          filenames.forEach(filename => {
            callback(filename);
          });
        });
      });
    }

    function shouldIgnorePattern(pattern) {
      return (
        ignoreNodeModules && path.resolve(pattern).includes("/node_modules/")
      );
    }

    if (stdin) {
      getStream(process.stdin).then(input => {
        try {
          writeOutput(
            formatContent(input, prettierOptions, {
              debugCheck: debugCheck,
              debugPrintDoc: debugPrintDoc
            })
          );
        } catch (e) {
          handleError("stdin", e);
          return;
        }
      });
      return;
    }

    eachFilename(filePatterns, handleFile);
  }
};
