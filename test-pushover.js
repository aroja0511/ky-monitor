require("dotenv").config();

const sendPushover = require("./src/services/pushover");

(async () => {
  await sendPushover(
    "Keynua Monitor Test",
    "Pushover notifications are working."
  );
})();