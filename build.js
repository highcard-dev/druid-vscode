const process = require("process");
const child_process = require("child_process");
const fs = require("fs");
const fse = require("fs-extra");
const { version } = require("./package.json");

const vscodeVersion = version.split("-")[0];

function error(msg) {
  console.info("\x1b[31merror %s\x1b[0m", msg);
}
function ok(msg) {
  console.info("\x1b[32m%s\x1b[0m", msg);
}
function note(msg) {
  console.info("\x1b[90m%s\x1b[0m", msg);
}
function exec(cmd, opts) {
  console.info("\x1b[36m%s\x1b[0m", cmd);
  return child_process.execSync(cmd, opts);
}

const requiredTools = ["node", "npm", "git", "python"];
note(`required tools ${JSON.stringify(requiredTools)}`);
for (const tool of requiredTools) {
  try {
    child_process.execSync(`${tool} --version`, { stdio: "ignore" });
  } catch (e) {
    error(`"${tool}" is not available.`);
    //process.exit(1);
  }
}
ok("required tools installed");

const node_version_out = child_process.execSync(`node -v`);
const node_version = node_version_out.toString().trim();
if (node_version < "v20.0") {
  error(`Want node > 20. Got "${node_version}"`);
  process.exit(1);
}

if (!fs.existsSync("vscode")) {
  note("cloning vscode");
  exec(
    `git clone --depth 1 https://github.com/microsoft/vscode.git -b ${vscodeVersion}`,
    {
      stdio: "inherit",
    }
  );
} else {
  ok("vscode already installed");
  note("delete vscode folder to clone again");
}

//replace max-old-space-size=8192 with 4096 in package.json

const vscodePackagePath = "vscode/package.json";
let packageContent = fs.readFileSync(vscodePackagePath).toString();
packageContent = packageContent.replace(
  /max-old-space-size=8192/g,
  "max-old-space-size=4096"
);
fs.writeFileSync(vscodePackagePath, packageContent);

note("changing directory to vscode");
process.chdir("vscode");

if (!fs.existsSync("node_modules")) {
  exec("npm install", {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_SKIP_BINARY_DOWNLOAD: 1,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1,
    },
  });
} else {
  ok("node_modules exists. Skipping npm install");
}

// Use simple workbench
note("copying workbench file");
/*fs.copyFileSync(
  "../workbench.ts",
  "src/vs/code/browser/workbench/workbench.ts"
);*/

// Compile
note("starting compile");
exec("npm run gulp vscode-web-min", { stdio: "inherit" });
ok("compile completed");
