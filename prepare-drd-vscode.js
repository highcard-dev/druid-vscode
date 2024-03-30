var fs = require("fs");
const fse = require("fs-extra");
const child_process = require("child_process");

if (fs.existsSync("./drd-vscode/static")) {
  fs.rmdirSync("./drd-vscode/static", { recursive: true });
}

fse.copySync("./dist/extensions", "./drd-vscode/static/extensions");
fse.copySync("./dist/node_modules", "./drd-vscode/static/node_modules");
fse.copySync("./dist/out", "./drd-vscode/static/out");

const webPlaygroundPath =
  "./drd-vscode/static/extensions/vscode-web-playground";

child_process.execSync(`bash -c 'cd drd-fsprovider && npm run compile-web'`, {
  stdio: "inherit",
});

child_process.execSync(`rm -rf ${webPlaygroundPath}`, {
  stdio: "inherit",
});

child_process.execSync(`cp -r drd-fsprovider ${webPlaygroundPath}`, {
  stdio: "inherit",
});
