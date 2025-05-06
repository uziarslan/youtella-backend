const express = require("express");
const wrapAsync = require("../utils/wrapAsync");
const { protect } = require("../middlewares/authMiddleware");
const {
    registerUser,
    userLogin,
    getUser,
    updateUser,
    forgotPassword,
    verifyOTP,
    resetPassword
} = require("../controllers/authentication");

const multer = require("multer");
const { storage } = require("../cloudinary");
const upload = multer({ storage });

const router = express()

// Creating a user
router.post("/user/signup", wrapAsync(registerUser));

// Logging in a user
router.post("/user/login", wrapAsync(userLogin));

// Forgot Password request
router.post("/user/forgot-password", wrapAsync(forgotPassword));

// Verifying OTP
router.post("/user/verify-otp", wrapAsync(verifyOTP));

// Resetting Password
router.post("/user/reset-password", wrapAsync(resetPassword));

// Getting a user
router.get("/user", protect, wrapAsync(getUser));

// Updating a user
router.put("/user", upload.single("profileImage"), protect, wrapAsync(updateUser));


module.exports = router;
