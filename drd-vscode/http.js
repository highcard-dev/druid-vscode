var express = require("express");
var serveStatic = require("serve-static");

var staticBasePath = "./";

var app = express();
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); //

app.use(serveStatic(staticBasePath));

app.all("/:instanceId/:deploymentId", (req, res) => {
  const deploymentId = req.params.deploymentId;

  // post or query parameter
  const apiKey = req.body?.apiKey || req.query?.apiKey;

  if (!apiKey) {
    res.status(400).send("apiKey is required");
    return;
  }

  res.render("index", {
    apiKey,
    deploymentId,
  });
});

app.listen(8089);
console.log("Listening on port 8089");
