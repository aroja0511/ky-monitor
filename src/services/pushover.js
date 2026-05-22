require("dotenv").config();

const axios = require("axios");

async function sendPushover(title, message) {
  try {
    await axios.post(
      "https://api.pushover.net/1/messages.json",
      {
        token: process.env.PUSHOVER_APP_TOKEN,
        user: process.env.PUSHOVER_USER_KEY,
        title,
        message
      }
    );

    console.log("Pushover notification sent");
  } catch (error) {
    console.error(
      "Pushover error:",
      error.response?.data || error.message
    );
  }
}

module.exports = sendPushover;