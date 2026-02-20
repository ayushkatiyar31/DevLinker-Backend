const Razorpay = require("razorpay");

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

let instance;

if (key_id && key_secret) {
  instance = new Razorpay({
    key_id,
    key_secret,
  });
} else {
  // Allow the server to start even when Razorpay isn't configured.
  // Payment routes will fail with a clear message when invoked.
  instance = {
    orders: {
      create: async () => {
        throw new Error(
          "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
        );
      },
    },
  };
}

module.exports = instance;
