require("dotenv").config();

const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Keynua Monitor is running");
}).listen(PORT, () => {
  console.log(`Health server running on port ${PORT}`);
});

