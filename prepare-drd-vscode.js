const child_process = require("child_process");

const webPlaygroundPath = "./vscode-web/extensions/webdav-fsprovider";

child_process.execSync(`bash -c 'cd drd-fs && npm run compile-web'`, {
  stdio: "inherit",
});

child_process.execSync(`rm -rf ${webPlaygroundPath}`, {
  stdio: "inherit",
});

child_process.execSync(`cp -r drd-fs ${webPlaygroundPath}`, {
  stdio: "inherit",
});
